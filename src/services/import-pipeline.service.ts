import crypto from "crypto";
import { createLogger } from "@/lib/logger";
import { getStorageProvider, StorageProvider } from "@/lib/storage/storage-provider";
import { validateUploadedFile } from "@/lib/storage/file-validator";
import {
  questionBankRepo,
  ImportJobRecord,
  QuestionRecord
} from "@/repositories/question-bank.repository";
import { classifyAndExtractDocument } from "@/adapters/documents/document-classifier";
import { ResilientOCRService } from "@/adapters/ocr/ocr-provider";
import { normalizePageText } from "@/domain/extraction/text-normalizer";
import { segmentAndParseQuestions } from "@/domain/extraction/question-segmenter";
import { computeQuestionContentHash } from "@/domain/richtext/tiptap-converter";
import { ValidatedQuestionPayloadSchema } from "@/domain/schemas/question.schema";
import { SelectiveAIRepairService } from "@/adapters/ai/selective-ai-repair";

const logger = createLogger("ImportPipelineService");

export interface PipelineDependencies {
  storage?: StorageProvider;
  ocrService?: ResilientOCRService;
  aiRepairService?: SelectiveAIRepairService;
}

export class ImportPipelineService {
  private readonly storage: StorageProvider;
  private readonly ocrService: ResilientOCRService;
  private readonly aiRepairService: SelectiveAIRepairService;

  constructor(deps: PipelineDependencies = {}) {
    this.storage = deps.storage ?? getStorageProvider();
    this.ocrService = deps.ocrService ?? new ResilientOCRService();
    this.aiRepairService = deps.aiRepairService ?? new SelectiveAIRepairService();
  }

