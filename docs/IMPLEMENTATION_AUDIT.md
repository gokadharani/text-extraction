# Codebase Implementation Audit: AI Question Extractor & Question Bank System

**Audit Date:** November 6, 2026  
**Audited Version:** 1.0.0  
**Stack:** Next.js 14.2.25 (App Router), TypeScript 5.7.3, PostgreSQL, Prisma 5.22.0, Tiptap 2.11.5, Sharp 0.33.5, PDF.js 3.11.174, Mammoth 1.8.0, ExcelJS 4.4.0, OpenAI SDK 4.104.0, BullMQ 5.34.0, Vitest 2.1.8  
**Verification Status:** All 36 automated unit & integration tests passing (`npm test`), full TypeScript compilation passing (`npm run typecheck`).

---

## 1. Project Overview

The **AI Question Extractor & Question Bank System** is an educational content ingestion and curation platform designed to extract structured assessments from diverse document formats:
- Multiple-Choice Questions (`MCQ`)
- Multiple-Select Questions (`MSQ`)
- True/False Questions (`TRUE_FALSE`)
- Ambiguous / Unclassified Question Candidates (`UNKNOWN`)

The system converts raw questions, options, answer keys, and explanations into canonical **Tiptap/ProseMirror JSON** documents, stores them in **PostgreSQL `JSONB`** columns, and presents them in a split-screen **Review Workspace** for educator validation, editing, and publishing.

### Key Architectural Invariants
1. **Deterministic-First:** Selectable digital text is parsed directly via `pdfjs-dist`, `mammoth`, and `exceljs`. OCR and OpenAI are bypassed entirely for well-formed digital questions.
2. **Selective AI Repair:** OpenAI Structured Outputs (`gpt-4o-mini`) are triggered only for ambiguous, malformed, or low-confidence question candidates, constrained by a strict per-import USD budget cap and SHA-256 response caching.
3. **No Silent Guessing:** When question types or answer keys cannot be resolved unambiguously from source text, the system classifies them as `UNKNOWN`, assigns `answerProvenance = "MISSING"` or `"UNCERTAIN"`, and flags `reviewStatus = "NEEDS_ATTENTION"` rather than hallucinating answers.
4. **Zero Raw HTML / Clean JSONB:** Questions, options, and explanations are validated through recursive Zod schemas (`TiptapDocSchema`, `ValidatedQuestionPayloadSchema`). Base64 image payloads $> 4\text{ KB}$ are stripped and stored in private object storage, referenced only by `assetId`.
5. **Fail-Safe Persistence:** `QuestionBankRepository` implements a dual-mode persistence architecture: Prisma with PostgreSQL when connected, and an in-process transactional JSON store (`.private-storage/local-db-store.json`) for zero-dependency local testing.

---

## 2. Existing Architecture

### 2.1 Framework & Core Dependencies
- **Next.js:** `14.2.25` using App Router (`src/app/`).
- **React:** `18.3.1` (Client components designated via `"use client"`).
- **TypeScript:** `5.7.3` configured with `target: ES2022`, `strict: true`, path alias `@/* -> ./src/*`.
- **Database / ORM:** Prisma Client `5.22.0` with PostgreSQL datasource (`prisma/schema.prisma`).
- **Rich Text:** `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-table`, `@tiptap/extension-subscript`, `@tiptap/extension-superscript`, `@tiptap/extension-underline` (v`2.11.5`).
- **Math Rendering:** `katex` `0.16.11` (inline and display math blocks).
- **Queue & Background Processing:** `bullmq` `5.34.0` with `ioredis` `5.4.2`, plus an in-process asynchronous fallback when Redis is absent.
- **AI SDK:** `openai` `4.104.0`.

