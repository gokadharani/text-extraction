import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { validateUploadedFile } from "@/lib/storage/file-validator";
import { getStorageProvider } from "@/lib/storage/storage-provider";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { enqueueImportJob } from "@/queue/import-queue";
import { serializeImportJob } from "@/lib/api-serializers";
import {
  buildValidPdfBuffer,
  getComprehensiveSamplePaperText
} from "@/lib/sample-documents";

export async function POST(req: NextRequest) {
  const guard = withApiProtection(req);
  if (!guard.ok) return guard.response;

  try {
    const sampleText = getComprehensiveSamplePaperText();
    const pages = sampleText.split("SECTION B -");
    const buffer = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          digitalText: pages[0].trim()
        },
        {
          mode: "DIGITAL",
          digitalText: `SECTION B -${pages[1] || ""}`.trim()
        }
      ]
    });

    const fileName = `Advanced_Engineering_Mathematics_${new Date().toISOString().slice(0, 10)}.pdf`;
    const validation = validateUploadedFile(buffer, fileName);
    if (!validation.valid || !validation.sha256 || !validation.detectedMimeType) {
      return apiErrorResponse("SAMPLE_VALIDATION_ERROR", "Sample generation failed", 500);
    }

    const storage = getStorageProvider();
    const stored = await storage.putObject({
      keyPrefix: "uploads",
      fileName: validation.sanitizedFileName,
      buffer,
      contentType: validation.detectedMimeType
    });

    const job = await questionBankRepo.createImportJob({
      fileName: validation.sanitizedFileName,
      originalMimeType: validation.detectedMimeType,
      fileSize: validation.fileSize,
      fileSha256: validation.sha256,
      storageKey: stored.storageKey,
      uploadedById: guard.actor.userId
    });

    await enqueueImportJob(job.id, { runSynchronouslyForTest: true });
    const processedJob = (await questionBankRepo.getImportJobById(job.id)) || job;

    return NextResponse.json(
      {
        job: serializeImportJob(processedJob)
      },
      { status: 201 }
    );
  } catch (err) {
    return apiErrorResponse(
      "SAMPLE_IMPORT_FAILED",
      err instanceof Error ? err.message : "Failed to create sample import",
      500
    );
  }
}
