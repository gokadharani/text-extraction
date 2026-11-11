"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import {
  UploadCloud,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  Ban,
  ScanLine,
  PenTool,
  FileCode,
  Check,
  Sparkles
} from "lucide-react";

export type UploadCategory =
  | "AUTO_DETECT"
  | "DIGITAL_PDF"
  | "SCANNED_PRINTED_PDF"
  | "SCANNED_HANDWRITTEN_PDF"
  | "OTHER_FORMATS";

export type UserDeclaredFormat =
  | "AUTO_DETECT"
  | "DIGITAL_PDF"
  | "SCANNED_PRINTED_PDF"
  | "SCANNED_HANDWRITTEN_PDF"
  | "DOCX"
  | "XLSX"
  | "IMAGE";

export interface DocumentCategoryOption {
  value: UploadCategory;
  title: string;
  description: string;
  infoNote?: string;
  supportedFormats?: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
}

const DOCUMENT_CATEGORY_OPTIONS: DocumentCategoryOption[] = [
  {
    value: "AUTO_DETECT",
    title: "Auto Detect",
    description: "Automatically detect the document format and extraction pathway.",
    badge: "Recommended",
    supportedFormats: "PDF, DOCX, DOC, XLSX, XLS, JPG, JPEG, PNG, WEBP",
    icon: Sparkles
  },
  {
    value: "DIGITAL_PDF",
    title: "Digital PDF",
    description: "A PDF created digitally, where text can be selected and copied.",
    icon: FileText
  },
  {
    value: "SCANNED_PRINTED_PDF",
    title: "Scanned PDF — Printed Text",
    description: "A scanned document containing printed questions and text.",
    icon: ScanLine
  },
  {
    value: "SCANNED_HANDWRITTEN_PDF",
    title: "Scanned PDF — Handwriting",
    description: "A scanned PDF containing handwritten questions or answers.",
    infoNote:
      "Handwriting recognition may be less accurate. Please review extracted questions and answers carefully.",
    icon: PenTool
  },
  {
    value: "OTHER_FORMATS",
    title: "Other Supported Formats",
    description: "Upload Word, Excel, or image documents.",
    supportedFormats: "DOCX, XLSX, JPG, JPEG, PNG, WEBP",
    icon: FileCode
  }
];

// Backwards compatibility alias
const DOCUMENT_TYPE_OPTIONS = DOCUMENT_CATEGORY_OPTIONS;

const CATEGORY_ALLOWED_EXTENSIONS: Record<UploadCategory, string[]> = {
  AUTO_DETECT: ["pdf", "docx", "doc", "xlsx", "xls", "png", "jpg", "jpeg", "webp"],
  DIGITAL_PDF: ["pdf"],
  SCANNED_PRINTED_PDF: ["pdf"],
  SCANNED_HANDWRITTEN_PDF: ["pdf"],
  OTHER_FORMATS: ["docx", "doc", "xlsx", "xls", "png", "jpg", "jpeg", "webp"]
};

const CATEGORY_ACCEPT_ATTR: Record<UploadCategory, string> = {
  AUTO_DETECT: ".pdf,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg,.webp",
  DIGITAL_PDF: ".pdf",
  SCANNED_PRINTED_PDF: ".pdf",
  SCANNED_HANDWRITTEN_PDF: ".pdf",
  OTHER_FORMATS: ".docx,.xlsx,.jpg,.jpeg,.png,.webp,.doc,.xls"
};

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

function resolveDeclaredFormatForFile(
  category: UploadCategory,
  fileName: string
): UserDeclaredFormat {
  if (category === "AUTO_DETECT") return "AUTO_DETECT";
  if (category === "DIGITAL_PDF") return "DIGITAL_PDF";
  if (category === "SCANNED_PRINTED_PDF") return "SCANNED_PRINTED_PDF";
  if (category === "SCANNED_HANDWRITTEN_PDF") return "SCANNED_HANDWRITTEN_PDF";

  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (ext === "docx" || ext === "doc") return "DOCX";
  if (ext === "xlsx" || ext === "xls") return "XLSX";
  if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp") return "IMAGE";

  return "AUTO_DETECT";
}

interface QueuedUploadFile {
  id: string;
  file: File;
  status: "READY" | "UPLOADING" | "COMPLETED" | "ERROR" | "CANCELLED";
  progress: number;
  errorMessage?: string;
  createdJobId?: string;
  isDuplicate?: boolean;
}