### 2.2 Directory Structure
```text
├── prisma/
│   └── schema.prisma                          # PostgreSQL schema & enum definitions
├── src/
│   ├── config/
│   │   └── env.ts                             # Typed runtime config & limit enforcement (getAppConfig)
│   ├── domain/
│   │   ├── schemas/
│   │   │   └── question.schema.ts             # Recursive Tiptap & ValidatedQuestionPayload Zod schemas
│   │   ├── richtext/
│   │   │   └── tiptap-converter.ts            # Text/HTML/Table -> Tiptap AST & content hash computation
│   │   └── extraction/
│   │       ├── text-normalizer.ts             # Unicode, math delimiters & whitespace cleaner
│   │       └── question-segmenter.ts          # Multi-page question boundary segmenter & answer matcher
│   ├── adapters/
│   │   ├── documents/
│   │   │   ├── document-classifier.ts         # Strategy dispatcher for PDF/DOCX/XLSX/Images
│   │   │   ├── pdf-extractor.ts               # PDF.js digital extraction & per-page OCR decision
│   │   │   ├── docx-extractor.ts              # Mammoth DOCX/DOC extraction with asset extraction
│   │   │   └── xlsx-extractor.ts              # ExcelJS spreadsheet extractor
│   │   ├── ocr/
│   │   │   ├── image-preprocessor.ts          # Sharp deskew, resize, grayscale, contrast & denoise
│   │   │   └── ocr-provider.ts                # ResilientOCRService, PaddleOCR, Managed & Local providers
│   │   └── ai/
│   │       └── selective-ai-repair.ts         # Selective OpenAI repair, cost tracking, budget cap & cache
│   ├── repositories/
│   │   └── question-bank.repository.ts        # Prisma repository + transactional JSON failover store
│   ├── services/
│   │   ├── import-pipeline.service.ts         # 17-stage idempotent import pipeline
│   │   └── export.service.ts                  # JSON, XLSX, CSV, and markdown report exporters
│   ├── queue/
│   │   └── import-queue.ts                    # BullMQ queue with in-process timeout fallback
│   ├── worker/
│   │   └── index.ts                           # Standalone BullMQ worker CLI process
│   ├── lib/
│   │   ├── auth/security.ts                   # Token auth, rate limiting, and signed asset URLs
│   │   ├── storage/file-validator.ts          # Magic byte file signatures, malware & encryption checks
│   │   ├── storage/storage-provider.ts        # LocalPrivateStorageAdapter & S3PrivateStorageAdapter
│   │   ├── api-serializers.ts                 # StorageKey redaction serializers for API responses
│   │   ├── sample-documents.ts                # Deterministic binary document test builders
│   │   └── logger.ts                          # Structured logger with secret/PII redaction
│   ├── components/
│   │   ├── layout/AppShell.tsx                # SaaS navigation sidebar and shell
│   │   └── richtext/
│   │       ├── TiptapRichEditor.tsx           # WYSIWYG Tiptap editor with math/table/marks
│   │       └── StudentLivePreview.tsx         # KaTeX preview renderer for student view
│   └── app/
│       ├── page.tsx                           # Main Dashboard (job table, summary stats, sample trigger)
│       ├── upload/page.tsx                    # Drag-and-drop document upload interface
│       ├── imports/[id]/page.tsx              # Processing details & stage telemetry
│       ├── imports/[id]/review/page.tsx       # Split-screen question review workspace
│       ├── question-bank/page.tsx             # Published question bank search & filter
│       ├── history/page.tsx                   # Audit history & token consumption reports
│       ├── settings/page.tsx                  # Active pipeline limits & security configuration
│       └── api/                               # REST Route Handlers (Section 2.4)
└── tests/
    ├── documents-and-ocr.test.ts              # PDF, DOCX, XLSX, OCR, image preprocessing, security
    ├── segmentation-and-richtext.test.ts      # Numbering styles, MCQ/MSQ/TF, answer keys, Tiptap JSON
    ├── pipeline-ai-and-workflow.test.ts       # Selective AI repair, budget cap, idempotency, exports
    └── api-routes.test.ts                     # API auth, duplicate upload rejection, question review lifecycle
```

### 2.3 App Router Pages & Layouts
- `src/app/layout.tsx`: Root HTML shell wrapping all views in `<AppShell>`.
- `src/app/page.tsx`: Import Dashboard showing total jobs, stage progression, OCR durations, AI cost, and retry/cancel actions.
- `src/app/upload/page.tsx`: Document upload form supporting drag-and-drop, multi-file queueing, XHR progress bars, duplicate blocking toggle, and AI budget configuration.
- `src/app/imports/[id]/page.tsx`: Detailed import inspector displaying per-page classifications, OCR durations, token usage, and error codes.
- `src/app/imports/[id]/review/page.tsx`: Split-screen review workspace (original document preview + OCR bounding boxes on left; Tiptap editor and KaTeX live preview on right).
- `src/app/question-bank/page.tsx`: Curated question bank with search, type filters (`MCQ`, `MSQ`, `TRUE_FALSE`), status filters, and copy actions.
- `src/app/history/page.tsx`: Historical import audit log with token expenditure and OCR performance logs.
- `src/app/settings/page.tsx`: Read-only view of active limits, OCR providers, and security parameters.

### 2.4 API Routes (REST Route Handlers)
*Note: The codebase uses Next.js Route Handlers (`route.ts`) exclusively; no Server Actions are used.*
- `GET /api/imports`: Lists all import jobs (`serializeImportJob`).
- `POST /api/imports`: Uploads files, validates binary signatures, creates `ImportJob`, and enqueues processing.
- `GET /api/imports/[id]`: Returns single import job metadata and associated `ImportPage` records.
- `GET /api/imports/[id]/status`: Lightweight polling endpoint for stage, progress percentage, and status.
- `POST /api/imports/[id]/retry`: Resumes/re-runs a failed or stalled import job idempotently.
- `POST /api/imports/[id]/cancel`: Cancels an active or queued import job.
- `GET /api/imports/[id]/questions`: Retrieves extracted staged questions (`serializeQuestion`).
- `POST /api/imports/[id]/bulk-approve`: Bulk-approves all pending questions in an import and publishes to the Question Bank.
- `GET /api/imports/[id]/export`: Generates downloadable exports in `json`, `xlsx`, `csv`, or `report` formats.
- `GET /api/questions/[id]`: Retrieves single question record.
- `PATCH /api/questions/[id]`: Updates question stem, options, answer, explanation, or review status with Zod schema re-validation.
- `POST /api/questions/[id]/approve`: Approves a question, publishes it to the question bank, and writes a `QuestionReviewLog`.
- `POST /api/questions/[id]/reject`: Rejects a question with optional reviewer notes.
- `GET /api/question-bank`: Queries published questions with text search and type filtering.
- `GET /api/assets/[id]`: Serves binary images from private storage using HMAC-SHA256 signed tokens (`createSignedAssetUrl`).
- `POST /api/imports/sample`: Generates a deterministic sample assessment for immediate pipeline demonstration.

