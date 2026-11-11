import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { questionBankRepo } from "@/repositories/question-bank.repository";

const BulkActionRequestSchema = z.object({
  questionIds: z.array(z.string()).optional(),
  action: z.enum(["APPROVE", "REJECT"]).default("APPROVE")
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = withApiProtection(req);
  if (!guard.ok) return guard.response;

  const job = await questionBankRepo.getImportJobById(params.id);
  if (!job) {
    return apiErrorResponse("IMPORT_NOT_FOUND", `Import job "${params.id}" not found.`, 404);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = BulkActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiErrorResponse("VALIDATION_ERROR", "Invalid bulk action payload", 400, parsed.error.flatten());
  }

  const targetStatus = parsed.data.action === "REJECT" ? "REJECTED" : "APPROVED";
  const result = await questionBankRepo.bulkUpdateQuestionStatus(
    params.id,
    parsed.data.questionIds,
    targetStatus,
    guard.actor.userId
  );

  return NextResponse.json({
    importJobId: params.id,
    status: targetStatus,
    updatedCount: result.updatedCount
  });
}
