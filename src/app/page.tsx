"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  UploadCloud,
  RefreshCw,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Cpu,
  ScanLine,
  Trash2,
  Download,
  ExternalLink,
  RotateCcw,
  Ban,
  Sparkles
} from "lucide-react";

interface ImportJobDTO {
  id: string;
  fileName: string;
  originalMimeType: string;
  detectedFormat: string;
  fileSize: number;
  status: "UPLOADED" | "QUEUED" | "PROCESSING" | "REVIEW_REQUIRED" | "COMPLETED" | "FAILED";
  currentStage: string;
  progressPercent: number;
  totalPages: number;
  pagesProcessed: number;
  totalExtractedQuestions: number;
  questionsRequiringReview: number;
  approvedQuestionsCount: number;
  ocrMethod: string | null;
  ocrDurationMs: number;
  aiUsed: boolean;
  aiModel: string | null;
  aiInputTokens: number;
  aiOutputTokens: number;
  estimatedAiCostUsd: number;
  processingDurationMs: number;
  errorMessage: string | null;
  isDuplicateFile: boolean;
  createdAt: string;
}

function StatusBadge({ status }: { status: ImportJobDTO["status"] }) {
  const styles: Record<ImportJobDTO["status"], string> = {
    UPLOADED: "bg-slate-100 text-slate-700 border-slate-200",
    QUEUED: "bg-blue-50 text-blue-700 border-blue-200",
    PROCESSING: "bg-indigo-50 text-indigo-700 border-indigo-200",
    REVIEW_REQUIRED: "bg-amber-50 text-amber-800 border-amber-200",
    COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    FAILED: "bg-red-50 text-red-700 border-red-200"
  };

  const icons: Record<ImportJobDTO["status"], React.ReactNode> = {
    UPLOADED: <Clock className="h-3.5 w-3.5" />,
    QUEUED: <Clock className="h-3.5 w-3.5" />,
    PROCESSING: <RefreshCw className="h-3.5 w-3.5 animate-spin" />,
    REVIEW_REQUIRED: <AlertTriangle className="h-3.5 w-3.5" />,
    COMPLETED: <CheckCircle2 className="h-3.5 w-3.5" />,
    FAILED: <XCircle className="h-3.5 w-3.5" />
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles[status]}`}
    >
      {icons[status]}
      {status}
    </span>
  );
}

export default function ImportDashboardPage() {
  const [imports, setImports] = useState<ImportJobDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingSample, setCreatingSample] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const fetchImports = useCallback(async () => {
    try {
      const res = await fetch("/api/imports", {
        headers: { "x-qbank-client": "web-workspace" }
      });
      if (!res.ok) throw new Error("Failed to load imports");
      const data = await res.json();
      setImports(data.imports || []);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImports();
    const interval = setInterval(fetchImports, 3000);
    return () => clearInterval(interval);
  }, [fetchImports]);

  const handleLoadSamplePaper = async () => {
    setCreatingSample(true);
    setErrorBanner(null);
    try {
      const res = await fetch("/api/imports/sample", {
        method: "POST",
        headers: { "x-qbank-client": "web-workspace" }
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || "Failed to create sample import");
      }
      await fetchImports();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Error creating sample paper");
    } finally {
      setCreatingSample(false);
    }
  };

  const handleRetry = async (id: string) => {
    await fetch(`/api/imports/${id}/retry`, {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" }
    });
    await fetchImports();
  };

  const handleCancel = async (id: string) => {
    await fetch(`/api/imports/${id}/cancel`, {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" }
    });
    await fetchImports();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/imports/${id}`, {
      method: "DELETE",
      headers: { "x-qbank-client": "web-workspace" }
    });
    await fetchImports();
  };

  const totalExtracted = imports.reduce((acc, j) => acc + j.totalExtractedQuestions, 0);
  const totalReviewNeeded = imports.reduce((acc, j) => acc + j.questionsRequiringReview, 0);
  const totalApproved = imports.reduce((acc, j) => acc + j.approvedQuestionsCount, 0);
  const totalAiCost = imports.reduce((acc, j) => acc + j.estimatedAiCostUsd, 0);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Import Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Monitor document extraction jobs, OCR pipelines, selective AI repairs, and question review queues.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleLoadSamplePaper}
            disabled={creatingSample}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4 text-blue-600" />
            {creatingSample ? "Extracting Sample..." : "Load Sample Question Paper"}
          </button>

          <Link
            href="/upload"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            <UploadCloud className="h-4 w-4" />
            Upload Documents
          </Link>
        </div>
      </div>

      {errorBanner && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-xs font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Uploaded Documents
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900">{imports.length}</span>
            <span className="text-xs text-slate-500">
              {imports.reduce((a, b) => a + b.totalPages, 0)} total pages
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Extracted Questions
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900">{totalExtracted}</span>
            <span className="text-xs font-medium text-emerald-700">
              {totalApproved} approved
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Awaiting Review
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-amber-600">{totalReviewNeeded}</span>
            <span className="text-xs text-slate-500">staging queue</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Selective AI Spend
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900">
              ${totalAiCost.toFixed(4)}
            </span>
            <span className="text-xs text-slate-500">deterministic-first</span>
          </div>
        </div>
      </div>

      {/* Imports Table */}
      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Document Import Jobs</h2>
          <button
            type="button"
            onClick={fetchImports}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        {loading && imports.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Loading import jobs...
          </div>
        ) : imports.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <FileText className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-900">
              No question papers uploaded yet
            </h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Upload PDF, Scanned PDF, DOCX, XLSX, or image files—or load our comprehensive sample paper containing MCQs, MSQs, True/False, LaTeX equations, and tables.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={handleLoadSamplePaper}
                disabled={creatingSample}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Sparkles className="h-4 w-4 text-blue-600" />
                Load Sample Question Paper
              </button>
              <Link
                href="/upload"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <UploadCloud className="h-4 w-4" />
                Upload Documents
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3">Document</th>
                  <th className="px-4 py-3">Status &amp; Progress</th>
                  <th className="px-4 py-3">Pages</th>
                  <th className="px-4 py-3">Questions</th>
                  <th className="px-4 py-3">OCR / AI Pipeline</th>
                  <th className="px-4 py-3">Review Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {imports.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                        <div>
                          <Link
                            href={`/imports/${job.id}`}
                            className="font-semibold text-slate-900 hover:text-blue-600 hover:underline"
                          >
                            {job.fileName}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                              {job.detectedFormat}
                            </span>
                            <span>{(job.fileSize / 1024).toFixed(1)} KB</span>
                            <span>•</span>
                            <span>{new Date(job.createdAt).toLocaleString()}</span>
                            {job.isDuplicateFile && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                                Duplicate File
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <StatusBadge status={job.status} />
                      <div className="mt-2 w-36">
                        <div className="flex justify-between text-[11px] text-slate-500">
                          <span className="truncate">{job.currentStage}</span>
                          <span>{job.progressPercent}%</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full transition-all ${
                              job.status === "FAILED"
                                ? "bg-red-500"
                                : job.status === "COMPLETED"
                                  ? "bg-emerald-500"
                                  : "bg-blue-600"
                            }`}
                            style={{ width: `${job.progressPercent}%` }}
                          />
                        </div>
                      </div>
                      {job.errorMessage && (
                        <p className="mt-1 max-w-xs truncate text-xs text-red-600" title={job.errorMessage}>
                          {job.errorMessage}
                        </p>
                      )}
                    </td>

                    <td className="px-4 py-4 text-slate-700">
                      <div className="font-medium">
                        {job.pagesProcessed} / {job.totalPages}
                      </div>
                      <div className="text-xs text-slate-400">pages</div>
                    </td>

                    <td className="px-4 py-4">
                      <div className="text-base font-bold text-slate-900">
                        {job.totalExtractedQuestions}
                      </div>
                      <div className="text-xs text-slate-500">
                        {job.approvedQuestionsCount} approved
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1 text-xs">
                        <span className="inline-flex items-center gap-1 text-slate-700">
                          <ScanLine className="h-3.5 w-3.5 text-slate-400" />
                          OCR: <strong className="font-medium">{job.ocrMethod || "Digital (None)"}</strong>
                        </span>
                        <span className="inline-flex items-center gap-1 text-slate-700">
                          <Cpu className="h-3.5 w-3.5 text-slate-400" />
                          AI:{" "}
                          <strong className="font-medium">
                            {job.aiUsed
                              ? `${job.aiModel} ($${job.estimatedAiCostUsd.toFixed(4)})`
                              : "0 tokens ($0.00)"}
                          </strong>
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      {job.questionsRequiringReview > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 border border-amber-200">
                          {job.questionsRequiringReview} need review
                        </span>
                      ) : job.totalExtractedQuestions > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                          All reviewed
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          href={`/imports/${job.id}/review`}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Review
                          <ExternalLink className="h-3 w-3" />
                        </Link>

                        <Link
                          href={`/imports/${job.id}`}
                          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Details
                        </Link>

                        {(job.status === "QUEUED" || job.status === "UPLOADED") && (
                          <button
                            type="button"
                            onClick={() => handleCancel(job.id)}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-red-50 hover:text-red-600"
                            title="Cancel Queued Job"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {job.status === "FAILED" && (
                          <button
                            type="button"
                            onClick={() => handleRetry(job.id)}
                            className="rounded-md border border-slate-200 p-1.5 text-blue-600 hover:bg-blue-50"
                            title="Retry Failed Job"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}

                        <a
                          href={`/api/imports/${job.id}/export?format=report`}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                          title="Download Extraction Report"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>

                        <button
                          type="button"
                          onClick={() => handleDelete(job.id)}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          title="Delete Import Job"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
