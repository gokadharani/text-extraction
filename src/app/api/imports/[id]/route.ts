import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { getStorageProvider } from "@/lib/storage/storage-provider";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { serializeImportJob, serializeImportPage } from "@/lib/api-serializers";

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

  const pages = await questionBankRepo.getImportPages(params.id);

  return NextResponse.json({
    job: serializeImportJob(job),
    pages: pages.map(serializeImportPage)
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = withApiProtection(req);
  if (!guard.ok) return guard.response;

  const job = await questionBankRepo.getImportJobById(params.id);
  if (!job) {
    return apiErrorResponse("IMPORT_NOT_FOUND", `Import job "${params.id}" not found.`, 404);
  }

  const { storageKeys } = await questionBankRepo.deleteImportJob(params.id);
  const storage = getStorageProvider();

  for (const key of storageKeys) {
    await storage.deleteObject(key);
  }

  return NextResponse.json({
    deleted: true,
    id: params.id
  });
}
