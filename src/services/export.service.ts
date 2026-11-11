import ExcelJS from "exceljs";
import { ImportJobRecord, QuestionRecord } from "@/repositories/question-bank.repository";
import { tiptapDocToPlainText } from "@/domain/richtext/tiptap-converter";

export type ExportFormat = "json" | "xlsx" | "csv" | "report";

export interface ExportResult {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export async function generateImportExport(
  job: ImportJobRecord,
  questions: QuestionRecord[],
  format: ExportFormat
): Promise<ExportResult> {
  const safeBaseName = job.fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");

  if (format === "json") {
    // Preserve full rich-text Tiptap JSON without flattening to plain text
    const payload = {
      importJobId: job.id,
      fileName: job.fileName,
      exportedAt: new Date().toISOString(),
      totalQuestions: questions.length,
      questions: questions.map((q) => ({
        id: q.id,
        sourceOrder: q.sourceOrder,
        sourceQuestionNumber: q.sourceQuestionNumber,
        sourceSection: q.sourceSection,
        sourcePage: q.sourcePage,
        sourcePageEnd: q.sourcePageEnd,
        type: q.type,
        reviewStatus: q.reviewStatus,
        confidence: q.confidence,
        answerProvenance: q.answerProvenance,
        aiRepaired: q.aiRepaired,
        isDuplicate: q.isDuplicate,
        question: q.question,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation,
        sharedPassage: q.sharedPassage,
        warnings: q.warnings
      }))
    };

    return {
      buffer: Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
      contentType: "application/json",
      fileName: `${safeBaseName}-questions.json`
    };
  }

  if (format === "csv") {
    const headers = [
      "ID",
      "Source Order",
      "Source Question Number",
      "Section",
      "Page Number",
      "Question Type",
      "Review Status",
      "Confidence",
      "Answer Provenance",
      "Question Text",
      "Options",
      "Correct Answer",
      "Explanation",
      "Warnings"
    ];

    const rows = questions.map((q) => {
      const stemText = tiptapDocToPlainText(q.question);
      const optionsText = q.options
        .map((opt) => `(${opt.id}) ${tiptapDocToPlainText(opt.content)}`)
        .join(" | ");
      const answerText = q.answer.value.join(", ");
      const explanationText = q.explanation ? tiptapDocToPlainText(q.explanation) : "";

      return [
        q.id,
        String(q.sourceOrder),
        q.sourceQuestionNumber,
        q.sourceSection || "",
        String(q.sourcePage),
        q.type,
        q.reviewStatus,
        String(q.confidence),
        q.answerProvenance,
        stemText,
        optionsText,
        answerText,
        explanationText,
        q.warnings.join("; ")
      ].map(escapeCsvCell);
    });

    const csvString = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    return {
      buffer: Buffer.from(csvString, "utf8"),
      contentType: "text/csv; charset=utf-8",
      fileName: `${safeBaseName}-questions.csv`
    };
  }

  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Extracted Questions");

    sheet.columns = [
      { header: "ID", key: "id", width: 20 },
      { header: "Order", key: "sourceOrder", width: 8 },
      { header: "Question No", key: "sourceQuestionNumber", width: 14 },
      { header: "Section", key: "sourceSection", width: 16 },
      { header: "Page", key: "sourcePage", width: 8 },
      { header: "Type", key: "type", width: 14 },
      { header: "Review Status", key: "reviewStatus", width: 18 },
      { header: "Confidence", key: "confidence", width: 12 },
      { header: "Provenance", key: "answerProvenance", width: 18 },
      { header: "Question", key: "questionText", width: 50 },
      { header: "Option A", key: "optA", width: 25 },
      { header: "Option B", key: "optB", width: 25 },
      { header: "Option C", key: "optC", width: 25 },
      { header: "Option D", key: "optD", width: 25 },
      { header: "Answer", key: "answer", width: 16 },
      { header: "Explanation", key: "explanation", width: 40 },
      { header: "Rich-Text JSON", key: "richJson", width: 40 }
    ];

    for (const q of questions) {
      const optMap = new Map(
        q.options.map((o) => [o.id.toUpperCase(), tiptapDocToPlainText(o.content)])
      );
      sheet.addRow({
        id: q.id,
        sourceOrder: q.sourceOrder,
        sourceQuestionNumber: q.sourceQuestionNumber,
        sourceSection: q.sourceSection || "",
        sourcePage: q.sourcePage,
        type: q.type,
        reviewStatus: q.reviewStatus,
        confidence: q.confidence,
        answerProvenance: q.answerProvenance,
        questionText: tiptapDocToPlainText(q.question),
        optA: optMap.get("A") || optMap.get("TRUE") || "",
        optB: optMap.get("B") || optMap.get("FALSE") || "",
        optC: optMap.get("C") || "",
        optD: optMap.get("D") || "",
        answer: q.answer.value.join(", "),
        explanation: q.explanation ? tiptapDocToPlainText(q.explanation) : "",
        richJson: JSON.stringify({
          question: q.question,
          options: q.options,
          answer: q.answer,
          explanation: q.explanation
        })
      });
    }

    const xlsxArrayBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(xlsxArrayBuffer),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: `${safeBaseName}-questions.xlsx`
    };
  }

  // Import Extraction Report
  const report = {
    reportType: "QUESTION_EXTRACTION_AUDIT_REPORT",
    generatedAt: new Date().toISOString(),
    importSummary: {
      importJobId: job.id,
      fileName: job.fileName,
      detectedFormat: job.detectedFormat,
      userDeclaredFormat: job.userDeclaredFormat || "AUTO_DETECT",
      formatMismatchWarning:
        job.userDeclaredFormat &&
        job.userDeclaredFormat !== "AUTO_DETECT" &&
        !job.detectedFormat.includes(job.userDeclaredFormat)
          ? `Declared as ${job.userDeclaredFormat}, detected as ${job.detectedFormat}. Extracted using authoritative ${job.detectedFormat} pipeline.`
          : null,
      status: job.status,
      uploadedAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() || null,
      totalPages: job.totalPages,
      pagesProcessed: job.pagesProcessed,
      processingDurationMs: job.processingDurationMs
    },
    ocrMetrics: {
      ocrMethod: job.ocrMethod || "NONE (Digital Extraction)",
      ocrDurationMs: job.ocrDurationMs
    },
    aiRepairMetrics: {
      aiUsed: job.aiUsed,
      aiModel: job.aiModel,
      inputTokens: job.aiInputTokens,
      outputTokens: job.aiOutputTokens,
      estimatedCostUsd: job.estimatedAiCostUsd,
      budgetCapUsd: job.aiBudgetUsd
    },
    questionMetrics: {
      totalExtracted: questions.length,
      byType: {
        MCQ: questions.filter((q) => q.type === "MCQ").length,
        MSQ: questions.filter((q) => q.type === "MSQ").length,
        TRUE_FALSE: questions.filter((q) => q.type === "TRUE_FALSE").length,
        UNKNOWN: questions.filter((q) => q.type === "UNKNOWN").length
      },
      byReviewStatus: {
        APPROVED: questions.filter((q) => q.reviewStatus === "APPROVED").length,
        PENDING_REVIEW: questions.filter((q) => q.reviewStatus === "PENDING_REVIEW").length,
        NEEDS_ATTENTION: questions.filter((q) => q.reviewStatus === "NEEDS_ATTENTION").length,
        REJECTED: questions.filter((q) => q.reviewStatus === "REJECTED").length
      },
      duplicatesDetected: questions.filter((q) => q.isDuplicate).length,
      aiRepairedCount: questions.filter((q) => q.aiRepaired).length
    },
    questionAuditTrail: questions.map((q) => ({
      id: q.id,
      sourceQuestionNumber: q.sourceQuestionNumber,
      sourcePage: q.sourcePage,
      type: q.type,
      reviewStatus: q.reviewStatus,
      confidence: q.confidence,
      answerProvenance: q.answerProvenance,
      aiRepaired: q.aiRepaired,
      isDuplicate: q.isDuplicate,
      warnings: q.warnings
    }))
  };

  return {
    buffer: Buffer.from(JSON.stringify(report, null, 2), "utf8"),
    contentType: "application/json",
    fileName: `${safeBaseName}-extraction-report.json`
  };
}
