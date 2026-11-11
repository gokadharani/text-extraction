import { NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/config/env";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { validateUploadedFile } from "@/lib/storage/file-validator";
import { getStorageProvider } from "@/lib/storage/storage-provider";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { enqueueImportJob } from "@/queue/import-queue";
import { serializeImportJob } from "@/lib/api-serializers";
import {
  UserDeclaredFormatEnumSchema,
  UserDeclaredFormat
} from "@/domain/schemas/question.schema";

export async function GET(req: NextRequest) {
  const guard = withApiProtection(req);
  if (!guard.ok) return guard.response;

  try {
    const jobs = await questionBankRepo.listImportJobs();
    return NextResponse.json({
      imports: jobs.map(serializeImportJob)
    });
  } catch (err) {
    return apiErrorResponse(
      "LIST_IMPORTS_FAILED",
      err instanceof Error ? err.message : "Failed to list import jobs",
      500
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = withApiProtection(req, { maxRequestsPerMinute: 40 });
  if (!guard.ok) return guard.response;

  try {
    const config = getAppConfig();
    const formData = await req.formData();

    const uploadedFiles: File[] = [];
    const multiFiles = formData.getAll("files");
    const singleFile = formData.get("file");

    for (const item of multiFiles) {
      if (item instanceof File) uploadedFiles.push(item);
    }
    if (singleFile instanceof File && uploadedFiles.length === 0) {
      uploadedFiles.push(singleFile);
    }

    if (uploadedFiles.length === 0) {
      return apiErrorResponse(
        "NO_FILE_PROVIDED",
        "Please provide at least one document file in 'file' or 'files' form field.",
        400
      );
    }

    const rejectDuplicate = formData.get("rejectDuplicate") === "true";
    const budgetRaw = formData.get("aiBudgetUsd");
    const aiBudgetUsd = budgetRaw
      ? Math.max(0, Math.min(10, Number.parseFloat(String(budgetRaw)) || config.ai.budgetPerImportUsd))
      : config.ai.budgetPerImportUsd;

    // Validate userDeclaredFormat using clean Zod enum schema
    const rawUserFormat = formData.get("userDeclaredFormat");
    let userDeclaredFormat: UserDeclaredFormat = "AUTO_DETECT";
    if (rawUserFormat !== null && rawUserFormat !== undefined && String(rawUserFormat).trim() !== "") {
      const normalized = String(rawUserFormat).trim().toUpperCase();
      const parsedFormat = UserDeclaredFormatEnumSchema.safeParse(normalized);
      if (!parsedFormat.success) {
        return apiErrorResponse(
          "INVALID_DOCUMENT_TYPE",
          `Invalid user-declared document type '${rawUserFormat}'. Allowed values: ${UserDeclaredFormatEnumSchema.options.join(", ")}.`,
          422
        );
      }
      userDeclaredFormat = parsedFormat.data;
    }

    const storage = getStorageProvider();
    const createdJobs = [];

    for (const file of uploadedFiles) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 1. Validate binary file signature, size, and safety
      const validation = validateUploadedFile(buffer, file.name);
      if (!validation.valid || !validation.sha256 || !validation.detectedMimeType) {
        return apiErrorResponse(
          validation.errorCode || "INVALID_FILE",
          validation.errorMessage || `File "${file.name}" failed validation.`,
          422
        );
      }

      // 2. Check for duplicate file upload via SHA-256
      const existingDuplicate = await questionBankRepo.findImportBySha256(validation.sha256);
      if (existingDuplicate && rejectDuplicate) {
        return apiErrorResponse(
          "DUPLICATE_UPLOAD",
          `File "${validation.sanitizedFileName}" has already been uploaded (Import ID: ${existingDuplicate.id}).`,
          409,
          { existingImportId: existingDuplicate.id }
        );
      }

      // 3. Store file in private storage
      const stored = await storage.putObject({
        keyPrefix: "uploads",
        fileName: validation.sanitizedFileName,
        buffer,
        contentType: validation.detectedMimeType
      });

      // 4. Create ImportJob record
      const job = await questionBankRepo.createImportJob({
        fileName: validation.sanitizedFileName,
        originalMimeType: validation.detectedMimeType,
        fileSize: validation.fileSize,
        fileSha256: validation.sha256,
        storageKey: stored.storageKey,
        userDeclaredFormat,
        aiBudgetUsd,
        isDuplicateFile: Boolean(existingDuplicate),
        uploadedById: guard.actor.userId
      });

      // 5. Enqueue background processing job
      await enqueueImportJob(job.id);
      const updatedJob = (await questionBankRepo.getImportJobById(job.id)) || job;
      createdJobs.push(serializeImportJob(updatedJob));
    }

    return NextResponse.json(
      {
        job: createdJobs[0],
        jobs: createdJobs
      },
      { status: 201 }
    );
  } catch (err) {
    return apiErrorResponse(
      "IMPORT_CREATION_FAILED",
      err instanceof Error ? err.message : "Failed to create import job",
      500
    );
  }
}
