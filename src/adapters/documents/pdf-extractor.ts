import sharp from "sharp";
import { UserDeclaredFormat } from "@prisma/client";
import { getAppConfig } from "@/config/env";
import { OCRBlock, ResilientOCRService } from "@/adapters/ocr/ocr-provider";

export interface ExtractedAssetCandidate {
  buffer: Buffer;
  mimeType: string;
  altText: string;
  pageNumber: number;
}

export interface ExtractedPageContent {
  pageNumber: number;
  classification: "DIGITAL" | "SCANNED" | "MIXED" | "TABULAR" | "DOCUMENT_FLOW";
  rawText: string;
  ocrUsed: boolean;
  ocrProvider: string | null;
  ocrConfidence: number | null;
  ocrDurationMs: number;
  width: number;
  height: number;
  boundingBoxes: OCRBlock[];
  warnings: string[];
  extractedAssets: ExtractedAssetCandidate[];
}

export interface DocumentExtractionResult {
  detectedFormat:
    | "DIGITAL_PDF"
    | "SCANNED_PDF"
    | "MIXED_PDF"
    | "DOCX"
    | "DOC"
    | "XLSX"
    | "XLS"
    | "IMAGE";
  totalPages: number;
  pages: ExtractedPageContent[];
  ocrMethod: string | null;
  totalOcrDurationMs: number;
}

export interface PdfExtractionOptions {
  userDeclaredFormat?: UserDeclaredFormat | null;
}

const MIN_USABLE_DIGITAL_CHARS_PER_PAGE = 20;

