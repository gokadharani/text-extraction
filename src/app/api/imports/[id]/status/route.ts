import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { questionBankRepo } from "@/repositories/question-bank.repository";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = withApiProtection(req);
  if (!guard.ok) return guard.response;

  const job = await questionBankRepo.getImportJobById(params.id);
  if (!job) {
    return apiErrorResponse("IMPORT_NOT_FOUND", `Import job "${params.id}" not found.`, 404);
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    currentStage: job.currentStage,
    progressPercent: job.progressPercent,
    totalPages: job.totalPages,
    pagesProcessed: job.pagesProcessed,
    totalExtractedQuestions: job.totalExtractedQuestions,
    questionsRequiringReview: job.questionsRequiringReview,
    approvedQuestionsCount: job.approvedQuestionsCount,
    ocrMethod: job.ocrMethod,
    ocrDurationMs: job.ocrDurationMs,
    aiUsed: job.aiUsed,
    aiModel: job.aiModel,
    aiInputTokens: job.aiInputTokens,
    aiOutputTokens: job.aiOutputTokens,
    estimatedAiCostUsd: job.estimatedAiCostUsd,
    processingDurationMs: job.processingDurationMs,
    errorMessage: job.errorMessage,
    errorCode: job.errorCode,
    updatedAt: job.updatedAt
  });
}
