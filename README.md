# QBank Intelligence — AI Question Paper Extraction & Question Bank System

Production-grade document-to-question-bank extraction pipeline built with **Next.js (App Router)**, **TypeScript**, **PostgreSQL**, **Prisma ORM**, **Tiptap ProseMirror Rich-Text JSONB**, **PDF.js**, **Mammoth**, **ExcelJS**, **Sharp**, **BullMQ + Redis**, **PaddleOCR / Managed OCR Adapters**, and **Selective OpenAI Structured Outputs**.

---

## 1. Architecture Overview

The system follows Clean Architecture with strict separation between domain logic, document/OCR/AI adapters, persistence repositories, background job workers, REST route handlers, and React/Tiptap UI components:

```text
src/
├── config/
│   └── env.ts                         # Typed environment & guardrail limits configuration
├── domain/
│   ├── schemas/
│   │   └── question.schema.ts         # Recursive Zod schemas for Tiptap JSON, Options, Answer, Explanation
│   ├── richtext/
│   │   └── tiptap-converter.ts        # Reusable Rich-Text JSON conversion, KaTeX math, tables, SHA-256 hashing
│   └── extraction/
│       ├── text-normalizer.ts         # Unicode, math delimiter, and whitespace normalization
│       └── question-segmenter.ts      # Stateful multi-page segmenter, type detector, answer-key & explanation matcher
├── adapters/
│   ├── documents/
│   │   ├── document-classifier.ts     # Format classifier & router (PDF, Scanned PDF, Mixed PDF, DOCX, XLSX, Images)
│   │   ├── pdf-extractor.ts           # PDF.js digital text extractor + per-page independent OCR decision
│   │   ├── docx-extractor.ts          # Mammoth + XML/table/image extractor
│   │   └── xlsx-extractor.ts          # ExcelJS structured question sheet & free-form worksheet extractor
│   ├── ocr/
│   │   ├── image-preprocessor.ts      # Sharp rotation, deskewing, contrast enhancement, denoising, resolution clamping
│   │   └── ocr-provider.ts            # OCRProvider interface, PaddleOCR, ManagedOCR, retries, timeout & caching
│   └── ai/
│       └── selective-ai-repair.ts     # Selective OpenAI Structured Outputs (JSON Schema), budget cap, caching
├── repositories/
│   └── question-bank.repository.ts    # Transactional Prisma PostgreSQL repository + local failover store
├── services/
│   ├── import-pipeline.service.ts     # 17-stage idempotent document processing pipeline
│   └── export.service.ts              # JSON (Rich-Text JSONB), XLSX, CSV, and Audit Report exporters
├── queue/
│   └── import-queue.ts                # BullMQ + Redis producer & non-blocking local worker fallback
├── worker/
│   └── index.ts                       # Standalone BullMQ worker process
├── lib/
│   ├── auth/security.ts               # Bearer/API-key/Session auth, sliding-window rate limiter, signed asset URLs
│   ├── storage/file-validator.ts      # Binary magic-byte validator, encryption/malware rejection, SHA-256 digest
│   ├── storage/storage-provider.ts    # Private Local & S3/MinIO object storage adapters
│   └── logger.ts                      # Structured JSON logger with automatic secret/document redaction
└── app/
    ├── api/                           # REST Route Handlers (/api/imports, /api/questions, /api/question-bank, /api/assets)
    ├── imports/[id]/                  # Processing Telemetry Details & Split-Screen Question Review Workspace
    ├── upload/                        # Drag-and-Drop Multi-File Upload Interface
    ├── question-bank/                 # Published Question Bank Search & Filter Interface
    ├── history/                       # Import Audit History
    └── settings/                      # Pipeline & Security Settings
```

---

## 2. Database Schema (`prisma/schema.prisma`)

