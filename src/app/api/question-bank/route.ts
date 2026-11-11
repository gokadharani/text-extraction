import { NextRequest, NextResponse } from "next/server";
import { QuestionType, QuestionReviewStatus } from "@prisma/client";
import { withApiProtection } from "@/lib/auth/security";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { serializeQuestion } from "@/lib/api-serializers";

export async function GET(req: NextRequest) {
  const guard = withApiProtection(req);
  if (!guard.ok) return guard.response;

  const search = req.nextUrl.searchParams.get("search") || undefined;
  const typeParam = req.nextUrl.searchParams.get("type") as QuestionType | null;
  const statusParam = req.nextUrl.searchParams.get("reviewStatus") as QuestionReviewStatus | null;
  const publishedOnly = req.nextUrl.searchParams.get("publishedOnly") === "true";

  const questions = await questionBankRepo.listQuestionBank({
    search,
    type: typeParam || undefined,
    reviewStatus: statusParam || undefined,
    publishedOnly
  });

  return NextResponse.json({
    total: questions.length,
    questions: questions.map(serializeQuestion)
  });
}
