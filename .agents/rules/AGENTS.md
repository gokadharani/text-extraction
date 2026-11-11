# Workspace Rules & Repository Knowledge — AI Question Paper Extraction & Question Bank System

## 1. Product & PRD Reference
All engineering work in this repository is governed by [`AI_Question_Extraction_System_PRD.md`](../../AI_Question_Extraction_System_PRD.md).
The system extracts individual questions (`MCQ`, `MSQ`, `TRUE_FALSE`, `UNKNOWN`) from uploaded educational documents (`PDF`, `Scanned PDF`, `Mixed PDF`, `DOCX`, `DOC`, `XLSX`, `XLS`, `PNG`, `JPG`, `JPEG`, `WEBP`), preserves rich-text formatting as **Tiptap/ProseMirror JSON** stored in **PostgreSQL `JSONB`** columns, repairs ambiguous candidates selectively via **OpenAI Structured Outputs**, and provides a split-screen **Review Workspace** before publishing to the Question Bank.

---

## 2. Repository Architecture Map

```text
d:/trash/q-a/
├── AI_Question_Extraction_System_PRD.md       # Authoritative Product Requirements Document
├── prisma/
│   └── schema.prisma                          # PostgreSQL schema (ImportJob, ImportPage, Question, QuestionAsset, QuestionReviewLog, AiRepairCache, OcrCache)
├── src/
│   ├── config/
│   │   └── env.ts                             # Typed env & limits config (getAppConfig)
│   ├── domain/
│   │   ├── schemas/
│   │   │   └── question.schema.ts             # Recursive Zod schemas (TiptapDocSchema, QuestionOptionSchema, QuestionAnswerSchema, ValidatedQuestionPayloadSchema)
│   │   ├── richtext/
│   │   │   └── tiptap-converter.ts            # textToTiptapDoc, htmlToTiptapDoc, tiptapDocToPlainText, tableMatrixToTiptapNode, computeQuestionContentHash
│   │   └── extraction/
│   │       ├── text-normalizer.ts             # normalizePageText (Unicode, math delimiters, whitespace)
│   │       └── question-segmenter.ts          # segmentAndParseQuestions (all numbering styles, multi-page stems, type detection, answer keys, explanations)
│   ├── adapters/
│   │   ├── documents/
│   │   │   ├── document-classifier.ts         # classifyAndExtractDocument router
│   │   │   ├── pdf-extractor.ts               # extractPdfDocument (pdfjs-dist digital extraction + per-page independent OCR decision)
│   │   │   ├── docx-extractor.ts              # extractWordDocument (mammoth + XML/table/image asset extraction)
│   │   │   └── xlsx-extractor.ts              # extractExcelDocument (exceljs structured question columns & free-form sheets)
│   │   ├── ocr/
│   │   │   ├── image-preprocessor.ts          # preprocessImageForOCR (sharp rotation, grayscale, contrast normalize, median denoise)
│   │   │   └── ocr-provider.ts                # OCRProvider interface, PaddleOCRProvider, ManagedOCRProvider, LocalFallbackOCRProvider, ResilientOCRService
│   │   └── ai/
│   │       └── selective-ai-repair.ts         # SelectiveAIRepairService, OpenAIStructuredRepairClient, OPENAI_REPAIR_JSON_SCHEMA, budget cap & AiRepairCache
│   ├── repositories/
│   │   └── question-bank.repository.ts        # QuestionBankRepository (Prisma PostgreSQL + transactional failover store)
│   ├── services/
│   │   ├── import-pipeline.service.ts         # ImportPipelineService (17-stage idempotent pipeline)
│   │   └── export.service.ts                  # generateImportExport (json, xlsx, csv, report)
│   ├── queue/
│   │   └── import-queue.ts                    # enqueueImportJob & cancelQueuedImportJob (BullMQ + Redis with async fallback)
│   ├── worker/
│   │   └── index.ts                           # Standalone BullMQ worker process
│   ├── lib/
│   │   ├── auth/security.ts                   # withApiProtection, authenticateRequest, checkRateLimit, createSignedAssetUrl
│   │   ├── storage/file-validator.ts          # validateUploadedFile (magic bytes, encryption/executable rejection, SHA-256)
│   │   ├── storage/storage-provider.ts        # StorageProvider, LocalPrivateStorageAdapter, S3PrivateStorageAdapter
│   │   ├── api-serializers.ts                 # serializeImportJob, serializeImportPage, serializeQuestion (strips storageKey/sourceFileId)
│   │   ├── sample-documents.ts                # Deterministic binary PDF/DOCX/XLSX/PNG builders
│   │   └── logger.ts                          # StructuredLogger with automatic secret & document redaction
│   ├── components/
│   │   ├── layout/AppShell.tsx                # Navigation shell
│   │   └── richtext/
│   │       ├── TiptapRichEditor.tsx           # Tiptap ProseMirror editor with MathInline/MathBlock/Table/Marks + LaTeX/MD source toggle
│   │       └── StudentLivePreview.tsx         # Recursive Tiptap AST renderer with KaTeX math rendering
│   └── app/
│       ├── page.tsx                           # Import Dashboard (FR-02)
│       ├── upload/page.tsx                    # Upload Documents (FR-01)
│       ├── imports/[id]/page.tsx              # Import Processing Details
│       ├── imports/[id]/review/page.tsx       # Split-Screen Question Review Workspace (FR-11)
│       ├── question-bank/page.tsx             # Published Question Bank (FR-12)
│       ├── history/page.tsx                   # Import History & Audit Reports
│       ├── settings/page.tsx                  # Pipeline & Security Settings
│       └── api/                               # REST Route Handlers (Section 7)
└── tests/
    ├── documents-and-ocr.test.ts              # Digital/Scanned/Mixed PDF, DOCX, XLSX, Image OCR, retries, file security tests
    ├── segmentation-and-richtext.test.ts      # Numbering styles, MCQ/MSQ/TF/UNKNOWN, multi-page, answer keys, Tiptap JSON, hashes
    ├── pipeline-ai-and-workflow.test.ts       # Selective AI repair, budget cap, Zod rejection, idempotency, approval, exports
    └── api-routes.test.ts                     # Route Handler auth, 409 duplicate check, full lifecycle, storageKey redaction
```