export default function UploadDocumentsPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedCategory, setSelectedCategory] = useState<UploadCategory | null>(null);
  const [categoryChangeNotice, setCategoryChangeNotice] = useState<string | null>(null);
  const [files, setFiles] = useState<QueuedUploadFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [rejectDuplicate, setRejectDuplicate] = useState(false);
  const [aiBudgetUsd, setAiBudgetUsd] = useState("0.50");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeXhrs = useRef<Map<string, XMLHttpRequest>>(new Map());

  const handleSelectCategory = (newCat: UploadCategory) => {
    setSelectedCategory(newCat);
    if (files.length > 0) {
      const allowed = CATEGORY_ALLOWED_EXTENSIONS[newCat];
      const compatible: QueuedUploadFile[] = [];
      let removedCount = 0;

      for (const f of files) {
        if (f.status === "COMPLETED" || f.status === "UPLOADING") {
          compatible.push(f);
          continue;
        }
        const ext = f.file.name.split(".").pop()?.toLowerCase() || "";
        if (allowed.includes(ext)) {
          compatible.push(f);
        } else {
          removedCount++;
        }
      }

      if (removedCount > 0) {
        setFiles(compatible);
        const catOpt = DOCUMENT_CATEGORY_OPTIONS.find((c) => c.value === newCat);
        setCategoryChangeNotice(
          `Removed ${removedCount} incompatible file(s) that do not match ${catOpt?.title || newCat}.`
        );
      } else {
        setCategoryChangeNotice(null);
      }
    }
  };

  const validateAndAddFiles = (incomingList: FileList | File[]) => {
    const nextItems: QueuedUploadFile[] = [];
    const activeCategory = selectedCategory || "AUTO_DETECT";
    const allowed = CATEGORY_ALLOWED_EXTENSIONS[activeCategory];
    const categoryOption =
      DOCUMENT_CATEGORY_OPTIONS.find((c) => c.value === activeCategory) ||
      DOCUMENT_CATEGORY_OPTIONS[0];

    for (const file of Array.from(incomingList)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      if (file.size === 0) {
        nextItems.push({
          id,
          file,
          status: "ERROR",
          progress: 0,
          errorMessage: "File is empty (0 bytes)."
        });
        continue;
      }

      if (file.size > MAX_SIZE_BYTES) {
        nextItems.push({
          id,
          file,
          status: "ERROR",
          progress: 0,
          errorMessage: `File exceeds 50 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`
        });
        continue;
      }

      if (!allowed.includes(ext)) {
        let errorMsg = `Unsupported extension ".${ext}".`;
        if (activeCategory === "AUTO_DETECT") {
          errorMsg = `Unsupported extension ".${ext}". Allowed: PDF, DOCX, DOC, XLSX, XLS, JPG, JPEG, PNG, WEBP.`;
        } else if (activeCategory === "OTHER_FORMATS") {
          errorMsg =
            ext === "pdf"
              ? `PDF files are not supported under 'Other Supported Formats'. Please select a PDF category in Step 1.`
              : `Unsupported extension ".${ext}". Allowed: DOCX, XLSX, JPG, JPEG, PNG, WEBP.`;
        } else {
          errorMsg = `File "${file.name}" is not a PDF. Only .pdf files are accepted for ${categoryOption.title}.`;
        }

        nextItems.push({
          id,
          file,
          status: "ERROR",
          progress: 0,
          errorMessage: errorMsg
        });
        continue;
      }

      nextItems.push({
        id,
        file,
        status: "READY",
        progress: 0
      });
    }

    setFiles((prev) => [...prev, ...nextItems]);
  };

  const uploadSingleItem = (item: QueuedUploadFile) => {
    const activeCategory = selectedCategory || "AUTO_DETECT";
    const ext = item.file.name.split(".").pop()?.toLowerCase() || "";
    const allowed = CATEGORY_ALLOWED_EXTENSIONS[activeCategory];

    if (!allowed.includes(ext)) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id
            ? {
                ...f,
                status: "ERROR",
                progress: 0,
                errorMessage: `Cannot upload: file extension ".${ext}" is not supported for ${activeCategory}.`
              }
            : f
        )
      );
      return;
    }

    setFiles((prev) =>
      prev.map((f) =>
        f.id === item.id ? { ...f, status: "UPLOADING", progress: 5, errorMessage: undefined } : f
      )
    );

    const xhr = new XMLHttpRequest();
    activeXhrs.current.set(item.id, xhr);

    const declaredFormat = resolveDeclaredFormatForFile(activeCategory, item.file.name);

    const formData = new FormData();
    formData.append("file", item.file);
    formData.append("userDeclaredFormat", declaredFormat);
    formData.append("rejectDuplicate", String(rejectDuplicate));
    formData.append("aiBudgetUsd", aiBudgetUsd);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.min(95, Math.round((event.loaded / event.total) * 100));
        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, progress: pct } : f))
        );
      }
    };

    xhr.onload = () => {
      activeXhrs.current.delete(item.id);
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300 && data.job) {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    status: "COMPLETED",
                    progress: 100,
                    createdJobId: data.job.id,
                    isDuplicate: Boolean(data.job.isDuplicateFile)
                  }
                : f
            )
          );
        } else {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    status: "ERROR",
                    progress: 0,
                    errorMessage:
                      data.error?.message || `Upload rejected (HTTP ${xhr.status})`
                  }
                : f
            )
          );
        }
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === item.id
              ? { ...f, status: "ERROR", progress: 0, errorMessage: "Unexpected server response" }
              : f
          )
        );
      }
    };

    xhr.onerror = () => {
      activeXhrs.current.delete(item.id);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id
            ? { ...f, status: "ERROR", progress: 0, errorMessage: "Network upload error" }
            : f
        )
      );
    };

    xhr.onabort = () => {
      activeXhrs.current.delete(item.id);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id
            ? {
                ...f,
                status: "CANCELLED",
                progress: 0,
                errorMessage: "Upload cancelled by user"
              }
            : f
        )
      );
    };

    xhr.open("POST", "/api/imports", true);
    xhr.setRequestHeader("x-qbank-client", "web-workspace");
    xhr.send(formData);
  };

  const handleUploadAllReady = () => {
    for (const item of files) {
      if (item.status === "READY") {
        uploadSingleItem(item);
      }
    }
  };

  const handleCancelUpload = (id: string) => {
    const xhr = activeXhrs.current.get(id);
    if (xhr) {
      xhr.abort();
    }
  };

  const handleRemoveItem = (id: string) => {
    handleCancelUpload(id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const readyCount = files.filter((f) => f.status === "READY").length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Upload Question Papers
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Extract questions from digital, scanned, or typed documents with formatting preserved.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          Back to Dashboard
        </Link>
      </div>

      {/* Step Indicator */}
      <div className="mt-6 flex items-center gap-3 text-sm border-b border-slate-200 pb-4">
        <button
          type="button"
          onClick={() => setStep(1)}
          className={`flex items-center gap-2 font-medium transition ${
            step === 1 ? "text-blue-600" : "text-slate-600 hover:text-slate-900 cursor-pointer"
          }`}
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
              step === 1
                ? "bg-blue-600 text-white"
                : "bg-slate-200 text-slate-700"
            }`}
          >
            1
          </span>
          Select Document Type
        </button>
        <span className="text-slate-300">/</span>
        <button
          type="button"
          onClick={() => {
            if (selectedCategory) setStep(2);
          }}
          className={`flex items-center gap-2 font-medium transition ${
            step === 2
              ? "text-blue-600"
              : selectedCategory
                ? "text-slate-600 hover:text-slate-900 cursor-pointer"
                : "text-slate-400 cursor-not-allowed"
          }`}
        >
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
              step === 2
                ? "bg-blue-600 text-white"
                : "bg-slate-200 text-slate-700"
            }`}
          >
            2
          </span>
          Upload Files
        </button>
      </div>

      {/* STEP 1: Document Type Selection */}
      {step === 1 && (
        <div className="mt-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              Select Document Category
            </h2>
            <p className="text-xs text-slate-500">
              Choose the category that matches your questions to configure targeted text extraction and OCR pipelines.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {DOCUMENT_CATEGORY_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isSelected = selectedCategory === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelectCategory(option.value)}
                  className={`relative flex flex-col items-start p-5 text-left rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? "border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/20 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                        isSelected
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex items-center gap-2">
                      {option.badge && (
                        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                          {option.badge}
                        </span>
                      )}
                      {isSelected && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3.5 w-full">
                    <div className="text-sm font-semibold text-slate-900">
                      {option.title}
                    </div>
                    <div className="mt-1 text-xs text-slate-600 leading-relaxed">
                      {option.description}
                    </div>
                    {option.infoNote && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 leading-relaxed">
                        <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                        <span>{option.infoNote}</span>
                      </div>
                    )}
                    {option.supportedFormats && (
                      <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">Supported formats:</span>{" "}
                        <span className="font-mono text-[11px] text-slate-800">{option.supportedFormats}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {!selectedCategory ? "Please select a category to proceed." : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                if (!selectedCategory) return;
                setStep(2);
              }}
              disabled={!selectedCategory}
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition ${
                selectedCategory
                  ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
                  : "bg-slate-300 cursor-not-allowed"
              }`}
            >
              Continue to Upload
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: File Upload Dropzone & Queue */}
      {step === 2 && (
        <div className="mt-6">
          {/* Selected Document Type Banner */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              {(() => {
                const opt =
                  DOCUMENT_CATEGORY_OPTIONS.find((o) => o.value === selectedCategory) ||
                  DOCUMENT_CATEGORY_OPTIONS[0];
                const Icon = opt.icon;
                return (
                  <>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700 shrink-0">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Selected Category:
                        </span>
                        <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          {opt.title}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {opt.description}
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition shrink-0 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Change Format
            </button>
          </div>

          {selectedCategory === "SCANNED_HANDWRITTEN_PDF" && (
            <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <span className="font-semibold">Handwritten Document Note:</span> Handwriting recognition may be less accurate. Please review extracted questions and answers carefully in the Split-Screen Review workspace.
              </div>
            </div>
          )}

          {categoryChangeNotice && (
            <div className="mt-3 flex items-center justify-between gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-blue-600" />
                <span>{categoryChangeNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setCategoryChangeNotice(null)}
                className="text-blue-600 hover:text-blue-900 font-semibold cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                validateAndAddFiles(e.dataTransfer.files);
              }
            }}
            className={`mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${
              dragOver
                ? "border-blue-600 bg-blue-50/50"
                : "border-slate-300 bg-white hover:border-blue-400"
            }`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <UploadCloud className="h-6 w-6" />
            </div>
            <h2 className="mt-3 text-base font-semibold text-slate-900">
              Drag &amp; drop question documents here
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {selectedCategory === "AUTO_DETECT"
                ? "Supported: PDF, DOCX, DOC, XLSX, XLS, JPG, JPEG, PNG, WEBP (up to 50 MB per file)"
                : selectedCategory === "OTHER_FORMATS"
                  ? "Supported: DOCX, XLSX, JPG, JPEG, PNG, WEBP (up to 50 MB per file)"
                  : "Supported: PDF documents (.pdf) up to 50 MB per file"}
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={selectedCategory ? CATEGORY_ACCEPT_ATTR[selectedCategory] : ".pdf"}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  validateAndAddFiles(e.target.files);
                  e.target.value = "";
                }
              }}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition cursor-pointer"
            >
              Browse Files
            </button>
          </div>

          {/* Pipeline Options */}
          <div className="mt-6 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={rejectDuplicate}
                  onChange={(e) => setRejectDuplicate(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                Block Duplicate File Uploads (SHA-256)
              </label>
              <p className="mt-1 text-xs text-slate-500">
                When enabled, uploading a file with an identical SHA-256 hash is rejected with HTTP 409 instead of creating a duplicate-flagged import.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800">
                Selective AI Repair Budget Cap (USD per Import)
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="5"
                  value={aiBudgetUsd}
                  onChange={(e) => setAiBudgetUsd(e.target.value)}
                  className="w-28 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                />
                <span className="text-xs text-slate-500">
                  Stops optional AI calls if reached; continues deterministic extraction.
                </span>
              </div>
            </div>
          </div>

          {/* File Queue */}
          {files.length > 0 && (
            <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
                <h3 className="text-sm font-semibold text-slate-900">
                  Selected Files ({files.length})
                </h3>
                {readyCount > 0 && (
                  <button
                    type="button"
                    onClick={handleUploadAllReady}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition cursor-pointer"
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    Start Upload &amp; Extraction ({readyCount})
                  </button>
                )}
              </div>

              <ul className="divide-y divide-slate-200">
                {files.map((item) => (
                  <li key={item.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-5 w-5 shrink-0 text-blue-600" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900">
                            {item.file.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {(item.file.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {item.status === "READY" && (
                          <button
                            type="button"
                            onClick={() => uploadSingleItem(item)}
                            className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition cursor-pointer"
                          >
                            Upload
                          </button>
                        )}

                        {item.status === "UPLOADING" && (
                          <button
                            type="button"
                            onClick={() => handleCancelUpload(item.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition cursor-pointer"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            Cancel
                          </button>
                        )}

                        {item.status === "COMPLETED" && item.createdJobId && (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="h-4 w-4" />
                              Uploaded
                            </span>
                            <Link
                              href={`/imports/${item.createdJobId}`}
                              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 transition"
                            >
                              View Progress
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
                          title="Remove from list"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {item.status === "UPLOADING" && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full bg-blue-600 transition-all"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}

                    {item.isDuplicate && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Duplicate SHA-256 detected: this file matches a previously uploaded document.
                      </div>
                    )}

                    {item.errorMessage && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>{item.errorMessage}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
