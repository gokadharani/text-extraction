import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { QuestionUpdateRequestSchema } from "@/domain/schemas/question.schema";
import { computeQuestionContentHash } from "@/domain/richtext/tiptap-converter";
import { serializeQuestion } from "@/lib/api-serializers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = withApiProtection(req);
  if (!guard.ok) return guard.response;

  const existing = await questionBankRepo.getQuestionById(params.id);
  if (!existing) {
    return apiErrorResponse("QUESTION_NOT_FOUND", `Question "${params.id}" not found.`, 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiErrorResponse("INVALID_JSON", "Request body must be valid JSON.", 400);
  }

  const parsed = QuestionUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiErrorResponse(
      "VALIDATION_ERROR",
      "Question update failed Rich-Text JSON schema validation.",
      422,
      parsed.error.flatten()
    );
  }

  const nextQuestionDoc = parsed.data.question ?? existing.question;
  const nextOptions = parsed.data.options ?? existing.options ?? [];
  const nextType = parsed.data.type ?? existing.type;
  const nextAnswer = parsed.data.answer ?? existing.answer;

  if (Array.isArray(nextOptions) && nextOptions.length > 0 && nextAnswer?.value && nextAnswer.value.length > 0) {
    const validOptionIds = new Set(nextOptions.map((o) => o.id));
    const invalidIds = nextAnswer.value.filter((id) => !validOptionIds.has(id));
    if (invalidIds.length > 0) {
      return apiErrorResponse(
        "INVALID_OPTION_ID",
        `Invalid option ID(s) in answer: ${invalidIds.join(", ")}. Must be one of: ${Array.from(validOptionIds).join(", ")}.`,
        422
      );
    }
  }

  const contentHash = computeQuestionContentHash(nextQuestionDoc, nextOptions, nextType);

  const updated = await questionBankRepo.updateQuestion(
    params.id,
    {
      question: parsed.data.question,
      options: parsed.data.options,
      answer: parsed.data.answer,
      explanation: parsed.data.explanation,
      type: parsed.data.type,
      reviewStatus: parsed.data.reviewStatus,
      sourceQuestionNumber: parsed.data.sourceQuestionNumber,
      sourceSection: parsed.data.sourceSection,
      contentHash,
      publishedToBank:
        parsed.data.reviewStatus !== undefined
          ? parsed.data.reviewStatus === "APPROVED"
          : existing.publishedToBank,
      publishedAt:
        parsed.data.reviewStatus === "APPROVED" ? new Date() : existing.publishedAt
    },
    {
      reviewerId: guard.actor.userId,
      action: "EDITED",
      notes: parsed.data.notes
    }
  );

  return NextResponse.json({
    question: serializeQuestion(updated)
  });
}