### 2.5 Environment Variable Configuration (`src/config/env.ts`)
| Variable | Default Fallback | Purpose |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://postgres:123456@localhost:5432/question_bank?schema=public` | Prisma PostgreSQL connection string |
| `APP_AUTH_SECRET` | `default-dev-auth-secret-do-not-use-in-prod-32chars` | HMAC token signing secret |
| `DEFAULT_API_TOKEN` | `qbank-dev-token-2026` | API bearer token for testing / external API clients |
| `SIGNED_URL_SECRET` | `default-signed-asset-url-secret-key-2026` | HMAC signing key for secure image asset retrieval |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ Redis connection URL |
| `QUEUE_FALLBACK_IN_PROCESS` | `true` | Allows execution when Redis is not running |
| `STORAGE_PROVIDER` | `local` (`local` \| `s3`) | Storage adapter switch |
| `LOCAL_STORAGE_ROOT` | `./.private-storage` | Root directory for local private storage |
| `S3_ENDPOINT` | `http://localhost:9000` | S3 / MinIO endpoint |
| `S3_REGION` | `us-east-1` | S3 region |
| `S3_BUCKET` | `question-bank-private` | S3 private bucket name |
| `S3_ACCESS_KEY_ID` | `""` | S3 access key |
| `S3_SECRET_ACCESS_KEY` | `""` | S3 secret key |
| `MAX_FILE_SIZE_BYTES` | `52428800` (50 MB) | Maximum upload file size |
| `MAX_PAGE_COUNT` | `200` | Maximum allowed document pages |
| `MAX_IMAGE_DIMENSION` | `6000` | Maximum image dimension in pixels |
| `PROCESSING_TIMEOUT_MS` | `300000` (5 min) | Document processing timeout |
| `OCR_PROVIDER` | `paddle` (`paddle` \| `managed` \| `tesseract`) | Primary OCR provider |
| `PADDLE_OCR_URL` | `http://localhost:8866/predict/ocr_system` | PaddleOCR HubServing endpoint |
| `MANAGED_OCR_ENDPOINT` | `""` | Cloud managed OCR REST URL |
| `MANAGED_OCR_API_KEY` | `""` | Cloud managed OCR authorization token |
| `OCR_TIMEOUT_MS` | `30000` (30s) | Per-page OCR timeout |
| `OCR_MAX_RETRIES` | `3` | OCR retry attempts with exponential backoff |
| `OCR_LOW_CONFIDENCE_THRESHOLD` | `0.78` | Threshold below which OCR text triggers review warning |
| `OPENAI_API_KEY` | `""` | OpenAI API authentication key |
| `OPENAI_DEFAULT_MODEL` | `gpt-4o-mini` | Default model for selective structural repair |
| `OPENAI_ESCALATION_MODEL` | `gpt-4o` | Escalation model for complex repairs |
| `AI_REPAIR_CONFIDENCE_THRESHOLD`| `0.75` | Confidence score threshold triggering AI repair |
| `AI_BUDGET_PER_IMPORT_USD` | `0.50` | Maximum USD spend allowed per import job |
| `AI_MAX_OUTPUT_TOKENS` | `2048` | Completion token cap per repair call |

---

## 3. Upload Workflow

### 3.1 Upload Implementation (`src/app/upload/page.tsx`)
- Drag-and-drop zone and standard `<input type="file" multiple>` file picker.
- Tracks upload status per file: `READY -> UPLOADING -> COMPLETED | ERROR | CANCELLED`.
- Uses `XMLHttpRequest` to provide real-time progress bar feedback (`xhr.upload.onprogress`).
- Supports client-side upload cancellation (`xhr.abort()`).
- Exposes controls for:
  - **Duplicate upload rejection toggle:** Sends `rejectDuplicate: "true"` to enforce HTTP 409 duplicate rejection.
  - **Selective AI Budget Cap:** Configurable number input ($0.00 – $5.00, default $0.50).