  /**
   * Executes the full idempotent extraction pipeline for an ImportJob.
   * Safe to retry at any stage without creating duplicate pages or duplicate questions.
   */
  async processImportJob(importJobId: string, fileBufferOverride?: Buffer): Promise<{
    job: ImportJobRecord;
    questions: QuestionRecord[];
  }> {
    const startTime = Date.now();
    const job = await questionBankRepo.getImportJobById(importJobId);
    if (!job) {
      throw new Error(`ImportJob ${importJobId} does not exist.`);
    }

    // Respect job cancellation
    if (job.cancelledAt) {
      throw new Error(`ImportJob ${importJobId} was cancelled.`);
    }

    try {
      await questionBankRepo.updateImportJob(importJobId, {
        status: "PROCESSING",
        currentStage: "CLASSIFY_DOCUMENT",
        progressPercent: 10,
        startedAt: new Date(),
        errorMessage: null,
        errorCode: null
      });

      // 1. Load file from private storage (or buffer override) & re-verify binary signature
      const fileBuffer =
        fileBufferOverride ?? (await this.storage.getObject(job.storageKey));

      const validation = validateUploadedFile(fileBuffer, job.fileName);
      if (!validation.valid || !validation.category) {
        throw new Error(
          validation.errorMessage || "File failed binary signature verification during processing."
        );
      }

      // 2. Classify Document & Extract Page Content (+ Run OCR only where required)
      await questionBankRepo.updateImportJob(importJobId, {
        currentStage: "EXTRACT_AND_OCR_PAGES",
        progressPercent: 25
      });

      const extraction = await classifyAndExtractDocument(
        fileBuffer,
        validation.category,
        validation.detectedMimeType || job.originalMimeType,
        this.ocrService,
        job.userDeclaredFormat
      );

      // Check if job was cancelled while OCR was running
      const refreshedJob = await questionBankRepo.getImportJobById(importJobId);
      if (refreshedJob?.cancelledAt) {
        throw new Error(`ImportJob ${importJobId} was cancelled during page extraction.`);
      }

      // 3. Persist extracted image assets to Private Object Storage (never base64 in JSONB)
      // and Normalize page text
      await questionBankRepo.updateImportJob(importJobId, {
        detectedFormat: extraction.detectedFormat,
        totalPages: extraction.totalPages,
        ocrMethod: extraction.ocrMethod,
        ocrDurationMs: extraction.totalOcrDurationMs,
        currentStage: "NORMALIZE_TEXT",
        progressPercent: 50
      });

      const normalizedPagesForSegmenter: Array<{
        pageNumber: number;
        text: string;
        ocrConfidence: number | null;
        warnings: string[];
      }> = [];

      for (const page of extraction.pages) {
        let pageTextWithAssetIds = page.rawText;

        for (let assetIdx = 0; assetIdx < page.extractedAssets.length; assetIdx++) {
          const assetCandidate = page.extractedAssets[assetIdx];
          const storedAsset = await this.storage.putObject({
            keyPrefix: "assets",
            fileName: `page-${page.pageNumber}-fig-${assetIdx + 1}.png`,
            buffer: assetCandidate.buffer,
            contentType: assetCandidate.mimeType
          });
          const assetRecord = await questionBankRepo.createAsset({
            importJobId,
            pageNumber: page.pageNumber,
            mimeType: assetCandidate.mimeType,
            storageKey: storedAsset.storageKey,
            fileSize: storedAsset.byteLength,
            sha256: crypto
              .createHash("sha256")
              .update(assetCandidate.buffer)
              .digest("hex"),
            altText: assetCandidate.altText
          });

          pageTextWithAssetIds = pageTextWithAssetIds.replace(
            new RegExp(`PENDING_ASSET_${assetIdx}`, "g"),
            assetRecord.id
          );
        }

        const normalizedText = normalizePageText(pageTextWithAssetIds);

        await questionBankRepo.upsertImportPage({
          importJobId,
          pageNumber: page.pageNumber,
          classification: page.classification,
          rawText: page.rawText,
          normalizedText,
          ocrUsed: page.ocrUsed,
          ocrProvider: page.ocrProvider,
          ocrConfidence: page.ocrConfidence,
          ocrDurationMs: page.ocrDurationMs,
          width: page.width,
          height: page.height,
          boundingBoxes: page.boundingBoxes,
          metadata: { warnings: page.warnings }
        });

        normalizedPagesForSegmenter.push({
          pageNumber: page.pageNumber,
          text: normalizedText,
          ocrConfidence: page.ocrConfidence,
          warnings: page.warnings
        });
      }

      // 4. Segment Questions & Parse Structure Deterministically
      await questionBankRepo.updateImportJob(importJobId, {
        pagesProcessed: extraction.pages.length,
        currentStage: "SEGMENT_AND_PARSE_QUESTIONS",
        progressPercent: 68
      });

      const deterministicCandidates = segmentAndParseQuestions(normalizedPagesForSegmenter);

      // 5. Selective AI Repair (only for ambiguous/malformed/low-confidence candidates within budget)
      await questionBankRepo.updateImportJob(importJobId, {
        currentStage: "SELECTIVE_AI_REPAIR",
        progressPercent: 82
      });

      const repairSummary = await this.aiRepairService.repairCandidatesSelectively(
        deterministicCandidates,
        job.aiBudgetUsd
      );

      // 6. Validate Again with Zod, Compute Content Hashes, Detect Duplicates & Save Staging Questions
      await questionBankRepo.updateImportJob(importJobId, {
        currentStage: "VALIDATE_AND_SAVE_STAGING",
        progressPercent: 92
      });

      const seenHashesInThisImport = new Map<string, number>();
      const stagingToSave = [];

      for (const candidate of repairSummary.candidates) {
        // Strict second validation pass before database persistence
        const validated = ValidatedQuestionPayloadSchema.parse(candidate.payload);
        const contentHash = computeQuestionContentHash(
          validated.question,
          validated.options,
          validated.type
        );

        let isDuplicate = false;
        let duplicateOfId: string | null = null;
        const warnings = [...validated.warnings];

        if (seenHashesInThisImport.has(contentHash)) {
          isDuplicate = true;
          const earlierOrder = seenHashesInThisImport.get(contentHash)!;
          warnings.push(
            `Duplicate question detected within this document (matches Question #${earlierOrder}).`
          );
        } else {
          seenHashesInThisImport.set(contentHash, validated.sourceOrder);
          const existingInDb = await questionBankRepo.findExistingQuestionByContentHash(
            contentHash,
            importJobId
          );
          if (existingInDb) {
            isDuplicate = true;
            duplicateOfId = existingInDb.id;
            warnings.push(
              `Duplicate of existing question (${existingInDb.id}) from a previous import.`
            );
          }
        }

        const finalReviewStatus =
          isDuplicate && validated.reviewStatus === "PENDING_REVIEW"
            ? "NEEDS_ATTENTION"
            : validated.reviewStatus;

        stagingToSave.push({
          ...validated,
          warnings,
          reviewStatus: finalReviewStatus,
          sourceFileId: job.storageKey,
          contentHash,
          isDuplicate,
          duplicateOfId
        });
      }

      const savedQuestions = await questionBankRepo.saveStagingQuestionsTransactional(
        importJobId,
        stagingToSave
      );

      const questionsRequiringReview = savedQuestions.filter(
        (q) => q.reviewStatus !== "APPROVED"
      ).length;

      const processingDurationMs = Date.now() - startTime;
      const finalStatus =
        savedQuestions.length > 0 ? "REVIEW_REQUIRED" : "COMPLETED";

      const completedJob = await questionBankRepo.updateImportJob(importJobId, {
        status: finalStatus,
        currentStage: "READY_FOR_REVIEW",
        progressPercent: 100,
        totalExtractedQuestions: savedQuestions.length,
        questionsRequiringReview,
        aiUsed: repairSummary.aiUsed,
        aiModel: repairSummary.aiModel,
        aiInputTokens: repairSummary.totalInputTokens,
        aiOutputTokens: repairSummary.totalOutputTokens,
        estimatedAiCostUsd: repairSummary.totalCostUsd,
        processingDurationMs,
        completedAt: new Date()
      });

      logger.info("Import pipeline completed", {
        importJobId,
        detectedFormat: completedJob.detectedFormat,
        pagesProcessed: completedJob.pagesProcessed,
        questionsExtracted: completedJob.totalExtractedQuestions,
        questionsRequiringReview: completedJob.questionsRequiringReview,
        ocrProvider: completedJob.ocrMethod,
        ocrDurationMs: completedJob.ocrDurationMs,
        aiUsed: completedJob.aiUsed,
        aiModel: completedJob.aiModel,
        inputTokens: completedJob.aiInputTokens,
        outputTokens: completedJob.aiOutputTokens,
        estimatedApiCostUsd: completedJob.estimatedAiCostUsd,
        processingDurationMs: completedJob.processingDurationMs
      });

      return {
        job: completedJob,
        questions: savedQuestions
      };
    } catch (err) {
      const processingDurationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : "Document processing failed";
      logger.error("Import pipeline failed", {
        importJobId,
        errorMessage,
        processingDurationMs
      });

      await questionBankRepo.updateImportJob(importJobId, {
        status: "FAILED",
        currentStage: "FAILED",
        errorMessage,
        errorCode: "PROCESSING_PIPELINE_ERROR",
        processingDurationMs
      });

      throw err;
    }
  }
}

export const importPipelineService = new ImportPipelineService();
