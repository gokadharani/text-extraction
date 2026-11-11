---
name: qbank-prd-workflow
description: >-
  Use this skill when modifying, extending, debugging, or verifying the AI Question Paper
  Extraction & Question Bank System according to AI_Question_Extraction_System_PRD.md.
  Provides step-by-step runbooks for adding document adapters, extending question segmentation,
  modifying Tiptap Rich-Text JSONB schemas, and running PRD acceptance verification.
---

# QBank PRD Engineering Workflow & Runbooks

Use these procedures whenever making changes to `d:/trash/q-a` under [`AI_Question_Extraction_System_PRD.md`](../../../AI_Question_Extraction_System_PRD.md).

## 1. Runbook: Adding or Modifying a Document / OCR Adapter (`FR-01`, `FR-03`, `FR-04`)

1. **Signature Validation**: Update `validateUploadedFile()` in [`src/lib/storage/file-validator.ts`](../../../src/lib/storage/file-validator.ts) to inspect binary magic bytes (never rely solely on file extensions).
2. **Extractor Implementation**:
   - Keep extractors in `src/adapters/documents/` returning `DocumentExtractionResult`.
   - Ensure embedded images are placed in `page.extractedAssets` and referenced via `[IMAGE:PENDING_ASSET_N:alt]` rather than inline base64 strings.
   - For PDFs (`pdf-extractor.ts`), classify each page independently (`DIGITAL`, `SCANNED`, `MIXED`) so OCR is skipped when `digitalText.trim().length >= 20`.
3. **OCR Provider**: Implement `OCRProvider` (`recognize(input: OCRInput): Promise<OCRResult>`) in [`src/adapters/ocr/ocr-provider.ts`](../../../src/adapters/ocr/ocr-provider.ts) and wire into `ResilientOCRService`.
4. **Verify**: Run `npx vitest run tests/documents-and-ocr.test.ts`.

---

## 2. Runbook: Extending Question Segmentation & Type Classification (`FR-05` to `FR-09`)

1. **Numbering & Boundaries**: Update `QUESTION_START_REGEX` or `OPTION_LINE_START_REGEX` in [`src/domain/extraction/question-segmenter.ts`](../../../src/domain/extraction/question-segmenter.ts).
2. **Type Detection**:
   - Preserve the `FR-06` rule: never default ambiguous optioned questions to `MCQ` when section headers, question stems, and answers provide no single-choice vs multi-select evidence. Use `UNKNOWN` and set `reviewStatus = "NEEDS_ATTENTION"`.
3. **Rich-Text Conversion**:
   - Update [`src/domain/richtext/tiptap-converter.ts`](../../../src/domain/richtext/tiptap-converter.ts) (`textToTiptapDoc`, `htmlToTiptapDoc`, `tiptapDocToPlainText`) and [`src/domain/schemas/question.schema.ts`](../../../src/domain/schemas/question.schema.ts).
   - Ensure `computeQuestionContentHash()` includes normalized stem, option IDs/text, and question type.
4. **Verify**: Run `npx vitest run tests/segmentation-and-richtext.test.ts`.

---

## 3. Runbook: Selective OpenAI Repair & Pipeline Idempotency (`FR-10`, Sections 5–6)

1. **Trigger Gate**: Update `shouldInvokeAiRepair()` in [`src/adapters/ai/selective-ai-repair.ts`](../../../src/adapters/ai/selective-ai-repair.ts) so clean `MCQ`/`MSQ`/`TRUE_FALSE` questions bypass OpenAI.
2. **Structured Outputs**: Keep `OPENAI_REPAIR_JSON_SCHEMA` and `AiStructuredRepairResponseSchema` synchronized. Wrap untrusted OCR snippets in `<UNTRUSTED_QUESTION_SNIPPET>`.
3. **Idempotent Persistence**: Ensure [`src/services/import-pipeline.service.ts`](../../../src/services/import-pipeline.service.ts) saves staging questions via `questionBankRepo.saveStagingQuestionsTransactional()` keyed on `(importJobId, sourceOrder)`.
4. **Verify**: Run `npx vitest run tests/pipeline-ai-and-workflow.test.ts`.

---

## 4. Runbook: Full PRD Acceptance Verification (Sections 11, 13, 14)

Before completing any task, execute all four commands and verify zero errors:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