### 3.2 File Validation (`src/lib/storage/file-validator.ts`)
The function `validateUploadedFile(buffer, fileName, maxBytesOverride)` performs multi-tier verification:
1. **Size check:** Rejects 0-byte files (`EMPTY_FILE`) and files $> 50\text{ MB}$ (`FILE_TOO_LARGE`).
2. **Malware / Executable check:** Rejects EICAR signature, Windows PE binaries (`MZ` header `0x4D 0x5A`), and Linux ELF binaries (`0x7F 'E' 'L' 'F'`).
3. **Extension Whitelist:** Restricts extensions to `pdf`, `docx`, `doc`, `xlsx`, `xls`, `png`, `jpg`, `jpeg`, `webp`.
4. **Magic Byte Signature Verification:**
   - `PDF`: `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`). Inspects for `/Encrypt\b` (rejects password-protected PDFs) and verifies `%%EOF` / `endobj` structure.
   - `PNG`: `89 50 4E 47 0D 0A 1A 0A`.
   - `JPEG`: `FF D8 FF`.
   - `WEBP`: `RIFF....WEBP`.
   - `DOCX / XLSX`: `PK\x03\x04` (ZIP archive). Verifies `word/document.xml` for DOCX and `xl/workbook.xml` for XLSX; detects `EncryptedPackage`.
   - `DOC / XLS`: OLE2 Compound Document header (`D0 CF 11 E0 A1 B1 1A E1`). Detects password protection (`WordCrypt`).
5. **SHA-256 Hash Computation:** Computes binary SHA-256 digest for duplicate detection.

### 3.3 Storage & Passing to Backend (`src/lib/storage/storage-provider.ts`)
- Uploaded files are written directly to private storage using `getStorageProvider().putObject(...)` under `uploads/YYYY-MM-DD/{uniqueId}-{sha256}.{ext}`.
- Mode 1: `LocalPrivateStorageAdapter` writes to `.private-storage/` with `0o600` permissions and path traversal guards (`assertSafeStorageKey`).
- Mode 2: `S3PrivateStorageAdapter` uploads to configured S3/MinIO bucket.
- The route handler `POST /api/imports` creates an `ImportJob` record in PostgreSQL and invokes `enqueueImportJob(job.id)` in `src/queue/import-queue.ts`.

---

## 4. Digital PDF Extraction

### 4.1 Implementation (`src/adapters/documents/pdf-extractor.ts`)
- **Library:** `pdfjs-dist/legacy/build/pdf.js` with `disableFontFace: true` and `useSystemFonts: true`.
- **Text Extraction:** Iterates sequentially through `1 <= pageNum <= numPages` using `page.getTextContent()`.
- **Coordinate Assembly:** `assemblePdfTextItems(items)` transforms PDF bottom-left origin coordinates to top-left Y coordinates (`viewport.height - pdfY`). Lines are grouped with a 6px vertical tolerance and sorted horizontally by X coordinate.
- **Page-by-Page Decision Logic:**
  - Evaluates digital character count against `MIN_USABLE_DIGITAL_CHARS_PER_PAGE = 20`.
  - Pages with $\ge 20$ clean characters are classified as `DIGITAL`. OCR is strictly **not** invoked for these pages.
  - Page order is strictly preserved.
- **Limitations:**
  - Standard PDF multi-column exam papers (e.g., 2-column JEE/NEET papers) may have text items interleaved across columns if line heights overlap vertically within 6px.
  - In server-side Node environments, `pdfjs-dist` outputs non-fatal warnings regarding missing `canvas` / `DOMMatrix` modules.

---

## 5. Scanned Printed PDF OCR

### 5.1 Implementation (`src/adapters/documents/pdf-extractor.ts`, `src/adapters/ocr/`)
- When a PDF page has $< 20$ usable digital characters, it is classified as `SCANNED`.
- **Page Rasterization:** `renderScannedPdfPageToImage(page, pdfjsLib)` searches the PDF operator list (`OPS.paintImageXObject`, `OPS.paintInlineImageXObject`), retrieves image data from `page.objs`, and converts pixel channels via Sharp to PNG at $\approx 1800\text{px}$ width.
- **Image Preprocessing (`src/adapters/ocr/image-preprocessor.ts`):**
  - EXIF orientation auto-rotation / deskewing.
  - Dimensional scaling: clamps oversized images to `maxImageDimension` (default 6000px); upscales low-DPI scans $< 600\text{px}$ by $2\times$.
  - Grayscale conversion.
  - Contrast enhancement (`normalize().linear(1.12, -10)`).
  - Noise reduction via median filter (`median(1).sharpen()`).
- **OCR Provider Orchestration (`src/adapters/ocr/ocr-provider.ts`):**
  - `ResilientOCRService`: Checks `OcrCache` (PostgreSQL `OcrCache` table keyed by image SHA-256), enforces timeouts (`withTimeout`), and executes retries with exponential backoff (default 3 retries).
  - `PaddleOCRProvider`: Dispatches HTTP POST to PaddleOCR HubServing (`/predict/ocr_system`).
  - `ManagedOCRProvider`: Generic cloud OCR adapter.
  - `LocalFallbackOCRProvider`: Fallback provider for embedded OCR test metadata.
