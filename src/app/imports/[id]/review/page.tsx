"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  CheckCircle2,
  XCircle,
  Save,
  CheckCheck,
  Download,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Plus,
  Trash2,
  Eye,
  FileText,
  Copy
} from "lucide-react";
import {
  TiptapDoc,
  QuestionOption,
  QuestionAnswer,
  QuestionTypeEnum,
  AnswerProvenanceEnum,
  QuestionReviewStatusEnum,
  BoundingBox,
  toDomainAnswerType
} from "@/domain/schemas/question.schema";
import { textToTiptapDoc, tiptapDocToPlainText } from "@/domain/richtext/tiptap-converter";
import { TiptapRichEditor } from "@/components/richtext/TiptapRichEditor";
import { StudentLivePreview } from "@/components/richtext/StudentLivePreview";

interface ReviewPageDTO {
  id: string;
  pageNumber: number;
  classification: string;
  rawText: string;
  normalizedText: string;
  ocrUsed: boolean;
  ocrProvider: string | null;
  ocrConfidence: number | null;
  width: number | null;
  height: number | null;
  boundingBoxes: Array<{
    text: string;
    confidence: number;
    boundingBox: { x: number; y: number; width: number; height: number };
  }>;
}

interface ReviewQuestionDTO {
  id: string;
  question: TiptapDoc;
  options: QuestionOption[];
  answer: QuestionAnswer;
  explanation: TiptapDoc | null;
  type: QuestionTypeEnum;
  sourcePage: number;
  sourcePageEnd: number | null;
  sourceQuestionNumber: string;
  sourceSection: string | null;
  sourceOrder: number;
  confidence: number;
  answerProvenance: AnswerProvenanceEnum;
  reviewStatus: QuestionReviewStatusEnum;
  sharedPassage: TiptapDoc | null;
  boundingBox: BoundingBox | null;
  warnings: string[];
  aiRepaired: boolean;
  aiRepairModel: string | null;
  aiRepairReason: string | null;
  isDuplicate: boolean;
  duplicateOfId: string | null;
}

function isInProgressStatus(status: string): boolean {
  return status === "UPLOADED" || status === "QUEUED" || status === "PROCESSING";
}