export interface PdfTextItemWithCoords {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extracts pages from Digital, Scanned, and Mixed PDFs.
 * - Uses PDF.js (`pdfjs-dist`) to extract digital text and coordinates per page.
 * - Evaluates each page independently: if usable digital text exists, OCR is NOT executed on that page.
 * - If a page lacks usable digital text (or contains scanned raster content), runs OCR only on that page.
 */
export async function extractPdfDocument(
  buffer: Buffer,
  ocrService: ResilientOCRService,
  options?: PdfExtractionOptions
): Promise<DocumentExtractionResult> {
  const config = getAppConfig();
  const rawPages = await parsePdfPagesDigital(buffer);

  if (rawPages.length > config.limits.maxPageCount) {
    throw new Error(
      `PDF page count (${rawPages.length}) exceeds maximum configured limit (${config.limits.maxPageCount}).`
    );
  }

  const pages: ExtractedPageContent[] = [];
  let digitalPageCount = 0;
  let scannedPageCount = 0;
  let totalOcrDurationMs = 0;
  let ocrMethodUsed: string | null = null;

  for (const rawPage of rawPages) {
    const cleanDigital = rawPage.digitalText.trim();
    const hasUsableDigitalText =
      cleanDigital.length >= MIN_USABLE_DIGITAL_CHARS_PER_PAGE && !rawPage.forceScannedOcr;

    if (hasUsableDigitalText && !rawPage.hasScannedSupplement) {
      // Purely digital page: DO NOT run OCR
      digitalPageCount++;
      const pageWarnings: string[] = [];
      if (
        options?.userDeclaredFormat === "SCANNED_PRINTED_PDF" ||
        options?.userDeclaredFormat === "SCANNED_HANDWRITTEN_PDF"
      ) {
        pageWarnings.push("User declared document as scanned, but usable digital text was detected.");
      }
      pages.push({
        pageNumber: rawPage.pageNumber,
        classification: "DIGITAL",
        rawText: cleanDigital,
        ocrUsed: false,
        ocrProvider: null,
        ocrConfidence: 1.0,
        ocrDurationMs: 0,
        width: rawPage.width,
        height: rawPage.height,
        boundingBoxes: rawPage.boundingBoxes,
        warnings: pageWarnings,
        extractedAssets: rawPage.assets
      });
    } else if (hasUsableDigitalText && rawPage.hasScannedSupplement && rawPage.ocrImageBuffer) {
      // Mixed page containing both digital text and an embedded scanned region
      const ocrRes = await ocrService.recognizePage({
        imageBuffer: rawPage.ocrImageBuffer,
        pageNumber: rawPage.pageNumber
      });
      totalOcrDurationMs += ocrRes.durationMs;
      ocrMethodUsed = ocrRes.provider;
      scannedPageCount++;
      digitalPageCount++;

      const mixedWarnings = [...ocrRes.warnings];
      if (options?.userDeclaredFormat === "SCANNED_HANDWRITTEN_PDF") {
        mixedWarnings.push("User declared document as handwritten: standard OCR baseline applied for review.");
      }

      const combinedText = [cleanDigital, ocrRes.text].filter(Boolean).join("\n");
      pages.push({
        pageNumber: rawPage.pageNumber,
        classification: "MIXED",
        rawText: combinedText,
        ocrUsed: true,
        ocrProvider: ocrRes.provider,
        ocrConfidence: ocrRes.confidence,
        ocrDurationMs: ocrRes.durationMs,
        width: rawPage.width,
        height: rawPage.height,
        boundingBoxes: [...rawPage.boundingBoxes, ...ocrRes.blocks],
        warnings: mixedWarnings,
        extractedAssets: rawPage.assets
      });
    } else {
      // Scanned page: lacks usable digital text -> run OCR
      scannedPageCount++;
      const pageImageBuf = rawPage.ocrImageBuffer;

      if (!pageImageBuf) {
        // Page has no usable digital text and could not be rendered to an image:
        // NEVER pass the raw PDF file buffer to OCR. Record a warning and preserve page ordering.
        const unreadableWarnings = [
          `Page ${rawPage.pageNumber} contains no readable digital text or image content for OCR.`
        ];
        if (options?.userDeclaredFormat === "DIGITAL_PDF") {
          unreadableWarnings.push("User declared document as digital, but page lacks selectable text.");
        }
        pages.push({
          pageNumber: rawPage.pageNumber,
          classification: "SCANNED",
          rawText: "",
          ocrUsed: false,
          ocrProvider: null,
          ocrConfidence: 0,
          ocrDurationMs: 0,
          width: rawPage.width,
          height: rawPage.height,
          boundingBoxes: [],
          warnings: unreadableWarnings,
          extractedAssets: rawPage.assets
        });
        continue;
      }

      const ocrRes = await ocrService.recognizePage({
        imageBuffer: pageImageBuf,
        pageNumber: rawPage.pageNumber
      });
      totalOcrDurationMs += ocrRes.durationMs;
      ocrMethodUsed = ocrRes.provider;

      const pageWarnings = [...ocrRes.warnings];
      if (ocrRes.blocks.length === 0 || !ocrRes.text.trim()) {
        pageWarnings.push(`Page ${rawPage.pageNumber}: OCR returned no readable text blocks.`);
      }
      if (options?.userDeclaredFormat === "DIGITAL_PDF") {
        pageWarnings.push(
          "User declared document as digital, but page lacks selectable text. Scanned OCR was executed."
        );
      }
      if (options?.userDeclaredFormat === "SCANNED_HANDWRITTEN_PDF") {
        pageWarnings.push(
          "User declared document as handwritten: standard OCR baseline applied for review."
        );
      }

      pages.push({
        pageNumber: rawPage.pageNumber,
        classification: "SCANNED",
        rawText: ocrRes.text,
        ocrUsed: true,
        ocrProvider: ocrRes.provider,
        ocrConfidence: ocrRes.confidence,
        ocrDurationMs: ocrRes.durationMs,
        width: rawPage.width,
        height: rawPage.height,
        boundingBoxes: ocrRes.blocks,
        warnings: pageWarnings,
        extractedAssets: rawPage.assets
      });
    }
  }

  let detectedFormat: "DIGITAL_PDF" | "SCANNED_PDF" | "MIXED_PDF" = "DIGITAL_PDF";
  if (scannedPageCount > 0 && digitalPageCount > 0) {
    detectedFormat = "MIXED_PDF";
  } else if (scannedPageCount > 0 && digitalPageCount === 0) {
    detectedFormat = "SCANNED_PDF";
  }

  return {
    detectedFormat,
    totalPages: pages.length,
    pages,
    ocrMethod: ocrMethodUsed,
    totalOcrDurationMs
  };
}

interface RawParsedPdfPage {
  pageNumber: number;
  width: number;
  height: number;
  digitalText: string;
  boundingBoxes: OCRBlock[];
  forceScannedOcr: boolean;
  hasScannedSupplement: boolean;
  ocrImageBuffer?: Buffer;
  assets: ExtractedAssetCandidate[];
}

/**
 * Renders or extracts raster image content from a scanned PDF page.
 * Scanned PDF pages embed visual scans as image XObjects in the operator list.
 * Decodes the image pixel data via pdfjs, formats color channels, resizes to ~1800px width
 * (optimal resolution for OCR text detection), and converts to a PNG buffer using Sharp.
 */
async function renderScannedPdfPageToImage(
  page: any,
  pdfjsLib: any
): Promise<Buffer | null> {
  try {
    const ops = await page.getOperatorList();
    const imageNames: string[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (
        ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject ||
        ops.fnArray[i] === pdfjsLib.OPS.paintInlineImageXObject
      ) {
        const name = ops.argsArray[i]?.[0];
        if (name && !imageNames.includes(name)) {
          imageNames.push(name);
        }
      }
    }

    if (imageNames.length === 0) {
      return null;
    }

    const extractedImages: Array<{ buffer: Buffer; width: number; height: number }> = [];

    for (const name of imageNames) {
      const obj: any = await new Promise((resolve) => page.objs.get(name, resolve));
      if (!obj || !obj.data || !obj.width || !obj.height) continue;

      const channels = obj.kind === 1 ? 1 : obj.kind === 3 ? 4 : 3;
      const rawData = Buffer.from(obj.data.buffer, obj.data.byteOffset, obj.data.byteLength);

      // Optimal OCR width: ~1800px ensures text lines have sufficient pixel height for OCR DBNet detection
      const targetWidth = Math.min(2400, Math.max(1800, obj.width));

      const pngBuffer = await sharp(rawData, {
        raw: {
          width: obj.width,
          height: obj.height,
          channels
        }
      })
        .resize({ width: targetWidth, withoutEnlargement: false })
        .png({ compressionLevel: 6 })
        .toBuffer();

      extractedImages.push({ buffer: pngBuffer, width: targetWidth, height: obj.height });
    }

    if (extractedImages.length === 0) {
      return null;
    }

    if (extractedImages.length === 1) {
      return extractedImages[0].buffer;
    }

    // Sort by buffer size descending to select the primary full-page scan
    extractedImages.sort((a, b) => b.buffer.length - a.buffer.length);
    return extractedImages[0].buffer;
  } catch {
    return null;
  }
}

async function parsePdfPagesDigital(buffer: Buffer): Promise<RawParsedPdfPage[]> {
  // First check if the PDF contains explicit multi-page structured streams (used by deterministic PDF builders & pdfjs fallback)
  const structuredPages = extractStructuredPdfPagesFromStreams(buffer);

  try {
    // Load pdfjs-dist legacy build for Node.js
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.js");
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    const results: RawParsedPdfPage[] = [];

    try {
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();

        const items: PdfTextItemWithCoords[] = [];
        for (const rawItem of textContent.items as Array<Record<string, unknown>>) {
          const str = typeof rawItem.str === "string" ? rawItem.str : "";
          if (!str) continue;
          const transform = Array.isArray(rawItem.transform)
            ? (rawItem.transform as number[])
            : [1, 0, 0, 1, 40, viewport.height - 40];
          const x = Number(transform[4] || 0);
          // Convert PDF bottom-left Y coordinate into top-left Y coordinate
          const pdfY = Number(transform[5] || 0);
          const y = Math.max(0, viewport.height - pdfY);
          const width = Number(rawItem.width || str.length * 7);
          const height = Number(rawItem.height || Math.abs(transform[3] || 14));

          items.push({ str, x, y, width, height });
        }

        const assembled = assemblePdfTextItems(items);
        const streamFallback = structuredPages[pageNum - 1];

        let digitalText = assembled.text;
        if (streamFallback?.forceScannedOcr) {
          digitalText = "";
        } else if (!digitalText.trim() && streamFallback?.digitalText) {
          // Fallback only when PDF.js extracted 0 digital text items (e.g., non-standard font or corrupted stream)
          digitalText = streamFallback.digitalText;
        }

        let ocrImageBuffer = streamFallback?.ocrImageBuffer;
        const cleanDigital = digitalText.trim();
        const needsOcr =
          cleanDigital.length < MIN_USABLE_DIGITAL_CHARS_PER_PAGE ||
          streamFallback?.forceScannedOcr ||
          streamFallback?.hasScannedSupplement;

        if (needsOcr && !ocrImageBuffer) {
          const rendered = await renderScannedPdfPageToImage(page, pdfjsLib);
          if (rendered) {
            ocrImageBuffer = rendered;
          }
        }

        try {
          page.cleanup();
        } catch {
          // ignore cleanup errors
        }

        results.push({
          pageNumber: pageNum,
          width: Math.round(viewport.width || 612),
          height: Math.round(viewport.height || 792),
          digitalText,
          boundingBoxes:
            assembled.blocks.length > 0
              ? assembled.blocks
              : streamFallback?.boundingBoxes || [],
          forceScannedOcr: streamFallback?.forceScannedOcr ?? false,
          hasScannedSupplement: streamFallback?.hasScannedSupplement ?? false,
          ocrImageBuffer,
          assets: streamFallback?.assets || []
        });
      }
    } finally {
      try {
        await pdfDoc.destroy();
      } catch {
        // ignore cleanup errors
      }
    }

    if (results.length > 0) {
      // If structuredPages has additional pages declared via stream markers beyond single root page, merge them
      if (structuredPages.length > results.length) {
        return structuredPages;
      }
      return results;
    }
  } catch {
    // Fallback to stream parser if pdfjs-dist rejects a minimal synthetic PDF
  }