- **Text Assembly:** `sortAndAssembleOCRBlocks` clusters OCR bounding boxes into horizontal lines, detects multi-column tabular gaps ($> 35\text{px}$ between blocks) to emit markdown tables, and flags blocks with confidence $< 0.78$ with `isUncertain: true`.
- **Limitations:**
  - Relies on embedded raster XObjects in the PDF. If a scanned PDF is constructed using raw vector streams or flattened canvases without XObjects, `renderScannedPdfPageToImage` returns null because headless Node.js lacks `node-canvas` / Poppler.
  - If PaddleOCR HubServing is offline and no cloud OCR endpoint is configured, `LocalFallbackOCRProvider` returns empty text for arbitrary real-world scans.

---

## 6. Handwritten Document Extraction

### 6.1 Status: NOT IMPLEMENTED
- **Findings:**
  - Grep search for `handwriting` or `handwritten` across `src/` yields **0 occurrences**.
  - No handwriting-specific OCR engine (such as TrOCR, Google Cloud Vision Handwriting, or Azure Read API) is integrated.
  - In `AI_Question_Extraction_System_PRD.md` Section 1 (lines 50–51), handwriting OCR was explicitly marked as a **non-goal** for initial release.
  - PaddleOCR and Tesseract are trained on printed typography; when passed handwritten pages, they return garbled strings or zero confidence blocks.
  - OpenAI Vision is **not** integrated into the background pipeline (the Responses API experiment exists only as a standalone test script in `scripts/test-openai-pdf-experiment.ts`).

---

## 7. DOCX and Image Extraction

### 7.1 Word Document Extraction (`src/adapters/documents/docx-extractor.ts`)
- **Library:** `mammoth` `1.8.0`.
- **Process:** Invokes `mammoth.convertToHtml` with a custom `convertImage` handler:
  - Extracts embedded figures into `extractedAssets` as binary PNG/JPEG buffers.
  - Replaces image tags with asset placeholders (`[IMAGE:PENDING_ASSET_X]`).
  - Converts HTML elements to structured markdown: headings (`#`, `##`), lists (`-`), bold (`**`), italic (`*`), underline (`__`), superscript (`^`), subscript (`~`), and tables (`| col | col |`).
  - Splits text across explicit page breaks (`===PAGE_BREAK===` or `\f`).
- **Asset Persistence:** In `ImportPipelineService`, extracted image buffers are saved to private storage (`QuestionAsset` records) and placeholder tokens are replaced with actual `assetId` values.
- **Fallback:** Uncompressed XML parser extracts `<w:p>` and `<w:t>` tags if Mammoth fails.
- **Legacy DOC:** OLE2 string stream extractor extracts text strings $\ge 12$ characters.

### 7.2 Standalone Image Extraction (`src/adapters/documents/document-classifier.ts`)
- Supports `PNG`, `JPG`, `JPEG`, `WEBP`.
- Invokes `extractImageDocument`: runs `preprocessImageForOCR` followed by `ocrService.recognizePage`.
- Sets `detectedFormat: "IMAGE"`, `totalPages: 1`, and `classification: "SCANNED"`.

---

## 8. Excel Extraction

### 8.1 Status: FULLY IMPLEMENTED (`src/adapters/documents/xlsx-extractor.ts`)
- **Library:** `exceljs` `4.4.0`.
- **Structured Question Bank Detection:** Inspects sheet header rows for standard column headers:
  - Question / Stem: `question`, `question text`, `stem`, `prompt`.
  - Number: `no`, `no.`, `q#`, `question no`, `question number`, `id`.
  - Type: `type`, `question type`.
  - Options: `option a`..`f`, `choice a`..`f`, `a`..`f`.
  - Answer: `answer`, `correct answer`, `correct`, `key`.
  - Explanation: `explanation`, `solution`, `rationale`.
  - Section: `section`, `topic`.
- When headers match, rows are converted to standard question blocks:
  ```text
  Q1. [TYPE:MCQ] What is 12 * 12?
  (A) 120
  (B) 144
  Answer: B
  Explanation: 12 multiplied by 12 equals 144.
  ```
- **Free-Form Sheet Fallback:** Unstructured spreadsheet rows are formatted as pipe-delimited markdown tables.
- **Legacy XLS:** Fallback parser extracts text payloads from raw stream bytes.

---

## 9. Question Parsing Pipeline

### 9.1 Boundary & Numbering Segmentation (`src/domain/extraction/question-segmenter.ts`)
- **Numbering Patterns Recognized (`QUESTION_START_REGEX`):**
  - Standard dot/paren: `1.`, `1)`, `01.`, `99.`
  - Explicit prefix: `Q1.`, `Q.1`, `Q 1.`, `Question 1:`, `Question 1.`
  - Sub-questions: `1(a)`, `1(b)`, `Q1(a).`
- **Section Headers:** Recognizes `SECTION A`, `PART 1: Physics`, `DIRECTIONS`, and `PASSAGE (Q. 1 to 5)`.
- **Passages:** Attaches shared reading comprehension passages to subsequent question payloads (`sharedPassage`).

### 9.2 Option Extraction
- Delimiters recognized: `(A)`, `[A]`, `A)`, `A.`, `A:`.
- **Multi-Option Inline Parsing (`parseOptionsFromLine`):** Detects multiple options on the same line (e.g. `(A) Venus (B) Mars (C) Jupiter (D) Saturn`), requiring matching delimiter styles and strict alphabetical sequence progression ($A \to B \to C \to D$).
- **Prose Guard:** Disregards tokens preceded by common nouns like `Vitamin A.`, `Point B.`, `Figure C.`, `Sample D.`.

