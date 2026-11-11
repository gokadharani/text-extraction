import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, withApiProtection } from "@/lib/auth/security";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { generateImportExport, ExportFormat } from "@/services/export.service";

const ExportRequestSchema = z.object({
  format: z.enum(["json", "xlsx", "csv", "report"]).default("json"),
  approvedOnly: z.boolean().default(false)
});

async function handleExport(
  req: NextRequest,
  importJobId: string,
  format: ExportFormat,
  approvedOnly: boolean
) {
  const guard = withApiProtection(req);
  if (!guard.ok) return guard.response;

  const job = await questionBankRepo.getImportJobById(importJobId);
  if (!job) {
    return apiErrorResponse("IMPORT_NOT_FOUND", `Import job "${importJobId}" not found.`, 404);
  }

  let questions = await questionBankRepo.getQuestionsByImportJobId(importJobId);
  if (approvedOnly) {
    questions = questions.filter((q) => q.reviewStatus === "APPROVED");
  }

  const exported = await generateImportExport(job, questions, format);

  return new NextResponse(new Uint8Array(exported.buffer), {
    status: 200,
    headers: {
      "Content-Type": exported.contentType,
      "Content-Disposition": `attachment; filename="${exported.fileName}"`
    }
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const formatParam = (req.nextUrl.searchParams.get("format") || "json").toLowerCase();
  const approvedOnly = req.nextUrl.searchParams.get("approvedOnly") === "true";
  const parsed = ExportRequestSchema.safeParse({ format: formatParam, approvedOnly });
  if (!parsed.success) {
    return apiErrorResponse("INVALID_EXPORT_FORMAT", "Supported formats: json, xlsx, csv, report", 400);
  }
  return handleExport(req, params.id, parsed.data.format, parsed.data.approvedOnly);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = ExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiErrorResponse("INVALID_EXPORT_FORMAT", "Supported formats: json, xlsx, csv, report", 400);
  }
  return handleExport(req, params.id, parsed.data.format, parsed.data.approvedOnly);
}