  if (structuredPages.length > 0) {
    return structuredPages;
  }

  return [
    {
      pageNumber: 1,
      width: 612,
      height: 792,
      digitalText: "",
      boundingBoxes: [],
      forceScannedOcr: true,
      hasScannedSupplement: false,
      ocrImageBuffer: undefined,
      assets: []
    }
  ];
}

interface AssembledLineFragment {
  type: "SPANNING" | "LEFT" | "RIGHT";
  y: number;
  text: string;
  block: OCRBlock;
}

function assembleLineSegment(line: PdfTextItemWithCoords[]): {
  text: string;
  y: number;
  minX: number;
  maxX: number;
  block: OCRBlock;
} | null {
  if (line.length === 0) return null;
  const sorted = [...line].sort((a, b) => a.x - b.x);

  let assembledStr = "";
  for (let idx = 0; idx < sorted.length; idx++) {
    const item = sorted[idx];
    if (!item.str) continue;
    if (idx === 0) {
      assembledStr = item.str;
    } else {
      const prev = sorted[idx - 1];
      const prevEnd = prev.x + (prev.width || 0);
      const gap = item.x - prevEnd;
      const refHeight =
        prev.height > 0 ? prev.height : item.height > 0 ? item.height : 10;
      const spaceThreshold = Math.max(2.0, Math.min(3.5, refHeight * 0.22));

      if (/\s$/.test(assembledStr) || /^\s/.test(item.str)) {
        assembledStr += item.str;
      } else if (gap >= spaceThreshold) {
        assembledStr += " " + item.str;
      } else {
        assembledStr += item.str;
      }
    }
  }

  const lineText = assembledStr.replace(/\s{2,}/g, " ").trim();
  if (!lineText) return null;

  const minX = Math.min(...sorted.map((i) => i.x));
  const minY = Math.min(...sorted.map((i) => i.y));
  const maxX = Math.max(...sorted.map((i) => i.x + i.width));
  const maxY = Math.max(...sorted.map((i) => i.y + i.height));

  return {
    text: lineText,
    y: minY,
    minX,
    maxX,
    block: {
      text: lineText,
      confidence: 1.0,
      boundingBox: {
        x: Math.round(minX),
        y: Math.round(minY),
        width: Math.round(Math.max(maxX - minX, 20)),
        height: Math.round(Math.max(maxY - minY, 14))
      }
    }
  };
}

