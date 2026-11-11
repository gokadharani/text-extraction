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


   ## PaddleOCR Integration – Local OCR Service

This project uses PaddleOCR as a local OCR service to extract text from scanned documents and images.

### 1. OCR Setup

The OCR environment uses:

- Python 3.11
- PaddlePaddle (CPU version)
- PaddleOCR
- PaddleHub
- PP-OCRv3 detection, recognition, and classification models

### 2. Start the OCR Service

Activate the Python virtual environment and start the PaddleOCR service:

```powershell
.\paddle_env\Scripts\Activate.ps1
hub serving start -m ocr_system -p 8866
```

The local OCR endpoint is:

```text
http://127.0.0.1:8866/predict/ocr_system
```

### 3. Environment Configuration

Configure the following variables in your `.env` file:

```env
OCR_PROVIDER=paddleocr
PADDLE_OCR_URL=http://127.0.0.1:8866/predict/ocr_system
```

### 4. Application Integration

The OCR provider adapter (`src/adapters/ocr/ocr-provider.ts`) communicates with the local PaddleOCR service.

It is responsible for:

- Sending document images to the OCR endpoint.
- Extracting recognized text.
- Normalizing text, bounding boxes, and confidence scores.
- Returning structured OCR results to the extraction pipeline.

### 5. Extraction Workflow

1. A scanned PDF page or image is sent for preprocessing.
2. The application sends the processed image to PaddleOCR.
3. PaddleOCR recognizes the text.
4. The adapter normalizes the OCR response.
5. The extracted text is passed to the question extraction pipeline.
6. Questions are parsed and validated.

### 6. Benefits

- Local OCR processing.
- Reduced dependency on cloud-based OCR services.
- Configurable OCR provider architecture.
- Structured OCR output for downstream question extraction.


or else

 
Part 1: Automated PaddleOCR Setup Script
Save this script as setup_paddleocr.ps1 (or run step-by-step in PowerShell inside your directory):
# 1. Clone repository (if not already cloned)
git clone https://github.com/PaddlePaddle/PaddleOCR.git
cd PaddleOCR
# 2. Create Virtual Environment with Python 3.11 (64-bit)
# (Ensure Python 3.11 is installed via: winget install Python.Python.3.11)
py -3.11 -m venv paddle_env
.\paddle_env\Scripts\Activate.ps1
# 3. Upgrade pip & install PaddlePaddle CPU
python -m pip install --upgrade pip
pip install paddlepaddle -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
# 4. Install PaddleOCR & PaddleHub with locked compatible dependencies (NumPy 1.26.x)
pip install "numpy==1.26.4" "scipy<1.14" "pandas<2.3" "opencv-python<4.11" "opencv-contrib-python<4.11"
pip install "pyarrow<17.0.0" "datasets<2.19.0" "huggingface_hub<0.24.0" "scikit-image<0.24"
pip install "paddle2onnx==1.3.1" paddlehub paddleocr
pip install --force-reinstall --no-cache-dir pyclipper shapely lmdb stringzilla
pip install "numpy==1.26.4" --no-deps
# 5. Pre-download required inference models for ocr_system
python -c "
import urllib.request, tarfile, os, shutil
base_dir = r'inference'
os.makedirs(base_dir, exist_ok=True)
models = {
    'det.tar': 'https://paddleocr.bj.bcebos.com/PP-OCRv3/chinese/ch_PP-OCRv3_det_infer.tar',
    'rec.tar': 'https://paddleocr.bj.bcebos.com/PP-OCRv3/chinese/ch_PP-OCRv3_rec_infer.tar',
    'cls.tar': 'https://paddleocr.bj.bcebos.com/dygraph_v2.0/ch/ch_ppocr_mobile_v2.0_cls_infer.tar'
}
for name, url in models.items():
    tar_path = os.path.join(base_dir, name)
    print(f'Downloading {url}...')
    urllib.request.urlretrieve(url, tar_path)
    with tarfile.open(tar_path) as tar:
        tar.extractall(base_dir)
# Ensure folder name matches deploy/hubserving/ocr_system/params.py
det_src = os.path.join(base_dir, 'ch_PP-OCRv3_det_infer')
det_dest = os.path.join(base_dir, 'PP-OCRv3_mobile_det_infer')
if os.path.exists(det_src) and not os.path.exists(det_dest):
    shutil.copytree(det_src, det_dest)
print('All models downloaded and ready.')
"
# 6. Install OCR System into PaddleHub
hub install deploy/hubserving/ocr_system/
# 7. Start the Local OCR Service
hub serving start -m ocr_system -p 8866
 
else if wanted to do prompt :
 
Part 3: Copy-Paste Prompt for an AI Agent on Any System
If you are setting this up on another machine or giving instructions to an AI coding assistant, paste this prompt:
I want to set up and integrate the PaddleOCR Hub Serving endpoint with our `q-a` Question Extraction System.
Please perform the following steps:
1. Verify that Python 3.11 (64-bit) is installed (`py -3.11 --version`). If not, install Python 3.11.
2. In the `PaddleOCR` directory, create a virtual environment `paddle_env` using Python 3.11.
3. Install `paddlepaddle` CPU from `https://www.paddlepaddle.org.cn/packages/stable/cpu/`.
4. Install `paddlehub` and `paddleocr` with NumPy pinned to `1.26.4` and install pre-compiled binary wheels for `pyclipper`, `shapely`, `lmdb`, and `stringzilla` to avoid NumPy 2.x C-extension errors (`ModuleNotFoundError: No module named 'numpy._core._multiarray_umath'`).
5. Download the PP-OCRv3 detection (`ch_PP-OCRv3_det_infer`), recognition (`ch_PP-OCRv3_rec_infer`), and classification (`ch_ppocr_mobile_v2.0_cls_infer`) tar files into `PaddleOCR/inference/` and ensure the detection directory is copied to `PP-OCRv3_mobile_det_infer`.
6. Run `hub install deploy/hubserving/ocr_system/` and verify it reports "Successfully installed ocr_system".
7. Start the serving daemon with `hub serving start -m ocr_system -p 8866`.
8. In `q-a`, ensure `.env` has `OCR_PROVIDER=paddleocr` and `PADDLE_OCR_URL=http://127.0.0.1:8866/predict/ocr_system`, and test OCR with `npm test tests/documents-and-ocr.test.ts`.
 
 