---

## 3. Non-Negotiable Engineering Guardrails (PRD Invariants)

1. **Deterministic-First & Selective AI (`FR-03`, `FR-10`, Section 6)**:
   - Digital PDFs must NEVER invoke OCR or OpenAI.
   - Mixed PDFs must evaluate each page independently (`MIN_USABLE_DIGITAL_CHARS_PER_PAGE = 20`) and run OCR only on scanned/image pages.
   - Well-formed `MCQ`, `MSQ`, and `TRUE_FALSE` questions must NEVER be sent to OpenAI.
   - OpenAI (`SelectiveAIRepairService`) is invoked only when `shouldInvokeAiRepair(candidate)` is true AND total import spend is below `aiBudgetUsd`.
2. **No Silent Guessing (`FR-06`, `FR-08`, `FR-09`)**:
   - Do not classify every optioned question as `MCQ`. When neither section header, stem, nor answer disambiguates single-choice vs multi-select, classify as `UNKNOWN` and set `reviewStatus = "NEEDS_ATTENTION"`.
   - Never silently solve questions or invent explanations. Missing answers must use `answerProvenance = "MISSING"` (`status: "missing"`, `value: []`); missing explanations must be `null`.
3. **Rich-Text JSONB Integrity (`FR-07`, Section 4)**:
   - Always validate `question`, `options`, `answer`, and `explanation` through `TiptapDocSchema` / `ValidatedQuestionPayloadSchema` before persistence.
   - Never store raw HTML as canonical question content, and never store base64 images `> 4 KB` inside `JSONB` (store binary images in `StorageProvider` + `QuestionAsset` and reference by `assetId`).
4. **Idempotency & Security (`FR-01`, Section 7, Section 9)**:
   - Staging questions are upserted transactionally keyed by `(importJobId, sourceOrder)`. Retrying a job must never duplicate questions.
   - Always serialize API responses through `serializeImportJob`, `serializeImportPage`, and `serializeQuestion` so internal `storageKey` and `sourceFileId` paths are never leaked.
   - Wrap untrusted document text sent to OpenAI inside `<UNTRUSTED_QUESTION_SNIPPET>` tags and enforce strict JSON Schema outputs.
5. **Verification Before Completion (Section 11, Section 14)**:
   - Every code edit must pass `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` before claiming completion.
