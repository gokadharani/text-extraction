import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { cancelQueuedImportJob } from "@/queue/import-queue";
import { serializeImportJob } from "@/lib/api-serializers";

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

  if (job.status === "COMPLETED") {
    return apiErrorResponse(
      "CANNOT_CANCEL_COMPLETED_JOB",
      "Completed import jobs cannot be cancelled.",
      400
    );
  }

  await cancelQueuedImportJob(job.id);
  const updated = (await questionBankRepo.getImportJobById(job.id)) || job;

  return NextResponse.json({
    cancelled: true,
    job: serializeImportJob(updated)
  });
}