### 9.3 Answer & Explanation Extraction
- **Inline Answers:** Matches `Answer: B`, `Correct Answer: (A, C)`, `Ans. True`.
- **Separate Answer Keys:** Matches top-level `ANSWER KEY` sections at the end of documents. Scopes entries by section (e.g., `Section A::1 -> B`). If a question ID matches multiple sections ambiguously, assigns `answerStatus = "uncertain"` and flags for human review.
- **Explanations:** Captures inline explanations (`Explanation: ...`) and top-level `EXPLANATIONS` / `SOLUTIONS` sections mapped by question ID.
- **Answer Matching (`matchAnswerToOptions`):** Resolves raw answer strings to option IDs by:
  1. Exact option ID/letter (`B`).
  2. Combined label + text (`(B) Chennai`).
  3. True/False tokens (`True`, `False`, `T`, `F`).
  4. Normalized full option text (`Chennai`).
  *If an answer string cannot be matched or is ambiguous, it is rejected and options remain unselected.*

### 9.4 Question Type Classification
- Explicit type tags: `[TYPE:MCQ]`, `[TYPE:MSQ]`, `[TYPE:TRUE_FALSE]`.
- Section/Stem heuristics: keywords like `select all that apply`, `one or more than one`, `true or false`.
- Option and answer value count:
  - 2 options with `True`/`False` $\implies$ `TRUE_FALSE`.
  - Multiple answer values $\implies$ `MSQ`.
  - 1 answer value from $\ge 2$ options $\implies$ `MCQ`.
  - Ambiguous stems (e.g. `select the correct option(s)`) $\implies$ `UNKNOWN` + `NEEDS_ATTENTION`.

### 9.5 Selective AI Repair (`src/adapters/ai/selective-ai-repair.ts`)
- Deterministic check: `shouldInvokeAiRepair(candidate)` returns `false` for well-formed questions.
- OpenAI Structured Outputs: invoked with JSON Schema `OPENAI_REPAIR_JSON_SCHEMA` and `temperature: 0`.
- Context Truncation: truncates raw snippets to $\le 2400$ characters.
- Security Sandboxing: document text wrapped in `<UNTRUSTED_QUESTION_SNIPPET>` tags with strict system prompt overrides.
- Budget Guard: stops invoking AI when cumulative spend reaches `job.aiBudgetUsd` (default $0.50).
- Cache: caches responses in `AiRepairCache` by input SHA-256 hash.

### 9.6 Deduplication & Content Hashing
- Computes SHA-256 content hash (`computeQuestionContentHash`) from question stem plain text, ordered option plain text, and question type.
- Checks within the same import job (`seenHashesInThisImport`) and against the entire database (`findExistingQuestionByContentHash`).
- Marks duplicates with `isDuplicate: true`, `duplicateOfId`, and sets `reviewStatus = "NEEDS_ATTENTION"`.

---

## 10. Database and Import Jobs

### 10.1 Prisma Schema Models (`prisma/schema.prisma`)
1. **`ImportJob`:** Stores document metadata (`fileName`, `fileSize`, `fileSha256`, `storageKey`), processing status (`status`, `currentStage`, `progressPercent`), metrics (`totalPages`, `pagesProcessed`, `totalExtractedQuestions`, `questionsRequiringReview`, `approvedQuestionsCount`), OCR logs (`ocrMethod`, `ocrDurationMs`), AI cost tracking (`aiUsed`, `aiModel`, `aiInputTokens`, `aiOutputTokens`, `estimatedAiCostUsd`, `aiBudgetUsd`), and error details (`errorCode`, `errorMessage`).
2. **`ImportPage`:** Stores per-page classification (`DIGITAL`, `SCANNED`, `MIXED`, `TABULAR`, `DOCUMENT_FLOW`), raw & normalized text, OCR metrics, and bounding boxes (`db.JsonB`).
3. **`Question`:** Stores question stem (`content`), `explanation`, `type`, `answerStatus`, `answerProvenance`, `reviewStatus`, `confidence`, `sourcePage`, `sourceQuestionNumber`, `sourceOrder`, `contentHash`, `isDuplicate`, `aiRepaired`, `warnings` (`db.JsonB`), and question bank publish status (`publishedToBank`, `publishedAt`). Unique key on `(importJobId, sourceOrder)`.
4. **`Option`:** Stored in separate relational table linked to `Question`, with `label`, `content` (`db.JsonB`), `isCorrect`, and `displayOrder`.
5. **`QuestionAsset`:** Binary images/diagrams stored in private storage, linked to `ImportJob` and `Question`.
6. **`QuestionReviewLog`:** Audit trail recording reviewer ID, action (`CREATED`, `EDITED`, `APPROVED`, `REJECTED`, `BULK_APPROVED`, `AI_REPAIRED`), previous state, and new state.
7. **`AiRepairCache`:** Caches OpenAI repair JSON by input hash.
8. **`OcrCache`:** Caches OCR results by image hash.