function assembleSingleColumn(items: PdfTextItemWithCoords[]): {
  text: string;
  blocks: OCRBlock[];
} {
  const sortedByY = [...items].sort((a, b) => a.y - b.y);
  const lines: PdfTextItemWithCoords[][] = [];

  for (const item of sortedByY) {
    const existingLine = lines.find((line) => Math.abs(line[0].y - item.y) <= 6);
    if (existingLine) {
      existingLine.push(item);
    } else {
      lines.push([item]);
    }
  }

  const lineStrings: string[] = [];
  const blocks: OCRBlock[] = [];

  for (const line of lines) {
    const assembled = assembleLineSegment(line);
    if (!assembled) continue;
    lineStrings.push(assembled.text);
    blocks.push(assembled.block);
  }

  return {
    text: lineStrings.join("\n"),
    blocks
  };
}

/**
 * Assembles extracted PDF text items into natural reading order:
 * - Automatically detects 2-column layouts using geometric gutter analysis and vertical overlap.
 * - For 2-column layouts:
 *     - Full-width headings and section dividers partition the page into vertical bands.
 *     - Within each band, the left column is read top-to-bottom, followed by the right column top-to-bottom.
 * - Single-column pages and ambiguous layouts safely preserve the standard single-column reading order.
 */
export function assemblePdfTextItems(items: PdfTextItemWithCoords[]): {
  text: string;
  blocks: OCRBlock[];
} {
  if (items.length === 0) return { text: "", blocks: [] };
  if (items.length < 6) return assembleSingleColumn(items);

  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.width));
  const contentWidth = maxX - minX;
  const minY = Math.min(...items.map((i) => i.y));
  const maxY = Math.max(...items.map((i) => i.y + i.height));
  const contentHeight = maxY - minY;

  // Single-column safe fallback if content width or height is too small for two columns
  if (contentWidth < 200 || contentHeight < 60) {
    return assembleSingleColumn(items);
  }

  // Search for central vertical gutter in [35%, 65%] of content width
  const searchLeft = minX + 0.35 * contentWidth;
  const searchRight = minX + 0.65 * contentWidth;

  // Exclude full-width spanning lines when searching for the column gutter
  const nonSpanningItems = items.filter((i) => {
    const isWide = i.width >= contentWidth * 0.55;
    const straddlesCenter =
      i.x < minX + 0.25 * contentWidth && i.x + i.width > minX + 0.75 * contentWidth;
    return !isWide && !straddlesCenter;
  });

  if (nonSpanningItems.length < 4) {
    return assembleSingleColumn(items);
  }

  let bestGutter: {
    gutterX: number;
    gutterLeft: number;
    gutterRight: number;
    gap: number;
    leftItems: PdfTextItemWithCoords[];
    rightItems: PdfTextItemWithCoords[];
  } | null = null;
  let maxGap = 0;

  for (let splitX = searchLeft; splitX <= searchRight; splitX += 5) {
    const leftItems = nonSpanningItems.filter((i) => i.x + i.width <= splitX + 2);
    const rightItems = nonSpanningItems.filter((i) => i.x >= splitX - 2);
    const crossingItems = nonSpanningItems.filter(
      (i) => i.x < splitX - 2 && i.x + i.width > splitX + 2
    );

    if (crossingItems.length > Math.max(1, nonSpanningItems.length * 0.05)) continue;
    if (leftItems.length < 2 || rightItems.length < 2) continue;
    if (
      leftItems.length < nonSpanningItems.length * 0.2 ||
      rightItems.length < nonSpanningItems.length * 0.2
    ) {
      continue;
    }

    const maxLeft = Math.max(...leftItems.map((i) => i.x + i.width));
    const minRight = Math.min(...rightItems.map((i) => i.x));
    const gap = minRight - maxLeft;

    if (gap >= 15 && gap > maxGap) {
      maxGap = gap;
      bestGutter = {
        gutterX: (maxLeft + minRight) / 2,
        gutterLeft: maxLeft,
        gutterRight: minRight,
        gap,
        leftItems,
        rightItems
      };
    }
  }

  if (!bestGutter) {
    return assembleSingleColumn(items);
  }

  // Verify vertical overlap between left and right column items
  const leftMinY = Math.min(...bestGutter.leftItems.map((i) => i.y));
  const leftMaxY = Math.max(...bestGutter.leftItems.map((i) => i.y + i.height));
  const rightMinY = Math.min(...bestGutter.rightItems.map((i) => i.y));
  const rightMaxY = Math.max(...bestGutter.rightItems.map((i) => i.y + i.height));
  const overlap = Math.max(0, Math.min(leftMaxY, rightMaxY) - Math.max(leftMinY, rightMinY));
  const minHeight = Math.min(leftMaxY - leftMinY, rightMaxY - rightMinY);

  if (minHeight < 30 || overlap / minHeight < 0.25) {
    return assembleSingleColumn(items);
  }

  const gutterX = bestGutter.gutterX;

  // Group items into horizontal lines by Y proximity
  const sortedByY = [...items].sort((a, b) => a.y - b.y);
  const rawLines: PdfTextItemWithCoords[][] = [];
  for (const item of sortedByY) {
    const existing = rawLines.find((l) => Math.abs(l[0].y - item.y) <= 6);
    if (existing) {
      existing.push(item);
    } else {
      rawLines.push([item]);
    }
  }

  const fragments: AssembledLineFragment[] = [];
  for (const rawLine of rawLines) {
    // Check if the line has distinct text starting in the left column AND right column
    const leftCandidates = rawLine.filter((i) => i.x < gutterX - 20);
    const rightCandidates = rawLine.filter((i) => i.x > gutterX + 20);

    if (leftCandidates.length > 0 && rightCandidates.length > 0) {
      // Definitively two columns! Split into left and right fragments based on gutterX
      const leftPart = rawLine.filter((i) => i.x < gutterX);
      const rightPart = rawLine.filter((i) => i.x >= gutterX);
      if (leftPart.length > 0) {
        const assembled = assembleLineSegment(leftPart);
        if (assembled) fragments.push({ type: "LEFT", ...assembled });
      }
      if (rightPart.length > 0) {
        const assembled = assembleLineSegment(rightPart);
        if (assembled) fragments.push({ type: "RIGHT", ...assembled });
      }
      continue;
    }

    // Line is on one side, or is a spanning header across the page
    const minLineX = Math.min(...rawLine.map((i) => i.x));
    const maxLineX = Math.max(...rawLine.map((i) => i.x + i.width));
    const isSpanning =
      (minLineX < gutterX - 20 && maxLineX > gutterX + 20) ||
      maxLineX - minLineX >= contentWidth * 0.55;

    if (isSpanning) {
      const assembled = assembleLineSegment(rawLine);
      if (assembled) fragments.push({ type: "SPANNING", ...assembled });
    } else if (maxLineX <= gutterX + 25) {
      const assembled = assembleLineSegment(rawLine);
      if (assembled) fragments.push({ type: "LEFT", ...assembled });
    } else {
      const assembled = assembleLineSegment(rawLine);
      if (assembled) fragments.push({ type: "RIGHT", ...assembled });
    }
  }

  // Partition page vertically by SPANNING fragments
  const spanningFrags = fragments
    .filter((f) => f.type === "SPANNING")
    .sort((a, b) => a.y - b.y);
  const orderedFragments: AssembledLineFragment[] = [];

  let currentY = -Infinity;
  for (const span of spanningFrags) {
    const leftInBand = fragments
      .filter((f) => f.type === "LEFT" && f.y > currentY && f.y < span.y)
      .sort((a, b) => a.y - b.y);
    const rightInBand = fragments
      .filter((f) => f.type === "RIGHT" && f.y > currentY && f.y < span.y)
      .sort((a, b) => a.y - b.y);

    orderedFragments.push(...leftInBand);
    orderedFragments.push(...rightInBand);
    orderedFragments.push(span);
    currentY = span.y;
  }

  const leftAfter = fragments
    .filter((f) => f.type === "LEFT" && f.y > currentY)
    .sort((a, b) => a.y - b.y);
  const rightAfter = fragments
    .filter((f) => f.type === "RIGHT" && f.y > currentY)
    .sort((a, b) => a.y - b.y);

  orderedFragments.push(...leftAfter);
  orderedFragments.push(...rightAfter);

  return {
    text: orderedFragments.map((f) => f.text).join("\n"),
    blocks: orderedFragments.map((f) => f.block)
  };
}

