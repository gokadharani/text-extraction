import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { enqueueImportJob } from "@/queue/import-queue";
import { serializeImportJob } from "@/lib/api-serializers";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = withApiProtection(req, { maxRequestsPerMinute: 30 });
  if (!guard.ok) return guard.response;

  const job = await questionBankRepo.getImportJobById(params.id);
  if (!job) {
    return apiErrorResponse("IMPORT_NOT_FOUND", `Import job "${params.id}" not found.`, 404);
  }

  await enqueueImportJob(job.id);
  const refreshed = (await questionBankRepo.getImportJobById(job.id)) || job;

  return NextResponse.json({
    retried: true,
    job: serializeImportJob(refreshed)
  });
}