### 10.2 Database Capability Evaluation vs Planned Architecture
| Planned Field / Requirement | Currently Supported? | Notes / Schema Evidence |
| :--- | :--- | :--- |
| **Backend-detected document type** | **Yes** | `ImportJob.detectedFormat` (`DIGITAL_PDF`, `SCANNED_PDF`, `MIXED_PDF`, `DOCX`, `DOC`, `XLSX`, `XLS`, `IMAGE`, `UNKNOWN`) |
| **Per-page document classification** | **Yes** | `ImportPage.classification` (`DIGITAL`, `SCANNED`, `MIXED`, `TABULAR`, `DOCUMENT_FLOW`) |
| **Extraction status and errors** | **Yes** | `ImportJob.status`, `ImportJob.currentStage`, `ImportJob.errorCode`, `ImportJob.errorMessage` |
| **User-declared document type** | **No** | Neither `ImportJob` nor `UploadDocumentsPage` currently captures user-selected format |
| **Selected extraction pathway** | **Partial** | `ImportJob.ocrMethod` tracks OCR provider; no explicit `extractionPathway` enum column |

---

## 11. Existing Functionality We Should Reuse

The following components are robust, fully tested, and should be preserved without modification:

1. **File Security & Signature Validator (`src/lib/storage/file-validator.ts`):** Magic byte detection, malware/executable blocking, encrypted file detection.
2. **Private Storage Adapters (`src/lib/storage/storage-provider.ts`):** Traversal-safe local storage and S3 adapters with HMAC signed URLs.
3. **Question Normalizer & Boundary Segmenter (`src/domain/extraction/`):** Comprehensive numbering style parser, multi-option inline parser, passage collector, and prose prefix protector.
4. **Answer Key & Explanation Matcher (`question-segmenter.ts`):** Section-aware answer matching, True/False normalization, and ambiguous candidate tagging.
5. **Tiptap AST Converters & Zod Schemas (`src/domain/`):** Clean bi-directional Markdown/HTML $\leftrightarrow$ Tiptap JSONB converters and strict validation schemas.
6. **DOCX Extractor with Asset Extraction (`src/adapters/documents/docx-extractor.ts`):** Mammoth pipeline with embedded figure extraction.
7. **ExcelJS Spreadsheet Extractor (`src/adapters/documents/xlsx-extractor.ts`):** Automatic header mapping and markdown table formatting.
8. **Export Service (`src/services/export.service.ts`):** Full JSON AST, styled Excel workbooks, CSV, and markdown audit reports.
9. **Question Bank Review Workspace UI (`src/app/imports/[id]/review/page.tsx`):** Split-screen editor, KaTeX live preview, bounding box overlays, and approval workflows.
10. **Repository Dual-Store Pattern (`src/repositories/question-bank.repository.ts`):** Safe PostgreSQL/Prisma with automated failover store for isolated execution.

---

## 12. Missing Functionality

Comparison against the 11 planned architectural requirements:

| # | Feature | Status | Evidence / File References |
| :--- | :--- | :--- | :--- |
| **1** | **Document type selection before upload** | **Not implemented** | `src/app/upload/page.tsx` has no dropdown/radios for document type. `src/app/api/imports/route.ts` ignores any declared type. `ImportJob` model lacks `userDeclaredFormat`. |
| **2** | **Digital PDF extraction** | **Fully implemented** | `src/adapters/documents/pdf-extractor.ts` (`extractPdfDocument`, `parsePdfPagesDigital`). Verified in `tests/documents-and-ocr.test.ts` (test 1). |
| **3** | **Scanned printed PDF OCR** | **Partially implemented** | Architecture exists (`renderScannedPdfPageToImage`, `ResilientOCRService`, Sharp preprocessor), but lacks headless canvas/Poppler for non-XObject scans and requires external PaddleOCR server for real scans. |
| **4** | **Handwritten PDF extraction** | **Not implemented** | Zero references in `src/`. No vision-model extraction pipeline in production. PaddleOCR/Tesseract fail on handwriting. |
| **5** | **Automatic document verification** | **Fully implemented** | `validateUploadedFile` in `src/lib/storage/file-validator.ts`. Verified in `tests/documents-and-ocr.test.ts` (test 8). |
| **6** | **Mixed PDF page-by-page processing** | **Fully implemented** | `src/adapters/documents/pdf-extractor.ts` (lines 78–180). Independent page character evaluation. Verified in `tests/documents-and-ocr.test.ts` (test 3). |
| **7** | **DOCX extraction** | **Fully implemented** | `src/adapters/documents/docx-extractor.ts` (`extractWordDocument`). Embedded image extraction to `QuestionAsset`. Verified in `tests/documents-and-ocr.test.ts` (test 4). |
| **8** | **Image extraction** | **Fully implemented** | `src/adapters/documents/document-classifier.ts` (`extractImageDocument`) + Sharp preprocessor. Verified in `tests/documents-and-ocr.test.ts` (test 6). |
| **9** | **Excel extraction** | **Fully implemented** | `src/adapters/documents/xlsx-extractor.ts` (`extractExcelDocument`). Structured question table & free-form sheet parsing. Verified in `tests/documents-and-ocr.test.ts` (test 5). |
| **10** | **Standardized question output** | **Fully implemented** | `ValidatedQuestionPayloadSchema` in `src/domain/schemas/question.schema.ts`. Canonical Tiptap JSON stored in PostgreSQL JSONB. |
| **11** | **Common validation & preview workflow** | **Fully implemented** | `src/app/imports/[id]/review/page.tsx`, `TiptapRichEditor.tsx`, `StudentLivePreview.tsx`. Verified in `tests/api-routes.test.ts` (test 2). |

