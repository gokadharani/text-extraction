"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { History, Download, ExternalLink } from "lucide-react";

interface HistoryJobDTO {
  id: string;
  fileName: string;
  detectedFormat: string;
  status: string;
  totalPages: number;
  totalExtractedQuestions: number;
  approvedQuestionsCount: number;
  ocrMethod: string | null;
  ocrDurationMs: number;
  aiUsed: boolean;
  aiModel: string | null;
  aiInputTokens: number;
  aiOutputTokens: number;
  estimatedAiCostUsd: number;
  processingDurationMs: number;
  createdAt: string;
}

export default function ImportHistoryPage() {
  const [jobs, setJobs] = useState<HistoryJobDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/imports", { headers: { "x-qbank-client": "web-workspace" } })
      .then((r) => r.json())
      .then((d) => setJobs(d.imports || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center gap-3">
        <History className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Import Audit History
          </h1>
          <p className="text-sm text-slate-600">
            Complete audit log of document extractions, OCR durations, and OpenAI token consumption.
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Loading import history...
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            No historical import records found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3">Timestamp</th>
                  <th className="px-4 py-3">File Name</th>
                  <th className="px-4 py-3">Format</th>
                  <th className="px-4 py-3">Questions</th>
                  <th className="px-4 py-3">OCR Duration</th>
                  <th className="px-4 py-3">AI Tokens / Cost</th>
                  <th className="px-4 py-3">Total Duration</th>
                  <th className="px-5 py-3 text-right">Audit Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {new Date(j.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link href={`/imports/${j.id}`} className="hover:text-blue-600 hover:underline">
                        {j.fileName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{j.detectedFormat}</td>
                    <td className="px-4 py-3">
                      {j.totalExtractedQuestions} ({j.approvedQuestionsCount} approved)
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {j.ocrMethod ? `${j.ocrMethod} (${j.ocrDurationMs}ms)` : "0ms (Digital)"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {j.aiUsed
                        ? `${j.aiInputTokens + j.aiOutputTokens} tok ($${j.estimatedAiCostUsd.toFixed(4)})`
                        : "0 tok ($0.0000)"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">
                      {j.processingDurationMs}ms
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`/api/imports/${j.id}/export?format=report`}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <Download className="h-3 w-3" />
                          Report
                        </a>
                        <Link
                          href={`/imports/${j.id}/review`}
                          className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Review
                          <ExternalLink className="h-3 w-3" />
                        </Link>
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
