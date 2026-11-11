import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { serializeQuestion } from "@/lib/api-serializers";

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

  const questions = await questionBankRepo.getQuestionsByImportJobId(params.id);

  return NextResponse.json({
    importJobId: params.id,
    total: questions.length,
    questions: questions.map(serializeQuestion)
  });
}