---

## 13. Technical Risks

1. **Scanned PDF Page Rendering in Headless Node:**  
   `pdfjs-dist` in Node requires external canvas bindings (`canvas` or `skia-canvas`) to render full vector pages to raster images. Currently, `renderScannedPdfPageToImage` only extracts embedded raster XObjects. If a scanned PDF embeds visual pages as vector drawings or flattened backgrounds, raster extraction fails and yields an empty page.
2. **Local OCR Service Availability:**  
   `PaddleOCRProvider` targets `http://localhost:8866/predict/ocr_system`. If this container/service is not running during local deployment, scanned pages fail or fall back to empty text unless using synthetic test fixtures.
3. **Absence of Vision Model Extraction for Scanned & Handwritten Papers:**  
   Real-world exam papers often contain handwriting, mathematical equations written on paper, and low-contrast scans that classical printed-text OCR cannot decipher. Because OpenAI is currently used solely for text snippet repair rather than direct multimodal page ingestion, handwriting cannot be processed.
4. **Lack of User Document Type Declaration:**  
   Because users cannot specify document intent before upload, a degraded digital PDF with low character counts may be misclassified as scanned, or a scanned document with corrupt invisible text layers may attempt digital extraction.
5. **High Token Latency on Full Document Vision:**  
   Passing high-resolution multi-page scans directly to multimodal models (like `gpt-4o`) risks latency timeouts and token budget exhaustion if done naively without page-by-page budget limits.

---

## 14. Recommended Implementation Order

To safely enhance the application without breaking any of the 36 passing tests or existing invariants:

1. **Phase 1: User-Declared Document Type Selection (UI & Schema)**
   - Add document type selection (`Auto-Detect`, `Digital PDF`, `Scanned Printed`, `Handwritten / Vision`, `DOCX`, `Excel`, `Image`) to `src/app/upload/page.tsx`.
   - Update `POST /api/imports` to accept `userDeclaredFormat`.
   - Add optional `userDeclaredFormat` and `extractionPathway` fields to `prisma/schema.prisma` and `ImportJobRecord`.
2. **Phase 2: Enhanced PDF Page Rasterization Engine**
   - Provide a robust server-side page rasterizer using `pdf-img-convert` or a lightweight canvas wrapper so all scanned pages (not just those with raster XObjects) can be rendered to PNG buffers reliably.
3. **Phase 3: Multimodal Vision Extraction Pathway for Handwritten / Scanned Exams**
   - Create a dedicated `vision-extractor.ts` adapter utilizing OpenAI Responses API (`gpt-4o` / `gpt-4o-mini`) for documents where the user selects `Handwritten / Vision` or where OCR confidence is critically low.
   - Reuse the exact `ValidatedQuestionPayloadSchema` and Tiptap converter so the output flows directly into the existing review workspace.
4. **Phase 4: Multi-Column Reading Order Enhancement**
   - Enhance `assemblePdfTextItems` in `src/adapters/documents/pdf-extractor.ts` with basic 2-column gutter detection to prevent line interleaving in standardized competitive exam papers.

---

## 15. Files Likely to Require Changes

When implementing the recommended improvements:

- **Frontend Upload UI:**
  - `src/app/upload/page.tsx`: Add document type selector component and pass value in `FormData`.
- **API & Serialization:**
  - `src/app/api/imports/route.ts`: Parse and record `userDeclaredFormat`.
  - `src/lib/api-serializers.ts`: Expose `userDeclaredFormat` and `extractionPathway`.
- **Database & Repository:**
  - `prisma/schema.prisma`: Add `userDeclaredFormat DocumentFormat?` and `extractionPathway String?` to `ImportJob`.
  - `src/repositories/question-bank.repository.ts`: Update `ImportJobRecord` interface and failover memory store.
- **Document Adapters & Extraction Router:**
  - `src/adapters/documents/document-classifier.ts`: Route to vision extraction pathway when user selects `Handwritten` or `Vision`.
  - `src/adapters/documents/pdf-extractor.ts`: Enhance page rasterization and 2-column text sorting.
  - `src/adapters/ai/` (New Adapter): `src/adapters/ai/vision-extractor.ts` for multimodal page extraction.
- **Import Pipeline Service:**
  - `src/services/import-pipeline.service.ts`: Integrate the new vision pathway into the pipeline decision tree.
