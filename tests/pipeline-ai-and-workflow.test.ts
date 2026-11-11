import { describe, it, expect, beforeEach } from "vitest";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { LocalPrivateStorageAdapter } from "@/lib/storage/storage-provider";
import { segmentAndParseQuestions } from "@/domain/extraction/question-segmenter";
import {
  AiRepairClient,
  SelectiveAIRepairService
} from "@/adapters/ai/selective-ai-repair";
import { ImportPipelineService } from "@/services/import-pipeline.service";
import { cancelQueuedImportJob } from "@/queue/import-queue";
import { generateImportExport } from "@/services/export.service";
import { buildValidPdfBuffer } from "@/lib/sample-documents";
import { textToTiptapDoc } from "@/domain/richtext/tiptap-converter";
import {
  toDomainAnswerType,
  toPrismaQuestionType,
  toDomainAnswerStatus,
  toPrismaAnswerStatus
} from "@/domain/schemas/question.schema";

describe("Selective AI Repair, Idempotent Pipeline, Approval Workflow & Exports", () => {
  beforeEach(async () => {
    await questionBankRepo.resetForTests();
  });

  it("1. Selective AI Repair: skips well-formed MCQs, repairs malformed candidates, tracks tokens/cost, and enforces budget cap", async () => {
    const rawText = [
      "Section A - Single Choice Questions (MCQ)",
      "Q1. Well-formed MCQ that must NOT be sent to OpenAI?",
      "(A) Option 1",
      "(B) Option 2",
      "(C) Option 3",
      "(D) Option 4",
      "Answer: A",
      "",
      "Q2. Malformed question with broken option labels jumping from A to D?",
      "(A) First choice",
      "(D) Mislabelled second choice",
      "",
      "Q3. Another malformed question that will exceed the tight AI budget?",
      "(A) Choice 1",
      "(D) Choice 2"
    ].join("\n");

    const candidates = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(candidates.length).toBe(3);
    expect(candidates[0].needsAiRepair).toBe(false);
    expect(candidates[1].needsAiRepair).toBe(true);
    expect(candidates[2].needsAiRepair).toBe(true);

    let aiCallCount = 0;
    const mockAiClient: AiRepairClient = {
      async completeStructuredRepair() {
        aiCallCount++;
        return {
          parsed: {
            questionStemMarkdown:
              "Malformed question with broken option labels jumping from A to D?",
            questionType: "MCQ",
            options: [
              { id: "A", textMarkdown: "First choice" },
              { id: "B", textMarkdown: "Repaired second choice" }
            ],
            explicitAnswerValues: [],
            answerIsExplicitInText: false,
            explanationMarkdown: null,
            confidence: 0.88,
            repairNotes: "Normalized option label (D) to (B)."
          },
          inputTokens: 100_000, // Large token count to trigger budget cap after 1st call
          outputTokens: 50_000
        };
      }
    };

    const aiService = new SelectiveAIRepairService(mockAiClient);
    // Set budget to $0.02 so 1st call succeeds (~$0.045) and 2nd malformed question hits budget cap
    const summary = await aiService.repairCandidatesSelectively(candidates, 0.02);

    // Q1 was skipped, Q2 called AI, Q3 was skipped due to budget cap!
    expect(aiCallCount).toBe(1);
    expect(summary.aiUsed).toBe(true);
    expect(summary.budgetExceeded).toBe(true);
    expect(summary.candidates[0].payload.aiRepaired).toBe(false);
    expect(summary.candidates[1].payload.aiRepaired).toBe(true);
    expect(summary.candidates[1].payload.options.map((o) => o.id)).toEqual(["A", "B"]);
    expect(summary.candidates[2].payload.aiRepaired).toBe(false);
    expect(
      summary.candidates[2].payload.warnings.some((w) => w.includes("budget"))
    ).toBe(true);
  });

  it("2. Selective AI Repair: rejects invalid AI output failing Zod schema validation and preserves deterministic fallback", async () => {
    const candidates = segmentAndParseQuestions([
      {
        pageNumber: 1,
        text: "Q1. Malformed question with only one option?\n(A) Only one option"
      }
    ]);

    const invalidAiClient: AiRepairClient = {
      async completeStructuredRepair() {
        return {
          parsed: {
            // Missing required fields & invalid questionType
            questionStemMarkdown: "",
            questionType: "INVALID_TYPE"
          },
          inputTokens: 150,
          outputTokens: 50
        };
      }
    };

    const aiService = new SelectiveAIRepairService(invalidAiClient);
    const summary = await aiService.repairCandidatesSelectively(candidates, 0.5);

    expect(summary.candidates[0].payload.aiRepaired).toBe(false);
    expect(summary.candidates[0].payload.reviewStatus).toBe("NEEDS_ATTENTION");
    expect(
      summary.candidates[0].payload.warnings.some((w) =>
        w.includes("AI repair validation failed")
      )
    ).toBe(true);
  });

  it("3. Pipeline Idempotency & Job Retries: retrying a job does not create duplicate questions", async () => {
    const storage = new LocalPrivateStorageAdapter("./.private-storage/test-runs");
    const pdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          digitalText: [
            "Section A - Single Choice Questions (MCQ)",
            "Q1. What is $2 + 2$?",
            "(A) 3",
            "(B) 4",
            "Answer: B",
            "",
            "Q2. What is $5 \\times 5$?",
            "(A) 20",
            "(B) 25",
            "Answer: B"
          ].join("\n")
        }
      ]
    });

    const stored = await storage.putObject({
      keyPrefix: "uploads",
      fileName: "retry-test.pdf",
      buffer: pdfBuf,
      contentType: "application/pdf"
    });

    const job = await questionBankRepo.createImportJob({
      fileName: "retry-test.pdf",
      originalMimeType: "application/pdf",
      fileSize: pdfBuf.byteLength,
      fileSha256: stored.sha256,
      storageKey: stored.storageKey
    });

    const pipeline = new ImportPipelineService({ storage });

    // Run 1
    const firstRun = await pipeline.processImportJob(job.id, pdfBuf);
    expect(firstRun.questions.length).toBe(2);

    // Run 2 (Retry)
    const secondRun = await pipeline.processImportJob(job.id, pdfBuf);
    expect(secondRun.questions.length).toBe(2);

    const allInDb = await questionBankRepo.getQuestionsByImportJobId(job.id);
    expect(allInDb.length).toBe(2);
    expect(allInDb[0].id).toBe(firstRun.questions[0].id);

    await storage.deleteObject(stored.storageKey);
  });

  it("4. Import Cancellation, Review Edits, Approval Workflow & Multi-Format Export (JSON, CSV, XLSX, Report)", async () => {
    const storage = new LocalPrivateStorageAdapter("./.private-storage/test-runs");
    const pdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          digitalText: [
            "Section A - MCQ",
            "Q1. Evaluate $\\lim_{x \\to 0} \\frac{\\sin x}{x}$:",
            "(A) $0$",
            "(B) $1$",
            "(C) $\\infty$",
            "(D) Does not exist",
            "Answer: B",
            "Explanation: Standard trigonometric limit equals $1$."
          ].join("\n")
        }
      ]
    });

    const stored = await storage.putObject({
      keyPrefix: "uploads",
      fileName: "calculus.pdf",
      buffer: pdfBuf,
      contentType: "application/pdf"
    });

    const job = await questionBankRepo.createImportJob({
      fileName: "calculus.pdf",
      originalMimeType: "application/pdf",
      fileSize: pdfBuf.byteLength,
      fileSha256: stored.sha256,
      storageKey: stored.storageKey
    });

    const pipeline = new ImportPipelineService({ storage });
    const { questions } = await pipeline.processImportJob(job.id, pdfBuf);
    expect(questions.length).toBe(1);

    // Edit Question Rich-Text JSON
    const editedDoc = textToTiptapDoc("Evaluate the fundamental limit $\\lim_{x \\to 0} \\frac{\\sin x}{x}$:");
    const updatedQ = await questionBankRepo.updateQuestion(
      questions[0].id,
      { question: editedDoc },
      { reviewerId: "usr_1", action: "EDITED" }
    );
    expect(JSON.stringify(updatedQ.question)).toContain("fundamental limit");

    // Approve Question via bulk-approve
    const bulkRes = await questionBankRepo.bulkUpdateQuestionStatus(
      job.id,
      undefined,
      "APPROVED",
      "usr_1"
    );
    expect(bulkRes.updatedCount).toBe(1);

    const updatedJob = await questionBankRepo.getImportJobById(job.id);
    expect(updatedJob?.status).toBe("COMPLETED");
    expect(updatedJob?.approvedQuestionsCount).toBe(1);

    const bankQuestions = await questionBankRepo.listQuestionBank({ publishedOnly: true });
    expect(bankQuestions.length).toBe(1);

    // Export JSON (must preserve rich-text JSON object structure)
    const jsonExport = await generateImportExport(updatedJob!, bankQuestions, "json");
    const parsedExport = JSON.parse(jsonExport.buffer.toString("utf8"));
    expect(parsedExport.questions[0].question.type).toBe("doc");
    expect(parsedExport.questions[0].sourceQuestionNumber).toBe("Q1");
    expect(parsedExport.questions[0].sourcePage).toBe(1);
    expect(parsedExport.questions[0].type).toBe("MCQ");
    expect(parsedExport.questions[0].reviewStatus).toBe("APPROVED");

    // Export CSV
    const csvExport = await generateImportExport(updatedJob!, bankQuestions, "csv");
    const csvText = csvExport.buffer.toString("utf8");
    expect(csvText).toContain("Source Question Number");
    expect(csvText).toContain("APPROVED");

    // Export XLSX
    const xlsxExport = await generateImportExport(updatedJob!, bankQuestions, "xlsx");
    expect(xlsxExport.buffer.byteLength).toBeGreaterThan(100);

    // Export Report
    const reportExport = await generateImportExport(updatedJob!, bankQuestions, "report");
    const reportJson = JSON.parse(reportExport.buffer.toString("utf8"));
    expect(reportJson.reportType).toBe("QUESTION_EXTRACTION_AUDIT_REPORT");

    // Test cancelling a separate queued job
    const queuedJob = await questionBankRepo.createImportJob({
      fileName: "to-cancel.pdf",
      originalMimeType: "application/pdf",
      fileSize: 1024,
      fileSha256: "abc123sha",
      storageKey: stored.storageKey
    });
    await cancelQueuedImportJob(queuedJob.id);
    const cancelledState = await questionBankRepo.getImportJobById(queuedJob.id);
    expect(cancelledState?.status).toBe("FAILED");
    expect(cancelledState?.errorCode).toBe("JOB_CANCELLED");

    await storage.deleteObject(stored.storageKey);
  });

  it("5. Protected Reviewed & Published Questions: preserves approved questions on identical re-runs, revokes publication on content change", async () => {
    const job = await questionBankRepo.createImportJob({
      fileName: "biology.pdf",
      originalMimeType: "application/pdf",
      fileSize: 1024,
      fileSha256: "bio_sha_123",
      storageKey: "bio_key_123"
    });

    const initialDoc = textToTiptapDoc("What is the powerhouse of the cell?");
    const options = [
      { id: "A", content: textToTiptapDoc("Mitochondria") },
      { id: "B", content: textToTiptapDoc("Ribosome") }
    ];

    // Stage question
    const staged = await questionBankRepo.saveStagingQuestionsTransactional(job.id, [
      {
        question: initialDoc,
        options,
        answer: { type: "mcq", value: ["A"], status: "extracted" },
        explanation: textToTiptapDoc("Mitochondria generate ATP."),
        type: "MCQ",
        sourceFileId: "file_1",
        sourcePage: 1,
        sourceQuestionNumber: "1",
        sourceOrder: 1,
        confidence: 0.99,
        answerProvenance: "EXPLICIT_SOURCE",
        reviewStatus: "PENDING_REVIEW",
        warnings: [],
        aiRepaired: false,
        contentHash: "hash_original_123",
        isDuplicate: false
      }
    ]);
    expect(staged.length).toBe(1);

    // Educator approves and publishes question
    await questionBankRepo.updateQuestion(
      staged[0].id,
      { reviewStatus: "APPROVED", publishedToBank: true, publishedAt: new Date() },
      { reviewerId: "educator_1", action: "APPROVED" }
    );

    const approvedQ = await questionBankRepo.getQuestionById(staged[0].id);
    expect(approvedQ?.reviewStatus).toBe("APPROVED");
    expect(approvedQ?.publishedToBank).toBe(true);

    // Sub-case 1: Retry import with identical contentHash -> must NOT overwrite approved/published state
    const retryIdentical = await questionBankRepo.saveStagingQuestionsTransactional(job.id, [
      {
        question: initialDoc,
        options,
        answer: { type: "mcq", value: ["A"], status: "extracted" },
        explanation: textToTiptapDoc("Mitochondria generate ATP."),
        type: "MCQ",
        sourceFileId: "file_1",
        sourcePage: 1,
        sourceQuestionNumber: "1",
        sourceOrder: 1,
        confidence: 0.99,
        answerProvenance: "EXPLICIT_SOURCE",
        reviewStatus: "PENDING_REVIEW",
        warnings: [],
        aiRepaired: false,
        contentHash: "hash_original_123",
        isDuplicate: false
      }
    ]);
    expect(retryIdentical[0].reviewStatus).toBe("APPROVED");
    expect(retryIdentical[0].publishedToBank).toBe(true);

    // Sub-case 2: Retry import with ALTERED contentHash -> must revoke publication, demote to NEEDS_ATTENTION, append warning
    const alteredDoc = textToTiptapDoc("What is the primary function of chloroplasts?");
    const retryAltered = await questionBankRepo.saveStagingQuestionsTransactional(job.id, [
      {
        question: alteredDoc,
        options: [
          { id: "A", content: textToTiptapDoc("Photosynthesis") },
          { id: "B", content: textToTiptapDoc("Cellular respiration") }
        ],
        answer: { type: "mcq", value: ["A"], status: "extracted" },
        explanation: null,
        type: "MCQ",
        sourceFileId: "file_1",
        sourcePage: 1,
        sourceQuestionNumber: "1",
        sourceOrder: 1,
        confidence: 0.95,
        answerProvenance: "EXPLICIT_SOURCE",
        reviewStatus: "PENDING_REVIEW",
        warnings: [],
        aiRepaired: false,
        contentHash: "hash_altered_456",
        isDuplicate: false
      }
    ]);
    expect(retryAltered[0].reviewStatus).toBe("NEEDS_ATTENTION");
    expect(retryAltered[0].publishedToBank).toBe(false);
    expect(retryAltered[0].publishedAt).toBeNull();
    expect(
      retryAltered[0].warnings.some((w) =>
        w.includes("Previous approval and publication were revoked")
      )
    ).toBe(true);
  });

  it("6. Precise Stale-Question Deletion: deletes only omitted source orders by exact set comparison", async () => {
    const job = await questionBankRepo.createImportJob({
      fileName: "physics.pdf",
      originalMimeType: "application/pdf",
      fileSize: 2048,
      fileSha256: "phys_sha_789",
      storageKey: "phys_key_789"
    });

    const createCandidate = (order: number) => ({
      question: textToTiptapDoc(`Physics Question ${order}`),
      options: [
        { id: "A", content: textToTiptapDoc("Option 1") },
        { id: "B", content: textToTiptapDoc("Option 2") }
      ],
      answer: { type: "mcq" as const, value: ["A"], status: "extracted" as const },
      explanation: null,
      type: "MCQ" as const,
      sourceFileId: "file_phys",
      sourcePage: 1,
      sourceQuestionNumber: `${order}`,
      sourceOrder: order,
      confidence: 1.0,
      answerProvenance: "EXPLICIT_SOURCE" as const,
      reviewStatus: "PENDING_REVIEW" as const,
      warnings: [],
      aiRepaired: false,
      contentHash: `phys_hash_${order}`,
      isDuplicate: false
    });

    // Initial import stages questions 1, 2, 3, 4
    await questionBankRepo.saveStagingQuestionsTransactional(job.id, [
      createCandidate(1),
      createCandidate(2),
      createCandidate(3),
      createCandidate(4)
    ]);
    const initialList = await questionBankRepo.getQuestionsByImportJobId(job.id);
    expect(initialList.map((q) => q.sourceOrder)).toEqual([1, 2, 3, 4]);

    // Retry import extracts questions 1, 2, 4 (question 3 was omitted/merged)
    await questionBankRepo.saveStagingQuestionsTransactional(job.id, [
      createCandidate(1),
      createCandidate(2),
      createCandidate(4)
    ]);
    const afterRetryList = await questionBankRepo.getQuestionsByImportJobId(job.id);

    // Question 3 must be deleted, questions 1, 2, and 4 must remain!
    expect(afterRetryList.map((q) => q.sourceOrder)).toEqual([1, 2, 4]);
  });

  it("7. Domain Enum Compatibility & Mappers: validates type safety and bidirectional conversion", () => {
    // QuestionType <-> AnswerType mapping
    expect(toDomainAnswerType("MCQ")).toBe("mcq");
    expect(toDomainAnswerType("MSQ")).toBe("msq");
    expect(toDomainAnswerType("TRUE_FALSE")).toBe("true_false");
    expect(toDomainAnswerType("UNKNOWN")).toBe("unknown");

    expect(toPrismaQuestionType("mcq")).toBe("MCQ");
    expect(toPrismaQuestionType("msq")).toBe("MSQ");
    expect(toPrismaQuestionType("true_false")).toBe("TRUE_FALSE");
    expect(toPrismaQuestionType("unknown")).toBe("UNKNOWN");

    // AnswerStatus mapping
    expect(toDomainAnswerStatus("EXTRACTED")).toBe("extracted");
    expect(toDomainAnswerStatus("ANSWER_KEY")).toBe("answer_key");
    expect(toDomainAnswerStatus("AI_INFERRED")).toBe("ai_inferred");
    expect(toDomainAnswerStatus("MISSING")).toBe("missing");
    expect(toDomainAnswerStatus("UNCERTAIN")).toBe("uncertain");
    expect(toDomainAnswerStatus("VERIFIED")).toBe("verified");

    expect(toPrismaAnswerStatus("extracted")).toBe("EXTRACTED");
    expect(toPrismaAnswerStatus("answer_key")).toBe("ANSWER_KEY");
    expect(toPrismaAnswerStatus("ai_inferred")).toBe("AI_INFERRED");
    expect(toPrismaAnswerStatus("missing")).toBe("MISSING");
    expect(toPrismaAnswerStatus("uncertain")).toBe("UNCERTAIN");
    expect(toPrismaAnswerStatus("verified")).toBe("VERIFIED");
  });
});
