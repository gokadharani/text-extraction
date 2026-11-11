"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Ban,
  Download,
  FileText,
  ScanLine,
  Cpu,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";

interface ImportPageDTO {
  id: string;
  pageNumber: number;
  classification: string;
  rawText: string;
  normalizedText: string;
  ocrUsed: boolean;
  ocrProvider: string | null;
  ocrConfidence: number | null;
  ocrDurationMs: number;
}

interface ImportDetailDTO {
  id: string;
  fileName: string;
  detectedFormat: string;
  userDeclaredFormat?: string;
  fileSize: number;
  status: string;
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
  aiBudgetUsd: number;
  processingDurationMs: number;
  errorMessage: string | null;
  createdAt: string;
}

export default function ImportProcessingDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [job, setJob] = useState<ImportDetailDTO | null>(null);
  const [pages, setPages] = useState<ImportPageDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/imports/${id}`, {
        headers: { "x-qbank-client": "web-workspace" }
      });
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.job);
      setPages(data.pages || []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetails();
    const interval = setInterval(fetchDetails, 2500);
    return () => clearInterval(interval);
  }, [fetchDetails]);

  const handleRetry = async () => {
    await fetch(`/api/imports/${id}/retry`, {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" }
    });
    await fetchDetails();
  };

  const handleCancel = async () => {
    await fetch(`/api/imports/${id}/cancel`, {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" }
    });
    await fetchDetails();
  };

  if (loading && !job) {
    return (
      <div className="p-12 text-center text-sm text-slate-500">
        Loading import processing telemetry...
      </div>
    );
  }

  if (!job) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12 text-center">
        <h1 className="text-lg font-bold text-slate-900">Import Job Not Found</h1>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-blue-600 underline">
          Return to Import Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{job.fileName}</h1>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                Detected: {job.detectedFormat}
              </span>
              {job.userDeclaredFormat && job.userDeclaredFormat !== "AUTO_DETECT" && (
                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs font-medium text-slate-600">
                  Declared: {job.userDeclaredFormat.replace(/_/g, " ")}
                </span>
              )}
              {job.userDeclaredFormat === "SCANNED_HANDWRITTEN_PDF" && (
                <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  Handwritten Mode (Baseline OCR)
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Job ID: <code className="font-mono">{job.id}</code> • Uploaded{" "}
              {new Date(job.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/imports/${id}/review`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            Open Question Review Workspace
            <ExternalLink className="h-4 w-4" />
          </Link>

          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry Pipeline
          </button>

          {(job.status === "QUEUED" || job.status === "UPLOADED") && (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <Ban className="h-3.5 w-3.5" />
              Cancel Job
            </button>
          )}
        </div>
      </div>

      {/* Pipeline Status & Progress */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Current Processing Stage
            </div>
            <div className="mt-1 flex items-center gap-2 text-lg font-bold text-slate-900">
              {job.status === "PROCESSING" && (
                <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
              )}
              {job.currentStage} ({job.progressPercent}%)
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span>
              Duration: <strong>{job.processingDurationMs} ms</strong>
            </span>
            <span>•</span>
            <span>
              Status: <strong className="text-slate-900">{job.status}</strong>
            </span>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
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

        {job.errorMessage && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <strong>Error:</strong> {job.errorMessage}
          </div>
        )}
      </div>

      {/* Telemetry Cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <FileText className="h-4 w-4 text-blue-600" />
            Extraction Metrics
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Pages Processed</dt>
              <dd className="font-semibold text-slate-900">
                {job.pagesProcessed} / {job.totalPages}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Total Extracted Questions</dt>
              <dd className="font-semibold text-slate-900">{job.totalExtractedQuestions}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Questions Requiring Review</dt>
              <dd className="font-semibold text-amber-700">{job.questionsRequiringReview}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Approved &amp; Published</dt>
              <dd className="font-semibold text-emerald-700">{job.approvedQuestionsCount}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <ScanLine className="h-4 w-4 text-indigo-600" />
            OCR Pipeline Telemetry
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">OCR Adapter</dt>
              <dd className="font-semibold text-slate-900">
                {job.ocrMethod || "None (Digital Text)"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Total OCR Duration</dt>
              <dd className="font-semibold text-slate-900">{job.ocrDurationMs} ms</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Scanned Pages</dt>
              <dd className="font-semibold text-slate-900">
                {pages.filter((p) => p.ocrUsed).length} / {pages.length}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Cpu className="h-4 w-4 text-emerald-600" />
            Selective OpenAI Telemetry
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">AI Invoked</dt>
              <dd className="font-semibold text-slate-900">{job.aiUsed ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Model</dt>
              <dd className="font-mono text-xs font-semibold text-slate-900">
                {job.aiModel || "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Tokens (In / Out)</dt>
              <dd className="font-semibold text-slate-900">
                {job.aiInputTokens} / {job.aiOutputTokens}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Cost / Budget Cap</dt>
              <dd className="font-semibold text-slate-900">
                ${job.estimatedAiCostUsd.toFixed(4)} / ${job.aiBudgetUsd.toFixed(2)}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Export Bar */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Export Extracted Data</h2>
          <p className="text-xs text-slate-500">
            JSON export preserves full Tiptap ProseMirror Rich-Text JSONB. CSV and XLSX flatten text for spreadsheet portability.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/imports/${id}/export?format=json`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Rich-Text JSON
          </a>
          <a
            href={`/api/imports/${id}/export?format=xlsx`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            XLSX Workbook
          </a>
          <a
            href={`/api/imports/${id}/export?format=csv`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
          <a
            href={`/api/imports/${id}/export?format=report`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Extraction Report
          </a>
        </div>
      </div>

      {/* Page-by-Page Classification Table */}
      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">
            Per-Page Classification &amp; Extraction Breakdown ({pages.length} Pages)
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3">Page</th>
                <th className="px-4 py-3">Classification</th>
                <th className="px-4 py-3">OCR Executed</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-5 py-3">Normalized Text Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pages.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 font-semibold text-slate-900">
                    Page {p.pageNumber}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                      {p.classification}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.ocrUsed ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Yes ({p.ocrProvider} • {p.ocrDurationMs}ms)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        No (Digital Text Used)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold">
                    {p.ocrConfidence !== null
                      ? `${(p.ocrConfidence * 100).toFixed(0)}%`
                      : "100%"}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600 max-w-md truncate">
                    {p.normalizedText.slice(0, 140)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