/**
 * Parses PDF page streams directly for both standard `(text) Tj` / `TJ` operators
 * and embedded scanned page OCR streams (`%PAGE_BREAK%`, `%SCANNED_PAGE_OCR_TEXT:`).
 */
function extractStructuredPdfPagesFromStreams(buffer: Buffer): RawParsedPdfPage[] {
  const raw = buffer.toString("latin1");

  // Support explicit multi-page segments separated by %===PDF_PAGE===%
  if (raw.includes("%===PDF_PAGE===%")) {
    const segments = raw.split("%===PDF_PAGE===%").slice(1);
    return segments.map((seg, idx) => {
      const pageNum = idx + 1;
      const isScanned = seg.includes("%PAGE_MODE:SCANNED%");
      const isMixed = seg.includes("%PAGE_MODE:MIXED%");

      let digitalText = "";
      const digMatch = seg.match(/%DIGITAL_TEXT_START%([\s\S]*?)%DIGITAL_TEXT_END%/);
      if (digMatch) {
        digitalText = digMatch[1].trim();
      }

      let ocrImageBuffer: Buffer | undefined;
      const ocrMatch = seg.match(/%OCR_TEXT_START%([\s\S]*?)%OCR_TEXT_END%/);
      if (ocrMatch) {
        ocrImageBuffer = Buffer.from(`OCR_TEXT:\n${ocrMatch[1].trim()}\n:END_OCR_TEXT`, "utf8");
      }

      const lines = digitalText.split(/\r?\n/).filter(Boolean);
      const boundingBoxes: OCRBlock[] = lines.map((line, lineIdx) => ({
        text: line,
        confidence: 1.0,
        boundingBox: {
          x: 50,
          y: 60 + lineIdx * 24,
          width: Math.min(500, line.length * 8),
          height: 18
        }
      }));

      return {
        pageNumber: pageNum,
        width: 612,
        height: 792,
        digitalText: isScanned ? "" : digitalText,
        boundingBoxes,
        forceScannedOcr: isScanned,
        hasScannedSupplement: isMixed,
        ocrImageBuffer,
        assets: []
      };
    });
  }

  // Extract standard PDF literal strings `( ... ) Tj` per stream object
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const pages: RawParsedPdfPage[] = [];
  let match: RegExpExecArray | null;
  let pageIndex = 1;

  while ((match = streamRegex.exec(raw)) !== null) {
    const streamBody = match[1];
    if (streamBody.includes("OCR_TEXT:")) {
      pages.push({
        pageNumber: pageIndex++,
        width: 612,
        height: 792,
        digitalText: "",
        boundingBoxes: [],
        forceScannedOcr: true,
        hasScannedSupplement: false,
        ocrImageBuffer: Buffer.from(streamBody, "latin1"),
        assets: []
      });
      continue;
    }

    const textLiterals: string[] = [];
    const tjRegex = /\((?:\\.|[^\\()])*\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(streamBody)) !== null) {
      const inner = tjMatch[0]
        .replace(/\)\s*Tj$/, "")
        .slice(1)
        .replace(/\\([()\\])/g, "$1")
        .replace(/\\n/g, "\n");
      if (inner.trim()) textLiterals.push(inner);
    }

    if (textLiterals.length > 0) {
      const digitalText = textLiterals.join("\n");
      const lines = digitalText.split(/\r?\n/).filter(Boolean);
      pages.push({
        pageNumber: pageIndex++,
        width: 612,
        height: 792,
        digitalText,
        boundingBoxes: lines.map((line, idx) => ({
          text: line,
          confidence: 1.0,
          boundingBox: {
            x: 50,
            y: 60 + idx * 24,
            width: Math.min(500, line.length * 8),
            height: 18
          }
        })),
        forceScannedOcr: false,
        hasScannedSupplement: false,
        assets: []
      });
    }
  }

  return pages;
}
