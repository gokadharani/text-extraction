import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import {
  ImportStatus,
  DocumentFormat,
  UserDeclaredFormat,
  PageClassification,
  QuestionType,
  AnswerStatus,
  AnswerProvenance,
  QuestionReviewStatus,
  ReviewAction,
  Prisma
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/logger";
import {
  TiptapDoc,
  QuestionOption,
  QuestionAnswer,
  BoundingBox,
  toDomainAnswerType,
  toDomainAnswerStatus,
  toPrismaAnswerStatus
} from "@/domain/schemas/question.schema";

const logger = createLogger("QuestionBankRepository");

export { UserDeclaredFormat };

export interface ImportJobRecord {
  id: string;
  fileName: string;
  originalMimeType: string;
  detectedFormat: DocumentFormat;
  userDeclaredFormat?: UserDeclaredFormat | null;
  fileSize: number;
  fileSha256: string;
  storageKey: string;
  status: ImportStatus;
  currentStage: string;
  progressPercent: number;
  totalPages: number;
  pagesProcessed: number;
  totalExtractedQuestions: number;
  questionsRequiringReview: number;
  approvedQuestionsCount: number;
  ocrMethod: string | null;
  ocrDurationMs: number;
  aiUsed: boolean;
  aiModel: string | null;
  aiInputTokens: number;
  aiOutputTokens: number;
  estimatedAiCostUsd: number;
  aiBudgetUsd: number;
  processingDurationMs: number;
  errorMessage: string | null;
  errorCode: string | null;
  isDuplicateFile: boolean;
  cancelledAt: Date | null;
  uploadedById: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImportPageRecord {
  id: string;
  importJobId: string;
  pageNumber: number;
  classification: PageClassification;
  rawText: string;
  normalizedText: string;
  ocrUsed: boolean;
  ocrProvider: string | null;
  ocrConfidence: number | null;
  ocrDurationMs: number;
  width: number | null;
  height: number | null;
  previewStorageKey: string | null;
  boundingBoxes: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionRecord {
  id: string;
  question: TiptapDoc;
  options: QuestionOption[];
  answer: QuestionAnswer;
  explanation: TiptapDoc | null;
  type: QuestionType;
  sourceFileId: string;
  importJobId: string;
  sourcePage: number;
  sourcePageEnd: number | null;
  sourceQuestionNumber: string;
  sourceSection: string | null;
  sourceOrder: number;
  confidence: number;
  answerProvenance: AnswerProvenance;
  reviewStatus: QuestionReviewStatus;
  sharedPassage: TiptapDoc | null;
  boundingBox: BoundingBox | null;
  warnings: string[];
  aiRepaired: boolean;
  aiRepairModel: string | null;
  aiRepairReason: string | null;
  contentHash: string;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  is_active?: boolean;
  publishedToBank: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionAssetRecord {
  id: string;
  importJobId: string;
  questionId: string | null;
  pageNumber: number | null;
  assetType: string;
  mimeType: string;
  storageKey: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  sha256: string;
  altText: string | null;
  createdAt: Date;
}

export interface QuestionReviewLogRecord {
  id: string;
  questionId: string;
  reviewerId: string;
  action: ReviewAction;
  previousState: unknown;
  newState: unknown;
  notes: string | null;
  createdAt: Date;
}

interface LocalDbStore {
  importJobs: Record<string, ImportJobRecord>;
  importPages: Record<string, ImportPageRecord>;
  questions: Record<string, QuestionRecord>;
  assets: Record<string, QuestionAssetRecord>;
  reviewLogs: Record<string, QuestionReviewLogRecord>;
  aiCache: Record<
    string,
    {
      inputHash: string;
      model: string;
      repairedJson: unknown;
      inputTokens: number;
      outputTokens: number;
    }
  >;
  ocrCache: Record<
    string,
    {
      imageHash: string;
      provider: string;
      ocrResult: unknown;
      confidence: number;
    }
  >;
}

const emptyStore = (): LocalDbStore => ({
  importJobs: {},
  importPages: {},
  questions: {},
  assets: {},
  reviewLogs: {},
  aiCache: {},
  ocrCache: {}
});

let memoryStore: LocalDbStore | null = null;
let prismaHealthy: boolean | null = null;

const LOCAL_DB_FILE = path.resolve(process.cwd(), ".private-storage", "local-db-store.json");

async function loadLocalStore(): Promise<LocalDbStore> {
  if (memoryStore) return memoryStore;
  try {
    const raw = await fs.readFile(LOCAL_DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // Revive dates
    for (const job of Object.values(parsed.importJobs || {}) as ImportJobRecord[]) {
      job.createdAt = new Date(job.createdAt);
      job.updatedAt = new Date(job.updatedAt);
      if (job.startedAt) job.startedAt = new Date(job.startedAt);
      if (job.completedAt) job.completedAt = new Date(job.completedAt);
      if (job.cancelledAt) job.cancelledAt = new Date(job.cancelledAt);
      if (!job.userDeclaredFormat) job.userDeclaredFormat = "AUTO_DETECT";
    }
    for (const page of Object.values(parsed.importPages || {}) as ImportPageRecord[]) {
      page.createdAt = new Date(page.createdAt);
      page.updatedAt = new Date(page.updatedAt);
    }
    for (const q of Object.values(parsed.questions || {}) as QuestionRecord[]) {
      q.createdAt = new Date(q.createdAt);
      q.updatedAt = new Date(q.updatedAt);
      if (q.publishedAt) q.publishedAt = new Date(q.publishedAt);
    }
    for (const asset of Object.values(parsed.assets || {}) as QuestionAssetRecord[]) {
      asset.createdAt = new Date(asset.createdAt);
    }
    for (const log of Object.values(parsed.reviewLogs || {}) as QuestionReviewLogRecord[]) {
      log.createdAt = new Date(log.createdAt);
    }
    memoryStore = parsed as LocalDbStore;
    return memoryStore;
  } catch {
    memoryStore = emptyStore();
    return memoryStore;
  }
}

async function persistLocalStore(store: LocalDbStore): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  try {
    await fs.mkdir(path.dirname(LOCAL_DB_FILE), { recursive: true });
    await fs.writeFile(LOCAL_DB_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Ignore write contention in dev
  }
}

async function isPrismaAvailable(): Promise<boolean> {
  if (process.env.FORCE_IN_MEMORY_DB === "true" || process.env.NODE_ENV === "test") {
    return false;
  }
  if (prismaHealthy !== null) return prismaHealthy;
  try {
    await prisma.$queryRaw`SELECT 1`;
    prismaHealthy = true;
    return true;
  } catch (err) {
    logger.warn("PostgreSQL unreachable or unconfigured; using local transactional repository store", {
      reason: err instanceof Error ? err.message : String(err)
    });
    prismaHealthy = false;
    return false;
  }
}

function mapPrismaQuestion(row: {
  id: string;
  type: QuestionType;
  content: Prisma.JsonValue;
  explanation: Prisma.JsonValue | null;
  answerStatus: AnswerStatus;
  answerProvenance: AnswerProvenance;
  reviewStatus: QuestionReviewStatus;
  is_active: boolean;
  publishedToBank: boolean;
  publishedAt: Date | null;
  sourceFileId: string;
  importJobId: string;
  sourcePage: number;
  sourcePageEnd: number | null;
  sourceQuestionNumber: string;
  sourceSection: string | null;
  sourceOrder: number;
  confidence: number;
  sharedPassage: Prisma.JsonValue | null;
  boundingBox: Prisma.JsonValue | null;
  warnings: Prisma.JsonValue;
  aiRepaired: boolean;
  aiRepairModel: string | null;
  aiRepairReason: string | null;
  contentHash: string;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  createdAt: Date;
  updatedAt: Date;
  options?: Array<{
    id: string;
    questionId: string;
    label: string;
    content: Prisma.JsonValue;
    isCorrect: boolean;
    displayOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
}): QuestionRecord {
  const sortedOptions = (row.options || [])
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const options: QuestionOption[] = sortedOptions.map((opt) => ({
    id: opt.label,
    content: opt.content as unknown as TiptapDoc
  }));

  const correctLabels = sortedOptions
    .filter((opt) => opt.isCorrect)
    .map((opt) => opt.label);

  const answer: QuestionAnswer = {
    type: toDomainAnswerType(row.type),
    value: correctLabels,
    status: toDomainAnswerStatus(row.answerStatus)
  };

  return {
    id: row.id,
    question: row.content as unknown as TiptapDoc,
    options,
    answer,
    explanation: (row.explanation as unknown as TiptapDoc) ?? null,
    type: row.type,
    sourceFileId: row.sourceFileId,
    importJobId: row.importJobId,
    sourcePage: row.sourcePage,
    sourcePageEnd: row.sourcePageEnd,
    sourceQuestionNumber: row.sourceQuestionNumber,
    sourceSection: row.sourceSection,
    sourceOrder: row.sourceOrder,
    confidence: row.confidence,
    answerProvenance: row.answerProvenance,
    reviewStatus: row.reviewStatus,
    sharedPassage: (row.sharedPassage as unknown as TiptapDoc) ?? null,
    boundingBox: (row.boundingBox as unknown as BoundingBox) ?? null,
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
    aiRepaired: row.aiRepaired,
    aiRepairModel: row.aiRepairModel,
    aiRepairReason: row.aiRepairReason,
    contentHash: row.contentHash,
    isDuplicate: row.isDuplicate,
    duplicateOfId: row.duplicateOfId,
    is_active: row.is_active,
    publishedToBank: row.publishedToBank,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class QuestionBankRepository {
  async resetForTests(): Promise<void> {
    memoryStore = emptyStore();
  }

  async findImportBySha256(fileSha256: string): Promise<ImportJobRecord | null> {
    if (await isPrismaAvailable()) {
      return prisma.importJob.findFirst({
        where: { fileSha256 },
        orderBy: { createdAt: "desc" }
      });
    }
    const store = await loadLocalStore();
    const matches = Object.values(store.importJobs)
      .filter((j) => j.fileSha256 === fileSha256)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  }

  async createImportJob(data: {
    fileName: string;
    originalMimeType: string;
    detectedFormat?: DocumentFormat;
    userDeclaredFormat?: UserDeclaredFormat | null;
    fileSize: number;
    fileSha256: string;
    storageKey: string;
    aiBudgetUsd?: number;
    isDuplicateFile?: boolean;
    uploadedById?: string;
  }): Promise<ImportJobRecord> {
    if (await isPrismaAvailable()) {
      return prisma.importJob.create({
        data: {
          fileName: data.fileName,
          originalMimeType: data.originalMimeType,
          detectedFormat: data.detectedFormat ?? "UNKNOWN",
          userDeclaredFormat: data.userDeclaredFormat ?? "AUTO_DETECT",
          fileSize: data.fileSize,
          fileSha256: data.fileSha256,
          storageKey: data.storageKey,
          status: "UPLOADED",
          currentStage: "UPLOADED",
          aiBudgetUsd: data.aiBudgetUsd ?? 0.5,
          isDuplicateFile: data.isDuplicateFile ?? false,
          uploadedById: data.uploadedById ?? null
        }
      });
    }

    const store = await loadLocalStore();
    const now = new Date();
    const id = `imp_${crypto.randomBytes(10).toString("hex")}`;
    const record: ImportJobRecord = {
      id,
      fileName: data.fileName,
      originalMimeType: data.originalMimeType,
      detectedFormat: data.detectedFormat ?? "UNKNOWN",
      userDeclaredFormat: data.userDeclaredFormat ?? "AUTO_DETECT",
      fileSize: data.fileSize,
      fileSha256: data.fileSha256,
      storageKey: data.storageKey,
      status: "UPLOADED",
      currentStage: "UPLOADED",
      progressPercent: 0,
      totalPages: 0,
      pagesProcessed: 0,
      totalExtractedQuestions: 0,
      questionsRequiringReview: 0,
      approvedQuestionsCount: 0,
      ocrMethod: null,
      ocrDurationMs: 0,
      aiUsed: false,
      aiModel: null,
      aiInputTokens: 0,
      aiOutputTokens: 0,
      estimatedAiCostUsd: 0,
      aiBudgetUsd: data.aiBudgetUsd ?? 0.5,
      processingDurationMs: 0,
      errorMessage: null,
      errorCode: null,
      isDuplicateFile: data.isDuplicateFile ?? false,
      cancelledAt: null,
      uploadedById: data.uploadedById ?? null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    };
    store.importJobs[id] = record;
    await persistLocalStore(store);
    return record;
  }

  async getImportJobById(id: string): Promise<ImportJobRecord | null> {
    if (await isPrismaAvailable()) {
      return prisma.importJob.findUnique({ where: { id } });
    }
    const store = await loadLocalStore();
    return store.importJobs[id] ?? null;
  }

  async listImportJobs(): Promise<ImportJobRecord[]> {
    if (await isPrismaAvailable()) {
      return prisma.importJob.findMany({
        orderBy: { createdAt: "desc" }
      });
    }
    const store = await loadLocalStore();
    return Object.values(store.importJobs).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  async updateImportJob(
    id: string,
    patch: Partial<Omit<ImportJobRecord, "id" | "createdAt">>
  ): Promise<ImportJobRecord> {
    if (await isPrismaAvailable()) {
      return prisma.importJob.update({
        where: { id },
        data: patch
      });
    }
    const store = await loadLocalStore();
    const existing = store.importJobs[id];
    if (!existing) {
      throw new Error(`ImportJob ${id} not found`);
    }
    const updated: ImportJobRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date()
    };
    store.importJobs[id] = updated;
    await persistLocalStore(store);
    return updated;
  }

  async deleteImportJob(id: string): Promise<{ storageKeys: string[] }> {
    if (await isPrismaAvailable()) {
      const job = await prisma.importJob.findUnique({
        where: { id },
        include: { assets: true, pages: true }
      });
      if (!job) return { storageKeys: [] };
      const keys = [
        job.storageKey,
        ...job.assets.map((a) => a.storageKey),
        ...job.pages.map((p) => p.previewStorageKey).filter((k): k is string => Boolean(k))
      ];
      await prisma.importJob.delete({ where: { id } });
      return { storageKeys: keys };
    }

    const store = await loadLocalStore();
    const job = store.importJobs[id];
    if (!job) return { storageKeys: [] };

    const storageKeys: string[] = [job.storageKey];
    for (const [pageId, page] of Object.entries(store.importPages)) {
      if (page.importJobId === id) {
        if (page.previewStorageKey) storageKeys.push(page.previewStorageKey);
        delete store.importPages[pageId];
      }
    }
    for (const [assetId, asset] of Object.entries(store.assets)) {
      if (asset.importJobId === id) {
        storageKeys.push(asset.storageKey);
        delete store.assets[assetId];
      }
    }
    for (const [qId, q] of Object.entries(store.questions)) {
      if (q.importJobId === id) {
        for (const [logId, log] of Object.entries(store.reviewLogs)) {
          if (log.questionId === qId) delete store.reviewLogs[logId];
        }
        delete store.questions[qId];
      }
    }
    delete store.importJobs[id];
    await persistLocalStore(store);
    return { storageKeys };
  }

  async upsertImportPage(data: {
    importJobId: string;
    pageNumber: number;
    classification: PageClassification;
    rawText: string;
    normalizedText: string;
    ocrUsed: boolean;
    ocrProvider?: string | null;
    ocrConfidence?: number | null;
    ocrDurationMs?: number;
    width?: number | null;
    height?: number | null;
    previewStorageKey?: string | null;
    boundingBoxes?: unknown;
    metadata?: unknown;
  }): Promise<ImportPageRecord> {
    if (await isPrismaAvailable()) {
      return prisma.importPage.upsert({
        where: {
          importJobId_pageNumber: {
            importJobId: data.importJobId,
            pageNumber: data.pageNumber
          }
        },
        create: {
          importJobId: data.importJobId,
          pageNumber: data.pageNumber,
          classification: data.classification,
          rawText: data.rawText,
          normalizedText: data.normalizedText,
          ocrUsed: data.ocrUsed,
          ocrProvider: data.ocrProvider ?? null,
          ocrConfidence: data.ocrConfidence ?? null,
          ocrDurationMs: data.ocrDurationMs ?? 0,
          width: data.width ?? null,
          height: data.height ?? null,
          previewStorageKey: data.previewStorageKey ?? null,
          boundingBoxes: (data.boundingBoxes ?? []) as Prisma.InputJsonValue,
          metadata: (data.metadata ?? {}) as Prisma.InputJsonValue
        },
        update: {
          classification: data.classification,
          rawText: data.rawText,
          normalizedText: data.normalizedText,
          ocrUsed: data.ocrUsed,
          ocrProvider: data.ocrProvider ?? null,
          ocrConfidence: data.ocrConfidence ?? null,
          ocrDurationMs: data.ocrDurationMs ?? 0,
          width: data.width ?? null,
          height: data.height ?? null,
          previewStorageKey: data.previewStorageKey ?? null,
          boundingBoxes: (data.boundingBoxes ?? []) as Prisma.InputJsonValue,
          metadata: (data.metadata ?? {}) as Prisma.InputJsonValue
        }
      });
    }

    const store = await loadLocalStore();
    const existing = Object.values(store.importPages).find(
      (p) => p.importJobId === data.importJobId && p.pageNumber === data.pageNumber
    );
    const now = new Date();
    const id = existing?.id ?? `pg_${crypto.randomBytes(8).toString("hex")}`;
    const record: ImportPageRecord = {
      id,
      importJobId: data.importJobId,
      pageNumber: data.pageNumber,
      classification: data.classification,
      rawText: data.rawText,
      normalizedText: data.normalizedText,
      ocrUsed: data.ocrUsed,
      ocrProvider: data.ocrProvider ?? null,
      ocrConfidence: data.ocrConfidence ?? null,
      ocrDurationMs: data.ocrDurationMs ?? 0,
      width: data.width ?? null,
      height: data.height ?? null,
      previewStorageKey: data.previewStorageKey ?? null,
      boundingBoxes: data.boundingBoxes ?? [],
      metadata: data.metadata ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    store.importPages[id] = record;
    await persistLocalStore(store);
    return record;
  }

  async getImportPages(importJobId: string): Promise<ImportPageRecord[]> {
    if (await isPrismaAvailable()) {
      return prisma.importPage.findMany({
        where: { importJobId },
        orderBy: { pageNumber: "asc" }
      });
    }
    const store = await loadLocalStore();
    return Object.values(store.importPages)
      .filter((p) => p.importJobId === importJobId)
      .sort((a, b) => a.pageNumber - b.pageNumber);
  }

  async findExistingQuestionByContentHash(
    contentHash: string,
    excludeImportJobId?: string
  ): Promise<QuestionRecord | null> {
    if (await isPrismaAvailable()) {
      const row = await prisma.question.findFirst({
        where: {
          contentHash,
          ...(excludeImportJobId ? { importJobId: { not: excludeImportJobId } } : {})
        },
        include: { options: true },
        orderBy: { createdAt: "asc" }
      });
      return row ? mapPrismaQuestion(row) : null;
    }

    const store = await loadLocalStore();
    const match = Object.values(store.questions).find(
      (q) =>
        q.contentHash === contentHash &&
        (!excludeImportJobId || q.importJobId !== excludeImportJobId)
    );
    return match ?? null;
  }

  /**
   * Idempotently saves extracted staging questions for an import job inside a transaction.
   * Keyed by (importJobId, sourceOrder) to prevent duplicates on job retry.
   * Protects reviewed and published questions from being overwritten or left in an inconsistent state.
   */
  async saveStagingQuestionsTransactional(
    importJobId: string,
    questions: Array<{
      question: TiptapDoc;
      options: QuestionOption[];
      answer: QuestionAnswer;
      explanation: TiptapDoc | null;
      type: QuestionType;
      sourceFileId: string;
      sourcePage: number;
      sourcePageEnd?: number | null;
      sourceQuestionNumber: string;
      sourceSection?: string | null;
      sourceOrder: number;
      confidence: number;
      answerProvenance: AnswerProvenance;
      reviewStatus: QuestionReviewStatus;
      sharedPassage?: TiptapDoc | null;
      boundingBox?: BoundingBox | null;
      warnings: string[];
      aiRepaired: boolean;
      aiRepairModel?: string | null;
      aiRepairReason?: string | null;
      contentHash: string;
      isDuplicate: boolean;
      duplicateOfId?: string | null;
    }>
  ): Promise<QuestionRecord[]> {
    if (await isPrismaAvailable()) {
      const saved = await prisma.$transaction(async (tx) => {
        // 1. Precise stale-question deletion: remove questions whose sourceOrder is not in incoming set
        const incomingOrders = questions.map((q) => q.sourceOrder);
        await tx.question.deleteMany({
          where: {
            importJobId,
            sourceOrder: { notIn: incomingOrders }
          }
        });

        const results: QuestionRecord[] = [];
        for (const item of questions) {
          const existing = await tx.question.findUnique({
            where: {
              importJobId_sourceOrder: {
                importJobId,
                sourceOrder: item.sourceOrder
              }
            },
            include: { options: true }
          });

          if (!existing) {
            // New question insertion
            const created = await tx.question.create({
              data: {
                importJobId,
                sourceFileId: item.sourceFileId,
                content: item.question as unknown as Prisma.InputJsonValue,
                explanation: item.explanation
                  ? (item.explanation as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                type: item.type,
                answerStatus: toPrismaAnswerStatus(item.answer.status) as any,
                answerProvenance: item.answerProvenance,
                reviewStatus: item.reviewStatus,
                is_active: true,
                publishedToBank: false,
                publishedAt: null,
                sourcePage: item.sourcePage,
                sourcePageEnd: item.sourcePageEnd ?? null,
                sourceQuestionNumber: item.sourceQuestionNumber,
                sourceSection: item.sourceSection ?? null,
                sourceOrder: item.sourceOrder,
                confidence: item.confidence,
                sharedPassage: item.sharedPassage
                  ? (item.sharedPassage as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                boundingBox: item.boundingBox
                  ? (item.boundingBox as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                warnings: item.warnings as unknown as Prisma.InputJsonValue,
                aiRepaired: item.aiRepaired,
                aiRepairModel: item.aiRepairModel ?? null,
                aiRepairReason: item.aiRepairReason ?? null,
                contentHash: item.contentHash,
                isDuplicate: item.isDuplicate,
                duplicateOfId: item.duplicateOfId ?? null,
                options: {
                  create: item.options.map((opt, idx) => ({
                    label: opt.id,
                    content: opt.content as unknown as Prisma.InputJsonValue,
                    isCorrect: item.answer.value.includes(opt.id),
                    displayOrder: idx + 1
                  }))
                }
              },
              include: { options: true }
            });
            results.push(mapPrismaQuestion(created));
          } else {
            // Existing question found at (importJobId, sourceOrder)
            const isReviewedOrPublished =
              existing.reviewStatus === "APPROVED" || existing.publishedToBank === true;

            if (isReviewedOrPublished && existing.contentHash === item.contentHash) {
              // Content unchanged: preserve educator's approved or published state completely!
              results.push(mapPrismaQuestion(existing));
              continue;
            }

            const contentChanged = existing.contentHash !== item.contentHash;
            let nextReviewStatus = item.reviewStatus;
            let nextPublishedToBank = existing.publishedToBank;
            let nextPublishedAt = existing.publishedAt;
            const currentWarnings = Array.isArray(existing.warnings)
              ? [...(existing.warnings as string[])]
              : [];

            if (isReviewedOrPublished && contentChanged) {
              // Underlying content changed on re-run: revoke publication and demote to NEEDS_ATTENTION
              nextReviewStatus = "NEEDS_ATTENTION";
              nextPublishedToBank = false;
              nextPublishedAt = null;
              const warningMsg =
                "Underlying question content changed during import re-run. Previous approval and publication were revoked; re-review required.";
              if (!currentWarnings.includes(warningMsg)) {
                currentWarnings.push(warningMsg);
              }
            }

            // Replace options
            await tx.option.deleteMany({ where: { questionId: existing.id } });

            const updated = await tx.question.update({
              where: { id: existing.id },
              data: {
                content: item.question as unknown as Prisma.InputJsonValue,
                explanation: item.explanation
                  ? (item.explanation as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                type: item.type,
                answerStatus: toPrismaAnswerStatus(item.answer.status) as any,
                answerProvenance: item.answerProvenance,
                reviewStatus: nextReviewStatus,
                publishedToBank: nextPublishedToBank,
                publishedAt: nextPublishedAt,
                sourcePage: item.sourcePage,
                sourcePageEnd: item.sourcePageEnd ?? null,
                sourceQuestionNumber: item.sourceQuestionNumber,
                sourceSection: item.sourceSection ?? null,
                confidence: item.confidence,
                sharedPassage: item.sharedPassage
                  ? (item.sharedPassage as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                boundingBox: item.boundingBox
                  ? (item.boundingBox as unknown as Prisma.InputJsonValue)
                  : Prisma.DbNull,
                warnings: currentWarnings as unknown as Prisma.InputJsonValue,
                aiRepaired: item.aiRepaired,
                aiRepairModel: item.aiRepairModel ?? null,
                aiRepairReason: item.aiRepairReason ?? null,
                contentHash: item.contentHash,
                isDuplicate: item.isDuplicate,
                duplicateOfId: item.duplicateOfId ?? null,
                options: {
                  create: item.options.map((opt, idx) => ({
                    label: opt.id,
                    content: opt.content as unknown as Prisma.InputJsonValue,
                    isCorrect: item.answer.value.includes(opt.id),
                    displayOrder: idx + 1
                  }))
                }
              },
              include: { options: true }
            });

            if (isReviewedOrPublished && contentChanged) {
              await tx.questionReviewLog.create({
                data: {
                  questionId: existing.id,
                  reviewerId: "system:import-retry",
                  action: "EDITED",
                  previousState: {
                    reviewStatus: existing.reviewStatus,
                    publishedToBank: existing.publishedToBank
                  } as Prisma.InputJsonValue,
                  newState: {
                    reviewStatus: "NEEDS_ATTENTION",
                    publishedToBank: false
                  } as Prisma.InputJsonValue,
                  notes:
                    "Import retry extracted altered content; revoked prior approval and publication."
                }
              });
            }

            results.push(mapPrismaQuestion(updated));
          }
        }
        return results;
      });
      return saved;
    }

    const store = await loadLocalStore();
    // Delete stale questions whose sourceOrder is not in the incoming set
    const incomingOrderSet = new Set(questions.map((q) => q.sourceOrder));
    for (const [qId, existing] of Object.entries(store.questions)) {
      if (existing.importJobId === importJobId && !incomingOrderSet.has(existing.sourceOrder)) {
        delete store.questions[qId];
      }
    }

    const results: QuestionRecord[] = [];
    const now = new Date();

    for (const item of questions) {
      const existing = Object.values(store.questions).find(
        (q) => q.importJobId === importJobId && q.sourceOrder === item.sourceOrder
      );

      if (!existing) {
        const id = `q_${crypto.randomBytes(10).toString("hex")}`;
        const record: QuestionRecord = {
          id,
          importJobId,
          sourceFileId: item.sourceFileId,
          question: item.question,
          options: item.options,
          answer: item.answer,
          explanation: item.explanation,
          type: item.type,
          sourcePage: item.sourcePage,
          sourcePageEnd: item.sourcePageEnd ?? null,
          sourceQuestionNumber: item.sourceQuestionNumber,
          sourceSection: item.sourceSection ?? null,
          sourceOrder: item.sourceOrder,
          confidence: item.confidence,
          answerProvenance: item.answerProvenance,
          reviewStatus: item.reviewStatus,
          sharedPassage: item.sharedPassage ?? null,
          boundingBox: item.boundingBox ?? null,
          warnings: item.warnings,
          aiRepaired: item.aiRepaired,
          aiRepairModel: item.aiRepairModel ?? null,
          aiRepairReason: item.aiRepairReason ?? null,
          contentHash: item.contentHash,
          isDuplicate: item.isDuplicate,
          duplicateOfId: item.duplicateOfId ?? null,
          is_active: true,
          publishedToBank: false,
          publishedAt: null,
          createdAt: now,
          updatedAt: now
        };
        store.questions[id] = record;
        results.push(record);
      } else {
        const isReviewedOrPublished =
          existing.reviewStatus === "APPROVED" || existing.publishedToBank === true;

        if (isReviewedOrPublished && existing.contentHash === item.contentHash) {
          // Content unchanged: preserve educator's approved or published state
          results.push(existing);
          continue;
        }

        const contentChanged = existing.contentHash !== item.contentHash;
        let nextReviewStatus = item.reviewStatus;
        let nextPublishedToBank = existing.publishedToBank;
        let nextPublishedAt = existing.publishedAt;
        const currentWarnings = [...existing.warnings];

        if (isReviewedOrPublished && contentChanged) {
          nextReviewStatus = "NEEDS_ATTENTION";
          nextPublishedToBank = false;
          nextPublishedAt = null;
          const warningMsg =
            "Underlying question content changed during import re-run. Previous approval and publication were revoked; re-review required.";
          if (!currentWarnings.includes(warningMsg)) {
            currentWarnings.push(warningMsg);
          }
        }

        const updated: QuestionRecord = {
          ...existing,
          question: item.question,
          options: item.options,
          answer: item.answer,
          explanation: item.explanation,
          type: item.type,
          sourcePage: item.sourcePage,
          sourcePageEnd: item.sourcePageEnd ?? null,
          sourceQuestionNumber: item.sourceQuestionNumber,
          sourceSection: item.sourceSection ?? null,
          confidence: item.confidence,
          answerProvenance: item.answerProvenance,
          reviewStatus: nextReviewStatus,
          sharedPassage: item.sharedPassage ?? null,
          boundingBox: item.boundingBox ?? null,
          warnings: currentWarnings,
          aiRepaired: item.aiRepaired,
          aiRepairModel: item.aiRepairModel ?? null,
          aiRepairReason: item.aiRepairReason ?? null,
          contentHash: item.contentHash,
          isDuplicate: item.isDuplicate,
          duplicateOfId: item.duplicateOfId ?? null,
          publishedToBank: nextPublishedToBank,
          publishedAt: nextPublishedAt,
          updatedAt: now
        };

        if (isReviewedOrPublished && contentChanged) {
          const logId = `log_${crypto.randomBytes(8).toString("hex")}`;
          store.reviewLogs[logId] = {
            id: logId,
            questionId: existing.id,
            reviewerId: "system:import-retry",
            action: "EDITED",
            previousState: {
              reviewStatus: existing.reviewStatus,
              publishedToBank: existing.publishedToBank
            },
            newState: {
              reviewStatus: "NEEDS_ATTENTION",
              publishedToBank: false
            },
            notes: "Import retry extracted altered content; revoked prior approval and publication.",
            createdAt: now
          };
        }

        store.questions[existing.id] = updated;
        results.push(updated);
      }
    }

    await persistLocalStore(store);
    return results;
  }

  async getQuestionsByImportJobId(importJobId: string): Promise<QuestionRecord[]> {
    if (await isPrismaAvailable()) {
      const rows = await prisma.question.findMany({
        where: { importJobId },
        include: { options: true },
        orderBy: { sourceOrder: "asc" }
      });
      return rows.map(mapPrismaQuestion);
    }
    const store = await loadLocalStore();
    return Object.values(store.questions)
      .filter((q) => q.importJobId === importJobId)
      .sort((a, b) => a.sourceOrder - b.sourceOrder);
  }

  async getQuestionById(id: string): Promise<QuestionRecord | null> {
    if (await isPrismaAvailable()) {
      const row = await prisma.question.findUnique({
        where: { id },
        include: { options: true }
      });
      return row ? mapPrismaQuestion(row) : null;
    }
    const store = await loadLocalStore();
    return store.questions[id] ?? null;
  }

  async updateQuestion(
    id: string,
    patch: Partial<
      Pick<
        QuestionRecord,
        | "question"
        | "options"
        | "answer"
        | "explanation"
        | "type"
        | "reviewStatus"
        | "sourceQuestionNumber"
        | "sourceSection"
        | "confidence"
        | "contentHash"
        | "publishedToBank"
        | "publishedAt"
        | "warnings"
      >
    >,
    logInfo?: { reviewerId: string; action: ReviewAction; notes?: string }
  ): Promise<QuestionRecord> {
    if (await isPrismaAvailable()) {
      return prisma.$transaction(async (tx) => {
        const previous = await tx.question.findUnique({
          where: { id },
          include: { options: true }
        });
        if (!previous) throw new Error(`Question ${id} not found`);

        const data: Prisma.QuestionUpdateInput = {};
        if (patch.question !== undefined)
          data.content = patch.question as unknown as Prisma.InputJsonValue;
        if (patch.explanation !== undefined)
          data.explanation = patch.explanation
            ? (patch.explanation as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull;
        if (patch.type !== undefined) data.type = patch.type;
        if (patch.reviewStatus !== undefined) data.reviewStatus = patch.reviewStatus;
        if (patch.sourceQuestionNumber !== undefined)
          data.sourceQuestionNumber = patch.sourceQuestionNumber;
        if (patch.sourceSection !== undefined) data.sourceSection = patch.sourceSection;
        if (patch.confidence !== undefined) data.confidence = patch.confidence;
        if (patch.contentHash !== undefined) data.contentHash = patch.contentHash;
        if (patch.publishedToBank !== undefined) data.publishedToBank = patch.publishedToBank;
        if (patch.publishedAt !== undefined) data.publishedAt = patch.publishedAt;
        if (patch.warnings !== undefined)
          data.warnings = patch.warnings as unknown as Prisma.InputJsonValue;
        if (patch.answer?.status !== undefined) {
          data.answerStatus = toPrismaAnswerStatus(patch.answer.status) as any;
        }

        // Relational option updates
        if (patch.options !== undefined) {
          const targetAnswerValue =
            patch.answer?.value ??
            previous.options.filter((o) => o.isCorrect).map((o) => o.label);

          await tx.option.deleteMany({ where: { questionId: id } });
          await tx.option.createMany({
            data: patch.options.map((opt, idx) => ({
              questionId: id,
              label: opt.id,
              content: opt.content as unknown as Prisma.InputJsonValue,
              isCorrect: targetAnswerValue.includes(opt.id),
              displayOrder: idx + 1
            }))
          });
        } else if (patch.answer?.value !== undefined) {
          const targetValue = new Set(patch.answer.value);
          for (const opt of previous.options) {
            const shouldBeCorrect = targetValue.has(opt.label);
            if (opt.isCorrect !== shouldBeCorrect) {
              await tx.option.update({
                where: { id: opt.id },
                data: { isCorrect: shouldBeCorrect }
              });
            }
          }
        }

        const updated = await tx.question.update({
          where: { id },
          data,
          include: { options: true }
        });

        if (logInfo) {
          await tx.questionReviewLog.create({
            data: {
              questionId: id,
              reviewerId: logInfo.reviewerId,
              action: logInfo.action,
              previousState: {
                reviewStatus: previous.reviewStatus,
                type: previous.type
              } as Prisma.InputJsonValue,
              newState: {
                reviewStatus: updated.reviewStatus,
                type: updated.type
              } as Prisma.InputJsonValue,
              notes: logInfo.notes ?? null
            }
          });
        }

        await this.recomputeImportReviewStatsPrisma(tx, updated.importJobId);
        return mapPrismaQuestion(updated);
      });
    }

    const store = await loadLocalStore();
    const existing = store.questions[id];
    if (!existing) throw new Error(`Question ${id} not found`);

    const updated: QuestionRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date()
    };
    store.questions[id] = updated;

    if (logInfo) {
      const logId = `log_${crypto.randomBytes(8).toString("hex")}`;
      store.reviewLogs[logId] = {
        id: logId,
        questionId: id,
        reviewerId: logInfo.reviewerId,
        action: logInfo.action,
        previousState: { reviewStatus: existing.reviewStatus, type: existing.type },
        newState: { reviewStatus: updated.reviewStatus, type: updated.type },
        notes: logInfo.notes ?? null,
        createdAt: new Date()
      };
    }

    await this.recomputeImportReviewStatsLocal(store, updated.importJobId);
    await persistLocalStore(store);
    return updated;
  }

  async bulkUpdateQuestionStatus(
    importJobId: string,
    questionIds: string[] | undefined,
    status: QuestionReviewStatus,
    reviewerId: string
  ): Promise<{ updatedCount: number }> {
    const publish = status === "APPROVED";
    const now = new Date();

    if (await isPrismaAvailable()) {
      return prisma.$transaction(async (tx) => {
        const whereClause: Prisma.QuestionWhereInput = {
          importJobId,
          ...(questionIds && questionIds.length > 0 ? { id: { in: questionIds } } : {})
        };
        const targets = await tx.question.findMany({ where: whereClause });
        await tx.question.updateMany({
          where: whereClause,
          data: {
            reviewStatus: status,
            publishedToBank: publish,
            publishedAt: publish ? now : null
          }
        });

        for (const q of targets) {
          await tx.questionReviewLog.create({
            data: {
              questionId: q.id,
              reviewerId,
              action: status === "APPROVED" ? "BULK_APPROVED" : "BULK_REJECTED",
              previousState: { reviewStatus: q.reviewStatus } as Prisma.InputJsonValue,
              newState: { reviewStatus: status } as Prisma.InputJsonValue
            }
          });
        }

        await this.recomputeImportReviewStatsPrisma(tx, importJobId);
        return { updatedCount: targets.length };
      });
    }

    const store = await loadLocalStore();
    const idSet = questionIds && questionIds.length > 0 ? new Set(questionIds) : null;
    let updatedCount = 0;

    for (const q of Object.values(store.questions)) {
      if (q.importJobId === importJobId && (!idSet || idSet.has(q.id))) {
        const prevStatus = q.reviewStatus;
        q.reviewStatus = status;
        q.publishedToBank = publish;
        q.publishedAt = publish ? now : null;
        q.updatedAt = now;
        updatedCount++;

        const logId = `log_${crypto.randomBytes(8).toString("hex")}`;
        store.reviewLogs[logId] = {
          id: logId,
          questionId: q.id,
          reviewerId,
          action: status === "APPROVED" ? "BULK_APPROVED" : "BULK_REJECTED",
          previousState: { reviewStatus: prevStatus },
          newState: { reviewStatus: status },
          notes: null,
          createdAt: now
        };
      }
    }

    await this.recomputeImportReviewStatsLocal(store, importJobId);
    await persistLocalStore(store);
    return { updatedCount };
  }

  private async recomputeImportReviewStatsPrisma(
    tx: Prisma.TransactionClient,
    importJobId: string
  ) {
    const allQuestions = await tx.question.findMany({ where: { importJobId } });
    const approvedCount = allQuestions.filter((q) => q.reviewStatus === "APPROVED").length;
    const needingReview = allQuestions.filter(
      (q) => q.reviewStatus === "PENDING_REVIEW" || q.reviewStatus === "NEEDS_ATTENTION"
    ).length;

    const job = await tx.importJob.findUnique({ where: { id: importJobId } });
    if (job) {
      const nextStatus: ImportStatus =
        allQuestions.length > 0 && needingReview === 0 ? "COMPLETED" : "REVIEW_REQUIRED";
      await tx.importJob.update({
        where: { id: importJobId },
        data: {
          approvedQuestionsCount: approvedCount,
          questionsRequiringReview: needingReview,
          status:
            job.status === "REVIEW_REQUIRED" || job.status === "COMPLETED"
              ? nextStatus
              : job.status
        }
      });
    }
  }

  private async recomputeImportReviewStatsLocal(
    store: LocalDbStore,
    importJobId: string
  ) {
    const allQuestions = Object.values(store.questions).filter(
      (q) => q.importJobId === importJobId
    );
    const approvedCount = allQuestions.filter((q) => q.reviewStatus === "APPROVED").length;
    const needingReview = allQuestions.filter(
      (q) => q.reviewStatus === "PENDING_REVIEW" || q.reviewStatus === "NEEDS_ATTENTION"
    ).length;
    const job = store.importJobs[importJobId];
    if (job) {
      job.approvedQuestionsCount = approvedCount;
      job.questionsRequiringReview = needingReview;
      if (job.status === "REVIEW_REQUIRED" || job.status === "COMPLETED") {
        job.status =
          allQuestions.length > 0 && needingReview === 0 ? "COMPLETED" : "REVIEW_REQUIRED";
      }
      job.updatedAt = new Date();
    }
  }

  async listQuestionBank(filters?: {
    search?: string;
    type?: QuestionType;
    reviewStatus?: QuestionReviewStatus;
    publishedOnly?: boolean;
  }): Promise<QuestionRecord[]> {
    if (await isPrismaAvailable()) {
      const where: Prisma.QuestionWhereInput = {};
      if (filters?.type) where.type = filters.type;
      if (filters?.reviewStatus) where.reviewStatus = filters.reviewStatus;
      if (filters?.publishedOnly) where.publishedToBank = true;
      const rows = await prisma.question.findMany({
        where,
        include: { options: true },
        orderBy: { createdAt: "desc" }
      });
      const mapped = rows.map(mapPrismaQuestion);
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        return mapped.filter((item) => JSON.stringify(item.question).toLowerCase().includes(q));
      }
      return mapped;
    }

    const store = await loadLocalStore();
    let list = Object.values(store.questions).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    if (filters?.type) list = list.filter((q) => q.type === filters.type);
    if (filters?.reviewStatus) list = list.filter((q) => q.reviewStatus === filters.reviewStatus);
    if (filters?.publishedOnly) list = list.filter((q) => q.publishedToBank);
    if (filters?.search) {
      const term = filters.search.toLowerCase();
      list = list.filter((q) => JSON.stringify(q.question).toLowerCase().includes(term));
    }
    return list;
  }

  async createAsset(data: {
    importJobId: string;
    questionId?: string | null;
    pageNumber?: number | null;
    assetType?: string;
    mimeType: string;
    storageKey: string;
    fileSize: number;
    width?: number | null;
    height?: number | null;
    sha256: string;
    altText?: string | null;
  }): Promise<QuestionAssetRecord> {
    if (await isPrismaAvailable()) {
      return prisma.questionAsset.create({
        data: {
          importJobId: data.importJobId,
          questionId: data.questionId ?? null,
          pageNumber: data.pageNumber ?? null,
          assetType: data.assetType ?? "IMAGE",
          mimeType: data.mimeType,
          storageKey: data.storageKey,
          fileSize: data.fileSize,
          width: data.width ?? null,
          height: data.height ?? null,
          sha256: data.sha256,
          altText: data.altText ?? null
        }
      });
    }

    const store = await loadLocalStore();
    const id = `ast_${crypto.randomBytes(8).toString("hex")}`;
    const record: QuestionAssetRecord = {
      id,
      importJobId: data.importJobId,
      questionId: data.questionId ?? null,
      pageNumber: data.pageNumber ?? null,
      assetType: data.assetType ?? "IMAGE",
      mimeType: data.mimeType,
      storageKey: data.storageKey,
      fileSize: data.fileSize,
      width: data.width ?? null,
      height: data.height ?? null,
      sha256: data.sha256,
      altText: data.altText ?? null,
      createdAt: new Date()
    };
    store.assets[id] = record;
    await persistLocalStore(store);
    return record;
  }

  async getAssetById(id: string): Promise<QuestionAssetRecord | null> {
    if (await isPrismaAvailable()) {
      return prisma.questionAsset.findUnique({ where: { id } });
    }
    const store = await loadLocalStore();
    return store.assets[id] ?? null;
  }

  async getAiRepairCache(inputHash: string): Promise<{
    model: string;
    repairedJson: unknown;
    inputTokens: number;
    outputTokens: number;
  } | null> {
    if (await isPrismaAvailable()) {
      const row = await prisma.aiRepairCache.findUnique({ where: { inputHash } });
      return row
        ? {
            model: row.model,
            repairedJson: row.repairedJson,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens
          }
        : null;
    }
    const store = await loadLocalStore();
    return store.aiCache[inputHash] ?? null;
  }

  async setAiRepairCache(data: {
    inputHash: string;
    model: string;
    repairedJson: unknown;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void> {
    if (await isPrismaAvailable()) {
      await prisma.aiRepairCache.upsert({
        where: { inputHash: data.inputHash },
        create: {
          inputHash: data.inputHash,
          model: data.model,
          repairedJson: data.repairedJson as Prisma.InputJsonValue,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens
        },
        update: {
          model: data.model,
          repairedJson: data.repairedJson as Prisma.InputJsonValue,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens
        }
      });
      return;
    }
    const store = await loadLocalStore();
    store.aiCache[data.inputHash] = data;
    await persistLocalStore(store);
  }

  async getOcrCache(imageHash: string): Promise<{
    provider: string;
    ocrResult: unknown;
    confidence: number;
  } | null> {
    if (await isPrismaAvailable()) {
      const row = await prisma.ocrCache.findUnique({ where: { imageHash } });
      return row
        ? {
            provider: row.provider,
            ocrResult: row.ocrResult,
            confidence: row.confidence
          }
        : null;
    }
    const store = await loadLocalStore();
    return store.ocrCache[imageHash] ?? null;
  }

  async setOcrCache(data: {
    imageHash: string;
    provider: string;
    ocrResult: unknown;
    confidence: number;
  }): Promise<void> {
    if (await isPrismaAvailable()) {
      await prisma.ocrCache.upsert({
        where: { imageHash: data.imageHash },
        create: {
          imageHash: data.imageHash,
          provider: data.provider,
          ocrResult: data.ocrResult as Prisma.InputJsonValue,
          confidence: data.confidence
        },
        update: {
          provider: data.provider,
          ocrResult: data.ocrResult as Prisma.InputJsonValue,
          confidence: data.confidence
        }
      });
      return;
    }
    const store = await loadLocalStore();
    store.ocrCache[data.imageHash] = data;
    await persistLocalStore(store);
  }
}

export const questionBankRepo = new QuestionBankRepository();
