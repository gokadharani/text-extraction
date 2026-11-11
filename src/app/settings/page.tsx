import React from "react";
import { getAppConfig } from "@/config/env";
import { Settings, Shield, Cpu, ScanLine, HardDrive } from "lucide-react";

export default function SettingsPage() {
  const config = getAppConfig();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Pipeline &amp; Security Settings
          </h1>
          <p className="text-sm text-slate-600">
            Active environment configuration for document extraction, OCR adapters, selective AI repair, and private object storage.
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Shield className="h-4 w-4 text-blue-600" />
            Upload &amp; Processing Guardrails
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Max File Size Limit</dt>
              <dd className="font-mono font-semibold">
                {(config.limits.maxFileSizeBytes / (1024 * 1024)).toFixed(0)} MB
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Max Page Count</dt>
              <dd className="font-mono font-semibold">{config.limits.maxPageCount} pages</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Max Image Dimension</dt>
              <dd className="font-mono font-semibold">{config.limits.maxImageDimension}px</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Processing Timeout</dt>
              <dd className="font-mono font-semibold">
                {config.limits.processingTimeoutMs / 1000}s
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Binary Magic-Byte Verification</dt>
              <dd className="font-semibold text-emerald-700">Enforced</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <ScanLine className="h-4 w-4 text-indigo-600" />
            OCR Provider Adapter
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Configured Provider</dt>
              <dd className="font-mono font-semibold uppercase">{config.ocr.provider}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Low Confidence Threshold</dt>
              <dd className="font-mono font-semibold">
                {(config.ocr.lowConfidenceThreshold * 100).toFixed(0)}%
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">OCR Max Retries</dt>
              <dd className="font-mono font-semibold">{config.ocr.maxRetries}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">OCR Timeout</dt>
              <dd className="font-mono font-semibold">{config.ocr.timeoutMs} ms</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Sharp Preprocessing</dt>
              <dd className="font-semibold text-emerald-700">
                Rotate + Normalize + Denoise
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Cpu className="h-4 w-4 text-emerald-600" />
            Selective OpenAI Cost Control
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">OpenAI API Key Status</dt>
              <dd className="font-semibold">
                {config.ai.openAiApiKey ? "Configured (Redacted)" : "Not Set (Deterministic Mode)"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Routine Repair Model</dt>
              <dd className="font-mono font-semibold">{config.ai.defaultModel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Escalation Model</dt>
              <dd className="font-mono font-semibold">{config.ai.escalationModel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Default Per-Import Budget</dt>
              <dd className="font-mono font-semibold">
                ${config.ai.budgetPerImportUsd.toFixed(2)} USD
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Max Output Tokens</dt>
              <dd className="font-mono font-semibold">{config.ai.maxOutputTokens}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <HardDrive className="h-4 w-4 text-slate-700" />
            Private Storage &amp; Queue Infrastructure
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Storage Adapter</dt>
              <dd className="font-mono font-semibold uppercase">{config.storageProvider}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Public File URLs</dt>
              <dd className="font-semibold text-emerald-700">Disabled (Signed Only)</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Queue Engine</dt>
              <dd className="font-mono font-semibold">BullMQ + Redis</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
