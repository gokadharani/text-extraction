import { SupportedFileCategory } from "@/lib/storage/file-validator";
import { ResilientOCRService } from "@/adapters/ocr/ocr-provider";
import { preprocessImageForOCR } from "@/adapters/ocr/image-preprocessor";
import { UserDeclaredFormat } from "@prisma/client";
import { DocumentExtractionResult, extractPdfDocument } from "./pdf-extractor";
import { extractWordDocument } from "./docx-extractor";
import { extractExcelDocument } from "./xlsx-extractor";

export function isCategoryCompatibleWithDeclaredFormat(
  category: SupportedFileCategory,
  declared: UserDeclaredFormat
): boolean {
  if (declared === "AUTO_DETECT") return true;
  switch (declared) {
    case "DIGITAL_PDF":
    case "SCANNED_PRINTED_PDF":
    case "SCANNED_HANDWRITTEN_PDF":
      return category === "PDF";
    case "DOCX":
      return category === "DOCX" || category === "DOC";
    case "XLSX":
      return category === "XLSX" || category === "XLS";
    case "IMAGE":
      return category === "PNG" || category === "JPEG" || category === "WEBP";
    default:
      return true;
  }
}

/**
 * Extracts text, bounding boxes, and confidence metrics from standalone image files
 * (PNG, JPG, JPEG, WEBP) via Sharp preprocessing and the configured OCR provider.
 */
export async function extractImageDocument(
  buffer: Buffer,
  mimeType: string,
  ocrService: ResilientOCRService
): Promise<DocumentExtractionResult> {
  const prep = await preprocessImageForOCR(buffer);
  const ocrResult = await ocrService.recognizePage({
    imageBuffer: buffer,
    pageNumber: 1,
    mimeType
  });

  return {
    detectedFormat: "IMAGE",
    totalPages: 1,
    pages: [
      {
        pageNumber: 1,
        classification: "SCANNED",
        rawText: ocrResult.text,
        ocrUsed: true,
        ocrProvider: ocrResult.provider,
        ocrConfidence: ocrResult.confidence,
        ocrDurationMs: ocrResult.durationMs,
        width: prep.width,
        height: prep.height,
        boundingBoxes: ocrResult.blocks,
        warnings: ocrResult.warnings,
        extractedAssets: []
      }
    ],
    ocrMethod: ocrResult.provider,
    totalOcrDurationMs: ocrResult.durationMs
  };
}

/**
 * Classifies the uploaded document and dispatches to the appropriate extraction strategy:
 * - Digital PDF -> PDF.js text extraction (no OCR)
 * - Scanned PDF -> Page rendering + OCR
 * - Mixed PDF -> Per-page independent digital extraction vs OCR
 * - DOCX / DOC -> Mammoth / XML structured extraction
 * - XLSX / XLS -> ExcelJS structured row/column/table extraction
 * - PNG / JPEG / WEBP -> Sharp preprocessing + OCR
 */
export async function classifyAndExtractDocument(
  buffer: Buffer,
  category: SupportedFileCategory,
  mimeType: string,
  ocrService?: ResilientOCRService,
  userDeclaredFormat?: UserDeclaredFormat | null
): Promise<DocumentExtractionResult> {
  const activeOcrService = ocrService ?? new ResilientOCRService();

  let extraction: DocumentExtractionResult;
  switch (category) {
    case "PDF":
      extraction = await extractPdfDocument(buffer, activeOcrService, { userDeclaredFormat });
      break;
    case "DOCX":
      extraction = await extractWordDocument(buffer, "DOCX");
      break;
    case "DOC":
      extraction = await extractWordDocument(buffer, "DOC");
      break;
    case "XLSX":
      extraction = await extractExcelDocument(buffer, "XLSX");
      break;
    case "XLS":
      extraction = await extractExcelDocument(buffer, "XLS");
      break;
    case "PNG":
    case "JPEG":
    case "WEBP":
      extraction = await extractImageDocument(buffer, mimeType, activeOcrService);
      break;
    default:
      throw new Error(`Unsupported file category: ${String(category)}`);
  }

  // Cross-category format mismatch warning
  if (userDeclaredFormat && userDeclaredFormat !== "AUTO_DETECT") {
    const isCompatible = isCategoryCompatibleWithDeclaredFormat(category, userDeclaredFormat);
    if (!isCompatible) {
      const mismatchWarning = `User declared document format as ${userDeclaredFormat}, but actual validated file type is ${extraction.detectedFormat} (${category}). Extracted using authoritative ${extraction.detectedFormat} pipeline.`;
      for (const page of extraction.pages) {
        if (!page.warnings.includes(mismatchWarning)) {
          page.warnings.push(mismatchWarning);
        }
      }
    }
  }

  return extraction;
}