export default function QuestionReviewWorkspacePage() {
  const params = useParams<{ id: string }>();
  const importId = params.id;

  const [fileName, setFileName] = useState("Question Paper");
  const [userDeclaredFormat, setUserDeclaredFormat] = useState<string | null>(null);
  const [pages, setPages] = useState<ReviewPageDTO[]>([]);
  const [questions, setQuestions] = useState<ReviewQuestionDTO[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [currentPageNum, setCurrentPageNum] = useState(1);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Import lifecycle & polling state
  const [importStatus, setImportStatus] = useState<string>("PROCESSING");
  const [currentStage, setCurrentStage] = useState<string>("PROCESSING");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobNotFound, setJobNotFound] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const isPollingRef = useRef(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    isPollingRef.current = false;
  }, []);

  // Local editable state for active question
  const [draftQuestionDoc, setDraftQuestionDoc] = useState<TiptapDoc | null>(null);
  const [draftOptions, setDraftOptions] = useState<QuestionOption[]>([]);
  const [draftAnswer, setDraftAnswer] = useState<QuestionAnswer>({
    type: "mcq",
    value: [],
    status: "extracted"
  });
  const [draftExplanation, setDraftExplanation] = useState<TiptapDoc | null>(null);
  const [draftType, setDraftType] = useState<QuestionTypeEnum>("MCQ");
  const [draftQNumber, setDraftQNumber] = useState("1");

  const activeQuestion = questions[selectedIndex] || null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2800);
  };

  const loadWorkspaceData = useCallback(async (): Promise<string> => {
    try {
      const [impRes, qRes] = await Promise.all([
        fetch(`/api/imports/${importId}`, {
          headers: { "x-qbank-client": "web-workspace" }
        }),
        fetch(`/api/imports/${importId}/questions`, {
          headers: { "x-qbank-client": "web-workspace" }
        })
      ]);

      if (impRes.status === 404) {
        setJobNotFound(true);
        return "NOT_FOUND";
      }

      let status = "UNKNOWN";
      if (impRes.ok) {
        const impData = await impRes.json();
        const job = impData.job;
        setFileName(job?.fileName || "Question Paper");
        setUserDeclaredFormat(job?.userDeclaredFormat || null);
        status = job?.status || "UNKNOWN";
        setImportStatus(status);
        setCurrentStage(job?.currentStage || "PROCESSING");
        setProgressPercent(job?.progressPercent ?? 0);
        setErrorMessage(job?.errorMessage || null);
        setPages(impData.pages || []);
      }

      if (qRes.ok) {
        const qData = await qRes.json();
        const loadedQuestions: ReviewQuestionDTO[] = qData.questions || [];
        setQuestions(loadedQuestions);
      }

      return status;
    } catch {
      return "ERROR";
    }
  }, [importId]);

  const pollStatus = useCallback(async () => {
    if (!isPollingRef.current) return;

    try {
      const res = await fetch(`/api/imports/${importId}/status`, {
        headers: { "x-qbank-client": "web-workspace" }
      });

      if (!isPollingRef.current) return;

      if (res.status === 404) {
        stopPolling();
        setJobNotFound(true);
        return;
      }

      if (res.ok) {
        const data = await res.json();
        const status = data.status;
        setImportStatus(status);
        setCurrentStage(data.currentStage || "PROCESSING");
        setProgressPercent(data.progressPercent ?? 0);
        if (data.errorMessage) {
          setErrorMessage(data.errorMessage);
        }

        if (status === "REVIEW_REQUIRED" || status === "COMPLETED") {
          stopPolling();
          await loadWorkspaceData();
          return;
        }

        if (status === "FAILED") {
          stopPolling();
          return;
        }
      }
    } catch {
      // Temporary network error: keep polling without crashing
    }

    if (isPollingRef.current) {
      pollTimerRef.current = setTimeout(pollStatus, 2200);
    }
  }, [importId, stopPolling, loadWorkspaceData]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/imports/${importId}/retry`, {
        method: "POST",
        headers: { "x-qbank-client": "web-workspace" }
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || "Failed to retry import");
      }

      setErrorMessage(null);
      setImportStatus("QUEUED");
      setCurrentStage("QUEUED");
      setProgressPercent(5);
      setQuestions([]);
      showToast("Retrying extraction pipeline...");

      stopPolling();
      isPollingRef.current = true;
      pollTimerRef.current = setTimeout(pollStatus, 1500);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }, [importId, pollStatus, stopPolling]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      setLoading(true);
      try {
        const status = await loadWorkspaceData();
        if (!mounted) return;

        if (status && isInProgressStatus(status)) {
          stopPolling();
          isPollingRef.current = true;
          pollTimerRef.current = setTimeout(pollStatus, 2200);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      mounted = false;
      stopPolling();
    };
  }, [importId, loadWorkspaceData, pollStatus, stopPolling]);

  // Sync draft state whenever activeQuestion changes
  useEffect(() => {
    if (!activeQuestion) return;
    setDraftQuestionDoc(activeQuestion.question);
    setDraftOptions(activeQuestion.options);
    setDraftAnswer(activeQuestion.answer);
    setDraftExplanation(activeQuestion.explanation);
    setDraftType(activeQuestion.type);
    setDraftQNumber(activeQuestion.sourceQuestionNumber);
    setCurrentPageNum(activeQuestion.sourcePage || 1);
  }, [activeQuestion]);

  const handleSaveChanges = useCallback(async () => {
    if (!activeQuestion || !draftQuestionDoc) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/questions/${activeQuestion.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-qbank-client": "web-workspace"
        },
        body: JSON.stringify({
          question: draftQuestionDoc,
          options: draftOptions,
          answer: draftAnswer,
          explanation: draftExplanation,
          type: draftType,
          sourceQuestionNumber: draftQNumber
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || "Failed to save question");
      }

      const data = await res.json();
      setQuestions((prev) =>
        prev.map((q) => (q.id === activeQuestion.id ? data.question : q))
      );
      showToast(`Saved Question ${draftQNumber}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [
    activeQuestion,
    draftQuestionDoc,
    draftOptions,
    draftAnswer,
    draftExplanation,
    draftType,
    draftQNumber
  ]);

  const handleApproveCurrent = useCallback(async () => {
    if (!activeQuestion) return;
    await handleSaveChanges();
    const res = await fetch(`/api/questions/${activeQuestion.id}/approve`, {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" }
    });
    if (res.ok) {
      const data = await res.json();
      setQuestions((prev) =>
        prev.map((q) => (q.id === activeQuestion.id ? data.question : q))
      );
      showToast(`Approved & published Q${activeQuestion.sourceQuestionNumber}`);
    }
  }, [activeQuestion, handleSaveChanges]);

  const handleRejectCurrent = useCallback(async () => {
    if (!activeQuestion) return;
    const res = await fetch(`/api/questions/${activeQuestion.id}/reject`, {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" }
    });
    if (res.ok) {
      const data = await res.json();
      setQuestions((prev) =>
        prev.map((q) => (q.id === activeQuestion.id ? data.question : q))
      );
      showToast(`Rejected Q${activeQuestion.sourceQuestionNumber}`);
    }
  }, [activeQuestion]);

  const handleBulkAction = async (action: "APPROVE" | "REJECT") => {
    const res = await fetch(`/api/imports/${importId}/bulk-approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-qbank-client": "web-workspace"
      },
      body: JSON.stringify({ action })
    });
    if (res.ok) {
      await loadWorkspaceData();
      showToast(
        action === "APPROVE"
          ? "Bulk approved all questions in this import!"
          : "Bulk rejected all questions in this import."
      );
    }
  };

  // Keyboard navigation shortcuts (Alt+N, Alt+P, Alt+A, Alt+R, Ctrl+S)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveChanges();
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(questions.length - 1, prev + 1));
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        handleApproveCurrent();
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        handleRejectCurrent();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [questions.length, handleSaveChanges, handleApproveCurrent, handleRejectCurrent]);

  const handleTypeChange = (newType: QuestionTypeEnum) => {
    setDraftType(newType);
    if (newType === "MCQ") {
      setDraftAnswer((prev) => ({
        type: "mcq",
        value: prev.value.slice(0, 1),
        status: prev.value.length > 0 ? "verified" : "missing"
      }));
    } else if (newType === "MSQ") {
      setDraftAnswer((prev) => ({
        type: "msq",
        value: prev.value,
        status: prev.value.length > 0 ? "verified" : "missing"
      }));
    } else if (newType === "TRUE_FALSE") {
      setDraftOptions((prevOpts) => {
        if (prevOpts.length === 0) {
          return [
            { id: "True", content: textToTiptapDoc("True") },
            { id: "False", content: textToTiptapDoc("False") }
          ];
        }
        return prevOpts;
      });
      setDraftAnswer((prev) => ({
        type: "true_false",
        value: prev.value.slice(0, 1),
        status: prev.value.length > 0 ? "verified" : "missing"
      }));
    } else {
      setDraftAnswer((prev) => ({
        type: "unknown",
        value: prev.value,
        status: prev.status
      }));
    }
  };

  const handleClearAnswer = () => {
    setDraftAnswer({
      type: toDomainAnswerType(draftType),
      value: [],
      status: "missing"
    });
    showToast("Answer cleared (unanswered)");
  };

  const toggleAnswerOption = (optionId: string) => {
    if (draftType === "MSQ") {
      const exists = draftAnswer.value.includes(optionId);
      const nextVal = exists
        ? draftAnswer.value.filter((v) => v !== optionId)
        : [...draftAnswer.value, optionId];
      setDraftAnswer({
        type: "msq",
        value: nextVal,
        status: nextVal.length > 0 ? "verified" : "missing"
      });
      if (exists) {
        showToast(`Deselected Option ${optionId}`);
      } else {
        showToast(`Marked Option ${optionId} as correct`);
      }
    } else if (draftType === "TRUE_FALSE") {
      const isAlreadySelected = draftAnswer.value.includes(optionId);
      if (isAlreadySelected) {
        setDraftAnswer({
          type: "true_false",
          value: [],
          status: "missing"
        });
        showToast("Answer unselected (unanswered)");
      } else {
        setDraftAnswer({
          type: "true_false",
          value: [optionId],
          status: "verified"
        });
        showToast(`Marked ${optionId} as correct answer`);
      }
    } else {
      // MCQ or other single-choice
      const isAlreadySelected = draftAnswer.value.includes(optionId);
      if (isAlreadySelected) {
        setDraftAnswer({
          type: draftType === "UNKNOWN" ? "unknown" : "mcq",
          value: [],
          status: "missing"
        });
        showToast("Answer unselected (unanswered)");
      } else {
        setDraftAnswer({
          type: draftType === "UNKNOWN" ? "unknown" : "mcq",
          value: [optionId],
          status: "verified"
        });
        showToast(`Marked Option ${optionId} as correct answer`);
      }
    }
  };

  const handleSelectTrueFalse = (val: "True" | "False") => {
    const isAlready =
      (val === "True" && isTrueSelected) || (val === "False" && isFalseSelected);

    if (isAlready) {
      setDraftAnswer({
        type: "true_false",
        value: [],
        status: "missing"
      });
      showToast("Answer cleared (unanswered)");
      return;
    }

    // Try finding option matching val (by id or content text)
    let matchingOpt = draftOptions.find(
      (o) => o.id.toLowerCase() === val.toLowerCase()
    );
    if (!matchingOpt) {
      matchingOpt = draftOptions.find(
        (o) => tiptapDocToPlainText(o.content).trim().toLowerCase() === val.toLowerCase()
      );
    }

    if (matchingOpt) {
      setDraftAnswer({
        type: "true_false",
        value: [matchingOpt.id],
        status: "verified"
      });
      showToast(`Marked ${val} as correct answer`);
    } else {
      // Create True and False options if missing
      const trueOpt: QuestionOption = { id: "True", content: textToTiptapDoc("True") };
      const falseOpt: QuestionOption = { id: "False", content: textToTiptapDoc("False") };
      setDraftOptions([trueOpt, falseOpt]);
      setDraftAnswer({
        type: "true_false",
        value: [val],
        status: "verified"
      });
      showToast(`Marked ${val} as correct answer`);
    }
  };

  const isTrueSelected =
    draftType === "TRUE_FALSE" &&
    draftAnswer.value.some((v) => {
      if (v.toLowerCase() === "true") return true;
      const opt = draftOptions.find((o) => o.id === v);
      return opt ? tiptapDocToPlainText(opt.content).trim().toLowerCase() === "true" : false;
    });

  const isFalseSelected =
    draftType === "TRUE_FALSE" &&
    draftAnswer.value.some((v) => {
      if (v.toLowerCase() === "false") return true;
      const opt = draftOptions.find((o) => o.id === v);
      return opt ? tiptapDocToPlainText(opt.content).trim().toLowerCase() === "false" : false;
    });

  const isOptionCorrect = (opt: QuestionOption): boolean => {
    if (draftAnswer.value.includes(opt.id)) return true;
    if (draftType === "TRUE_FALSE") {
      const optText = tiptapDocToPlainText(opt.content).trim().toLowerCase();
      if (opt.id.toLowerCase() === "true" || optText === "true") {
        return Boolean(isTrueSelected);
      }
      if (opt.id.toLowerCase() === "false" || optText === "false") {
        return Boolean(isFalseSelected);
      }
    }
    return false;
  };

  const handleAddOption = () => {
    const alphabet = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const nextId = alphabet[draftOptions.length] || `OPT_${draftOptions.length + 1}`;
    setDraftOptions((prev) => [
      ...prev,
      { id: nextId, content: textToTiptapDoc(`Option ${nextId}`) }
    ]);
  };

  const handleRemoveOption = (optId: string) => {
    setDraftOptions((prev) => prev.filter((o) => o.id !== optId));
    setDraftAnswer((prev) => {
      const nextVal = prev.value.filter((v) => v !== optId);
      return {
        ...prev,
        value: nextVal,
        status: nextVal.length > 0 ? prev.status : "missing"
      };
    });
  };

  const currentPageObj =
    pages.find((p) => p.pageNumber === currentPageNum) || pages[0] || null;

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
        <h2 className="mt-4 text-base font-semibold text-slate-900">
          Loading Question Review Workspace...
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Checking document status and extracted questions...
        </p>
      </div>
    );
  }

  if (jobNotFound) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-slate-900">Import Job Not Found</h1>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          We could not find an import job with ID <code className="font-mono text-xs">{importId}</code>.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (importStatus === "FAILED") {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
          <XCircle className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-slate-900">Document Processing Failed</h1>
        <p className="mt-2 max-w-md text-sm text-red-600">
          {errorMessage || "An error occurred while extracting questions from this document."}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Job ID: <code className="font-mono">{importId}</code> • File: {fileName}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
          >
            <RotateCcw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Retrying..." : "Retry Extraction Pipeline"}
          </button>
          <Link
            href={`/imports/${importId}`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <FileText className="h-4 w-4 text-slate-500" />
            View Processing Telemetry
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isInProgressStatus(importStatus)) {
    return (
      <div className="flex h-screen flex-col bg-slate-50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <Link
              href={`/imports/${importId}`}
              className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 transition"
              title="Back to Import Details"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900">{fileName}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  {importStatus}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Job ID: <code className="font-mono">{importId}</code>
              </p>
            </div>
          </div>
          <Link
            href={`/imports/${importId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <FileText className="h-3.5 w-3.5" />
            Detailed Telemetry
          </Link>
        </div>

        {/* Processing State Body */}
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <RefreshCw className="h-7 w-7 animate-spin" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-slate-900">
              Extracting Questions...
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Document processing is currently in progress. Questions will appear here automatically once extraction completes.
            </p>

            <div className="mt-6">
              <div className="flex justify-between text-xs font-medium text-slate-500">
                <span className="font-mono">{currentStage}</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${Math.max(5, progressPercent)}%` }}
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-center gap-3">
              <Link
                href={`/imports/${importId}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition"
              >
                <FileText className="h-3.5 w-3.5" />
                View Progress &amp; Logs
              </Link>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col overflow-hidden bg-slate-100">
      {/* Top Workspace Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href={`/imports/${importId}`}
            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
            title="Back to Import Details"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">{fileName}</span>
              <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                {questions.filter((q) => q.reviewStatus === "APPROVED").length} /{" "}
                {questions.length} Approved
              </span>
              {userDeclaredFormat && userDeclaredFormat !== "AUTO_DETECT" && (
                <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                  Declared: {userDeclaredFormat.replace(/_/g, " ")}
                </span>
              )}
              {userDeclaredFormat === "SCANNED_HANDWRITTEN_PDF" && (
                <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                  Handwritten Mode
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500">
              Shortcuts: <kbd className="rounded border px-1">Alt+P</kbd> Prev •{" "}
              <kbd className="rounded border px-1">Alt+N</kbd> Next •{" "}
              <kbd className="rounded border px-1">Ctrl+S</kbd> Save •{" "}
              <kbd className="rounded border px-1">Alt+A</kbd> Approve •{" "}
              <kbd className="rounded border px-1">Alt+R</kbd> Reject
            </div>
          </div>
        </div>

        {/* Question Navigation & Bulk Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {toastMessage && (
            <span className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white shadow">
              {toastMessage}
            </span>
          )}

          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setSelectedIndex((prev) => Math.max(0, prev - 1))}
              disabled={selectedIndex <= 0}
              className="rounded p-1 text-slate-700 hover:bg-white disabled:opacity-40"
              title="Previous Question (Alt+P)"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2.5 text-xs font-semibold text-slate-800">
              Q {selectedIndex + 1} of {Math.max(questions.length, 1)}
            </span>
            <button
              type="button"
              onClick={() =>
                setSelectedIndex((prev) => Math.min(questions.length - 1, prev + 1))
              }
              disabled={selectedIndex >= questions.length - 1}
              className="rounded p-1 text-slate-700 hover:bg-white disabled:opacity-40"
              title="Next Question (Alt+N)"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleBulkAction("APPROVE")}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Bulk Approve
          </button>

          <button
            type="button"
            onClick={() => handleBulkAction("REJECT")}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            <XCircle className="h-3.5 w-3.5" />
            Bulk Reject
          </button>

          <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
            <a
              href={`/api/imports/${importId}/export?format=json`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Export Tiptap Rich-Text JSON"
            >
              <Download className="h-3.5 w-3.5" />
              JSON
            </a>
            <a
              href={`/api/imports/${importId}/export?format=xlsx`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Export XLSX"
            >
              XLSX
            </a>
            <a
              href={`/api/imports/${importId}/export?format=csv`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title="Export CSV"
            >
              CSV
            </a>
          </div>
        </div>
      </div>

      {/* Question Selector Pill Strip */}
      {questions.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-slate-50 px-4 py-2">
          {questions.map((q, idx) => {
            const isSelected = idx === selectedIndex;
            const statusColor =
              q.reviewStatus === "APPROVED"
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : q.reviewStatus === "REJECTED"
                  ? "border-red-300 bg-red-50 text-red-700"
                  : q.reviewStatus === "NEEDS_ATTENTION"
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-white text-slate-700";

            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setSelectedIndex(idx)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                  isSelected
                    ? "ring-2 ring-blue-600 border-blue-600 bg-blue-600 text-white"
                    : statusColor
                }`}
              >
                <span>Q{q.sourceQuestionNumber}</span>
                {q.aiRepaired && <Sparkles className="h-3 w-3" />}
                {(q.warnings || []).length > 0 && (
                  <AlertTriangle
                    className={`h-3 w-3 shrink-0 ${
                      isSelected ? "text-amber-200" : "text-amber-600"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Split-Screen Main Body */}
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
        {/* LEFT PANE: Original Document Preview, Thumbnails, Zoom & Highlighted Region */}
        <div className="flex flex-col border-r border-slate-200 bg-slate-900/95 text-slate-100 lg:col-span-5 overflow-hidden">
          {/* Document Preview Toolbar */}
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3.5 py-2 text-xs">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-400" />
              <span className="font-semibold">Source Document Preview</span>
              {currentPageObj && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    currentPageObj.ocrUsed
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  }`}
                >
                  {currentPageObj.classification}
                  {currentPageObj.ocrUsed && currentPageObj.ocrConfidence !== null
                    ? ` • OCR ${(currentPageObj.ocrConfidence * 100).toFixed(0)}%`
                    : ""}
                </span>
              )}
            </div>

            {/* Page Nav & Zoom Controls */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowThumbnails((s) => !s)}
                className="rounded bg-slate-800 px-2 py-1 text-[11px] hover:bg-slate-700"
              >
                {showThumbnails ? "Hide Thumbnails" : "Show Thumbnails"}
              </button>

              <div className="flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => setZoomPercent((z) => Math.max(75, z - 25))}
                  className="p-0.5 hover:text-blue-400"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="w-10 text-center font-mono text-[11px]">{zoomPercent}%</span>
                <button
                  type="button"
                  onClick={() => setZoomPercent((z) => Math.min(150, z + 25))}
                  className="p-0.5 hover:text-blue-400"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5">
                <button
                  type="button"
                  onClick={() => setCurrentPageNum((p) => Math.max(1, p - 1))}
                  disabled={currentPageNum <= 1}
                  className="p-0.5 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="text-[11px]">
                  Pg {currentPageNum}/{Math.max(pages.length, 1)}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPageNum((p) => Math.min(pages.length, p + 1))}
                  disabled={currentPageNum >= pages.length}
                  className="p-0.5 disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Page Thumbnails Strip */}
          {showThumbnails && pages.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-800 bg-slate-950/70 px-3.5 py-2">
              {pages.map((pg) => {
                const isActivePg = pg.pageNumber === currentPageNum;
                return (
                  <button
                    key={pg.id || pg.pageNumber}
                    type="button"
                    onClick={() => setCurrentPageNum(pg.pageNumber)}
                    className={`flex shrink-0 flex-col items-start rounded border px-2.5 py-1.5 text-left transition ${
                      isActivePg
                        ? "border-blue-500 bg-blue-500/20 text-white"
                        : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <span className="text-[11px] font-bold">Page {pg.pageNumber}</span>
                    <span className="text-[10px] opacity-80">{pg.classification}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Rendered Source Page Sheet with Highlighted Question Bounding Box */}
          <div className="flex-1 overflow-auto p-5">
            {currentPageObj ? (
              <div
                className="relative mx-auto rounded-lg bg-white p-6 text-slate-900 shadow-2xl transition-all"
                style={{
                  width: `${Math.round(580 * (zoomPercent / 100))}px`,
                  minHeight: `${Math.round(740 * (zoomPercent / 100))}px`,
                  fontSize: `${Math.round(13 * (zoomPercent / 100))}px`
                }}
              >
                <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-2 text-xs text-slate-400">
                  <span>
                    {fileName} — Page {currentPageObj.pageNumber}
                  </span>
                  <span>
                    {activeQuestion?.sourcePage === currentPageObj.pageNumber
                      ? `Highlighting Q${activeQuestion.sourceQuestionNumber}`
                      : `Viewing Page ${currentPageObj.pageNumber}`}
                  </span>
                </div>

                {/* Page Lines with Active Question Region Highlighting */}
                <div className="space-y-1.5 font-serif leading-relaxed">
                  {(currentPageObj.normalizedText || currentPageObj.rawText || "").split("\n").map((line, lIdx) => {
                    const isActiveQuestionLine =
                      activeQuestion &&
                      activeQuestion.sourcePage === currentPageObj.pageNumber &&
                      (line.includes(`Q${activeQuestion.sourceQuestionNumber}`) ||
                        line.startsWith(`${activeQuestion.sourceQuestionNumber}.`) ||
                        line.startsWith(`${activeQuestion.sourceQuestionNumber})`));

                    return (
                      <div
                        key={lIdx}
                        className={`rounded px-2 py-0.5 transition ${
                          isActiveQuestionLine
                            ? "border-l-4 border-blue-600 bg-blue-50/90 font-medium text-slate-950 shadow-sm"
                            : "text-slate-800"
                        }`}
                      >
                        {line || "\u00A0"}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                No source page data available.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANE: Rich-Text Question Editor & Live Student Preview */}
        <div className="flex flex-col overflow-y-auto bg-slate-50 lg:col-span-7">
          {!activeQuestion || !draftQuestionDoc ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <FileText className="h-6 w-6" />
              </div>
              <h3 className="mt-3 text-base font-semibold text-slate-900">
                No Questions Extracted
              </h3>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                The extraction pipeline finished processing, but no valid question patterns were detected in this document.
              </p>
              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retrying}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
                  {retrying ? "Retrying..." : "Retry Extraction"}
                </button>
                <Link
                  href={`/imports/${importId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  View Details &amp; Raw Text
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-5 p-6">
              {/* Question Metadata, Confidence, Provenance & Action Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-semibold text-slate-500">Q#</label>
                    <input
                      type="text"
                      value={draftQNumber}
                      onChange={(e) => setDraftQNumber(e.target.value)}
                      className="w-16 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900"
                    />
                  </div>

                  <select
                    value={draftType}
                    onChange={(e) => handleTypeChange(e.target.value as QuestionTypeEnum)}
                    aria-label="Question Type Selector"
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800"
                  >
                    <option value="MCQ">MCQ (Single Choice)</option>
                    <option value="MSQ">MSQ (Multiple Select)</option>
                    <option value="TRUE_FALSE">TRUE_FALSE</option>
                    <option value="UNKNOWN">UNKNOWN (Needs Review)</option>
                  </select>

                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      activeQuestion.confidence >= 0.85
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-amber-50 text-amber-800 border border-amber-200"
                    }`}
                  >
                    Confidence: {(activeQuestion.confidence * 100).toFixed(0)}%
                  </span>

                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                    Provenance: <strong>{activeQuestion.answerProvenance}</strong>
                  </span>

                  {draftAnswer.status === "verified" ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      Answer Verified
                    </span>
                  ) : draftAnswer.value.length === 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                      Unanswered
                    </span>
                  ) : null}

                  {activeQuestion.aiRepaired && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
                      <Sparkles className="h-3 w-3" />
                      AI Repaired ({activeQuestion.aiRepairModel})
                    </span>
                  )}

                  {activeQuestion.isDuplicate && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                      <Copy className="h-3 w-3" />
                      Duplicate Detected
                    </span>
                  )}
                </div>

                {/* Primary Question Actions: Save, Approve, Reject */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveChanges}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saving ? "Saving..." : "Save"}
                  </button>

                  <button
                    type="button"
                    onClick={handleApproveCurrent}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve
                  </button>

                  <button
                    type="button"
                    onClick={handleRejectCurrent}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Reject
                  </button>
                </div>
              </div>

              {/* Extraction Warnings Alert */}
              {(activeQuestion.warnings || []).length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Extraction Warnings ({(activeQuestion.warnings || []).length})
                  </div>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5">
                    {(activeQuestion.warnings || []).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Question Stem Rich-Text Editor */}
              <div>
                <TiptapRichEditor
                  label="Question Stem (Tiptap Rich-Text JSON)"
                  value={draftQuestionDoc}
                  onChange={setDraftQuestionDoc}
                />
              </div>

              {/* Options & Answer Selector */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Options &amp; Correct Answer Selector
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {draftType === "MSQ"
                        ? "Multiple Select (MSQ): Click options to toggle multiple correct answers."
                        : draftType === "TRUE_FALSE"
                          ? "True / False: Select True or False as the correct answer. Click again or use Clear to leave unanswered."
                          : "Single Choice (MCQ): Click an option to mark it as the correct answer. Click again or use Clear to leave unanswered."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {draftAnswer.value.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAnswer}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 transition"
                        title="Clear selected answer (leave question unanswered)"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Clear Answer
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleAddOption}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Option
                    </button>
                  </div>
                </div>

                {/* Selected Answer Summary Banner */}
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Correct Answer:</span>
                    {draftAnswer.value.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {draftAnswer.value.map((ansVal) => (
                          <span
                            key={ansVal}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white shadow-sm"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            {draftType === "TRUE_FALSE" ? ansVal : `Option ${ansVal}`}
                          </span>
                        ))}
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          {draftAnswer.status === "verified" ? "Manually Corrected" : "Extracted"}
                        </span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs italic text-slate-500">
                        No answer marked (Unanswered)
                      </span>
                    )}
                  </div>

                  {draftAnswer.value.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAnswer}
                      className="text-xs font-medium text-slate-500 hover:text-red-600 hover:underline"
                    >
                      Leave Unanswered
                    </button>
                  )}
                </div>

                {/* Dedicated True / False Selector Controls */}
                {draftType === "TRUE_FALSE" && (
                  <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
                    <span className="text-xs font-semibold text-slate-600">
                      True/False Answer:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSelectTrueFalse("True")}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-xs font-bold transition shadow-sm ${
                        isTrueSelected
                          ? "border-emerald-600 bg-emerald-600 text-white ring-2 ring-emerald-300"
                          : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500 hover:bg-emerald-50/40"
                      }`}
                    >
                      <CheckCircle2
                        className={`h-4 w-4 ${isTrueSelected ? "text-white" : "text-emerald-600"}`}
                      />
                      True {isTrueSelected && "(Selected)"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelectTrueFalse("False")}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-xs font-bold transition shadow-sm ${
                        isFalseSelected
                          ? "border-emerald-600 bg-emerald-600 text-white ring-2 ring-emerald-300"
                          : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500 hover:bg-emerald-50/40"
                      }`}
                    >
                      <XCircle
                        className={`h-4 w-4 ${isFalseSelected ? "text-white" : "text-red-500"}`}
                      />
                      False {isFalseSelected && "(Selected)"}
                    </button>

                    <span className="text-[11px] text-slate-400">
                      Click to set or change answer. Click again to unselect.
                    </span>
                  </div>
                )}

                {/* Options List */}
                {draftOptions.length > 0 ? (
                  <div className="space-y-3">
                    {draftOptions.map((opt, optIdx) => {
                      const isCorrect = isOptionCorrect(opt);
                      return (
                        <div
                          key={opt.id}
                          className={`flex items-start gap-3 rounded-lg border p-2.5 transition ${
                            isCorrect
                              ? "border-emerald-400 bg-emerald-50/50 shadow-sm ring-1 ring-emerald-300"
                              : "border-slate-200 bg-slate-50/40 hover:border-slate-300"
                          }`}
                        >
                          {/* Option Correct-Answer Selector Button */}
                          <button
                            type="button"
                            onClick={() => toggleAnswerOption(opt.id)}
                            className={`mt-1.5 flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold transition ${
                              isCorrect
                                ? "border-emerald-600 bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400/30"
                                : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500 hover:bg-emerald-50/40 hover:text-emerald-800"
                            }`}
                            title={
                              isCorrect
                                ? "Correct answer selected (click to clear/unselect)"
                                : draftType === "MSQ"
                                  ? "Click to select as an additional correct answer"
                                  : "Click to mark as the correct answer"
                            }
                          >
                            {isCorrect ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                            ) : draftType === "MSQ" ? (
                              <span className="h-3 w-3 rounded-xs border border-slate-400 bg-white" />
                            ) : (
                              <span className="h-3 w-3 rounded-full border border-slate-400 bg-white" />
                            )}
                            <span>Option {opt.id}</span>
                            {isCorrect && (
                              <span className="text-[10px] font-semibold text-emerald-100">
                                Correct
                              </span>
                            )}
                          </button>

                          <div className="flex-1 min-w-0">
                            <TiptapRichEditor
                              compact
                              value={opt.content}
                              onChange={(nextDoc) => {
                                setDraftOptions((prev) =>
                                  prev.map((item, i) =>
                                    i === optIdx ? { ...item, content: nextDoc } : item
                                  )
                                );
                              }}
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveOption(opt.id)}
                            className="mt-1.5 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Delete Option"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="py-2 text-xs italic text-slate-400">
                    No options configured. Click &quot;Add Option&quot; above to create answer options.
                  </p>
                )}
              </div>

              {/* Explanation Rich-Text Editor */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Explanation / Solution (Optional)
                  </span>
                  {draftExplanation ? (
                    <button
                      type="button"
                      onClick={() => setDraftExplanation(null)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Clear Explanation (Set Null)
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setDraftExplanation(textToTiptapDoc("Enter explanation here..."))
                      }
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      + Add Explanation
                    </button>
                  )}
                </div>

                {draftExplanation ? (
                  <TiptapRichEditor
                    value={draftExplanation}
                    onChange={setDraftExplanation}
                  />
                ) : (
                  <p className="text-xs italic text-slate-400">
                    No explanation extracted from source (stored as null).
                  </p>
                )}
              </div>

              {/* Live Student Preview Card (KaTeX Math + Tables + Options) */}
              <div className="rounded-xl border-2 border-indigo-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-indigo-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                      Live Student Preview (KaTeX &amp; Tiptap Renderer)
                    </h3>
                  </div>
                  <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                    {draftType}
                  </span>
                </div>

                {activeQuestion.sharedPassage && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-1 text-[11px] font-bold uppercase text-slate-500">
                      Shared Passage
                    </div>
                    <StudentLivePreview doc={activeQuestion.sharedPassage} />
                  </div>
                )}

                <div className="mt-4">
                  <div className="mb-1 text-xs font-bold text-slate-500">
                    Question {draftQNumber}:
                  </div>
                  <StudentLivePreview doc={draftQuestionDoc} className="text-base" />
                </div>

                {draftOptions.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {draftOptions.map((opt) => {
                      const isAns = isOptionCorrect(opt);
                      return (
                        <div
                          key={opt.id}
                          className={`flex items-start justify-between gap-2.5 rounded-lg border px-3 py-2 ${
                            isAns
                              ? "border-emerald-400 bg-emerald-50/70"
                              : "border-slate-200 bg-slate-50/40"
                          }`}
                        >
                          <div className="flex items-start gap-2.5 flex-1 min-w-0">
                            <span
                              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                isAns
                                  ? "bg-emerald-600 text-white"
                                  : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {opt.id}
                            </span>
                            <div className="flex-1">
                              <StudentLivePreview doc={opt.content} />
                            </div>
                          </div>
                          {isAns && (
                            <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                              ✓ Correct Answer
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {draftExplanation && (
                  <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/40 p-3.5">
                    <div className="mb-1 text-xs font-bold text-blue-900">Explanation:</div>
                    <StudentLivePreview doc={draftExplanation} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
