import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { serializeQuestion } from "@/lib/api-serializers";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = withApiProtection(req);
  if (!guard.ok) return guard.response;

  const existing = await questionBankRepo.getQuestionById(params.id);
  if (!existing) {
    return apiErrorResponse("QUESTION_NOT_FOUND", `Question "${params.id}" not found.`, 404);
  }

  const updated = await questionBankRepo.updateQuestion(
    params.id,
    {
      reviewStatus: "REJECTED",
      publishedToBank: false,
      publishedAt: null
    },
    {
      reviewerId: guard.actor.userId,
      action: "REJECTED"
    }
  );

  return NextResponse.json({
    rejected: true,
    question: serializeQuestion(updated)
  });
}