- **`ImportJob`**: Tracks uploaded file metadata, binary SHA-256 hash, private `storageKey`, status (`UPLOADED`, `QUEUED`, `PROCESSING`, `REVIEW_REQUIRED`, `COMPLETED`, `FAILED`), per-stage progress, OCR method & duration, and OpenAI token/USD telemetry.
- **`ImportPage`**: Stores per-page classification (`DIGITAL`, `SCANNED`, `MIXED`, `TABULAR`, `DOCUMENT_FLOW`), raw/normalized text, OCR confidence, and bounding boxes. Unique constraint on `(importJobId, pageNumber)`.
- **`Question`**: Stores `question`, `options`, `answer`, and `explanation` in PostgreSQL `JSONB` columns using Tiptap ProseMirror JSON, along with `type` (`MCQ`, `MSQ`, `TRUE_FALSE`, `UNKNOWN`), `answerProvenance` (`EXPLICIT_SOURCE`, `ANSWER_KEY`, `AI_INFERRED`, `MISSING`), `reviewStatus`, `confidence`, `warnings`, `contentHash`, and `isDuplicate`. Unique constraint on `(importJobId, sourceOrder)` for retry idempotency.
- **`QuestionAsset`**: Stores extracted diagram/image asset references in private storage (`storageKey`, `sha256`, `mimeType`) so large base64 strings are never stored inside PostgreSQL `JSONB`.
- **`QuestionReviewLog`**: Audit log of human edits, approvals, rejections, and AI repairs.
- **`AiRepairCache` & `OcrCache`**: Content-addressed caches preventing duplicate OCR or OpenAI calls across retries.

---

## 3. REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/imports` | Validate binary file signature, store in private storage, create `ImportJob`, and enqueue extraction |
| `GET` | `/api/imports` | List all import jobs ordered by creation date |
| `GET` | `/api/imports/[id]` | Retrieve import job details and per-page extraction summaries |
| `GET` | `/api/imports/[id]/status` | Retrieve real-time processing stage, progress, and telemetry |
| `POST` | `/api/imports/[id]/retry` | Retry a failed import job idempotently |
| `POST` | `/api/imports/[id]/cancel` | Cancel a queued import job |
| `GET` | `/api/imports/[id]/questions` | Retrieve all extracted staging/published questions for an import job |
| `PATCH` | `/api/questions/[id]` | Update question stem, options, answer, explanation, or type (Zod-validated) |
| `POST` | `/api/questions/[id]/approve` | Approve a question and publish to the Question Bank |
| `POST` | `/api/questions/[id]/reject` | Reject a question |
| `POST` | `/api/imports/[id]/bulk-approve` | Bulk approve or bulk reject questions in an import job |
| `GET/POST` | `/api/imports/[id]/export` | Export questions as `json` (Tiptap JSONB), `xlsx`, `csv`, or `report` |
| `DELETE` | `/api/imports/[id]` | Delete import job and securely wipe associated private storage objects |
| `GET` | `/api/question-bank` | Search and filter questions across the Question Bank |
| `GET` | `/api/assets/[id]` | Serve private diagram assets via HMAC-signed URL or authenticated session |

---

## 4. Setup & Running Instructions

### Prerequisites
- **Node.js**: v20+ (tested on Node v24.15.0)
- **PostgreSQL**: v15+ (or via `docker compose up -d`)
- **Redis**: v7+ (optional in local dev when `QUEUE_FALLBACK_IN_PROCESS="true"`)

### Step-by-Step Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Update `DATABASE_URL`, `REDIS_URL`, and optionally `OPENAI_API_KEY` and `PADDLE_OCR_ENDPOINT` in `.env`.

3. **(Optional) Start PostgreSQL, Redis, and MinIO via Docker Compose:**
   ```bash
   docker compose up -d
   ```

4. **Generate Prisma Client and push schema to PostgreSQL:**
   ```bash
   npm run db:generate
   npm run db:push
   ```

5. **Start the Next.js application (and standalone BullMQ worker if using Redis):**
   ```bash
   npm run dev
   # In a separate terminal when using Redis BullMQ:
   npm run worker
   ```

6. **Run Verification & Tests:**
   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```
