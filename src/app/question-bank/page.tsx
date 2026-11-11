"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  Database,
  CheckCircle2,
  Sparkles,
  Copy,
  ExternalLink
} from "lucide-react";
import {
  TiptapDoc,
  QuestionOption,
  QuestionAnswer
} from "@/domain/schemas/question.schema";
import { StudentLivePreview } from "@/components/richtext/StudentLivePreview";

interface QuestionBankItemDTO {
  id: string;
  importJobId: string;
  question: TiptapDoc;
  options: QuestionOption[];
  answer: QuestionAnswer;
  explanation: TiptapDoc | null;
  type: string;
  sourcePage: number;
  sourceQuestionNumber: string;
  sourceSection: string | null;
  confidence: number;
  answerProvenance: string;
  reviewStatus: string;
  aiRepaired: boolean;
  isDuplicate: boolean;
  publishedToBank: boolean;
  contentHash: string;
}

export default function QuestionBankPage() {
  const [questions, setQuestions] = useState<QuestionBankItemDTO[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (typeFilter) qs.set("type", typeFilter);
      if (statusFilter) qs.set("reviewStatus", statusFilter);
      if (publishedOnly) qs.set("publishedOnly", "true");

      const res = await fetch(`/api/question-bank?${qs.toString()}`, {
        headers: { "x-qbank-client": "web-workspace" }
      });
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.questions || []);
      }
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, statusFilter, publishedOnly]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Question Bank Repository
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Browse, search, and filter extracted &amp; approved questions stored as Tiptap Rich-Text JSONB in PostgreSQL.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <Database className="h-4 w-4 text-blue-600" />
          {questions.length} matching questions
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search equations, terms, or question content..."
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-sm"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All Question Types</option>
          <option value="MCQ">MCQ</option>
          <option value="MSQ">MSQ</option>
          <option value="TRUE_FALSE">TRUE_FALSE</option>
          <option value="UNKNOWN">UNKNOWN</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All Review Statuses</option>
          <option value="APPROVED">APPROVED</option>
          <option value="PENDING_REVIEW">PENDING_REVIEW</option>
          <option value="NEEDS_ATTENTION">NEEDS_ATTENTION</option>
          <option value="REJECTED">REJECTED</option>
        </select>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={publishedOnly}
            onChange={(e) => setPublishedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          Published Only
        </label>
      </div>

      {/* Questions List */}
      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">
            Querying Question Bank...
          </div>
        ) : questions.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
            <p className="text-sm text-slate-500">
              No questions match your current filters.
            </p>
          </div>
        ) : (
          questions.map((q) => (
            <div
              key={q.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-slate-900 px-2 py-0.5 font-bold text-white">
                    Q{q.sourceQuestionNumber}
                  </span>
                  <span className="rounded bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                    {q.type}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                    Page {q.sourcePage}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                    Provenance: {q.answerProvenance}
                  </span>
                  {q.reviewStatus === "APPROVED" && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      APPROVED
                    </span>
                  )}
                  {q.aiRepaired && (
                    <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5 font-semibold text-purple-700">
                      <Sparkles className="h-3 w-3" />
                      AI Repaired
                    </span>
                  )}
                  {q.isDuplicate && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                      <Copy className="h-3 w-3" />
                      Duplicate
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="font-mono text-[11px] text-slate-400">
                    hash:{q.contentHash.slice(0, 10)}
                  </span>
                  <Link
                    href={`/imports/${q.importJobId}/review`}
                    className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
                  >
                    Open in Review Workspace
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              <div className="mt-3">
                <StudentLivePreview doc={q.question} />
              </div>

              {q.options.length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {q.options.map((opt) => {
                    const isAns = q.answer.value.includes(opt.id);
                    return (
                      <div
                        key={opt.id}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                          isAns
                            ? "border-emerald-300 bg-emerald-50/70"
                            : "border-slate-200 bg-slate-50/50"
                        }`}
                      >
                        <span
                          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold ${
                            isAns
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {opt.id}
                        </span>
                        <StudentLivePreview doc={opt.content} />
                      </div>
                    );
                  })}
                </div>
              )}

              {q.explanation && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs border border-slate-200">
                  <div className="font-semibold text-slate-700 mb-1">Explanation:</div>
                  <StudentLivePreview doc={q.explanation} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
