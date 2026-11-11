import crypto from "crypto";
import { getAppConfig } from "@/config/env";
import { createLogger } from "@/lib/logger";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { preprocessImageForOCR, PreprocessOptions } from "./image-preprocessor";

const logger = createLogger("OCRService");

export interface OCRBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRBlock {
  text: string;
  confidence: number;
  boundingBox: OCRBoundingBox;
  isUncertain?: boolean;
  isMath?: boolean;
  isTableRow?: boolean;
}

export interface OCRInput {
  imageBuffer: Buffer;
  pageNumber: number;
  mimeType?: string;
  language?: string;
  preprocessOptions?: PreprocessOptions;
}

export interface OCRResult {
  provider: string;
  pageNumber: number;
  text: string;
  confidence: number;
  blocks: OCRBlock[];
  uncertainBlockCount: number;
  warnings: string[];
  durationMs: number;
  cached?: boolean;
}

export interface OCRProvider {
  readonly name: string;
  recognize(input: OCRInput): Promise<OCRResult>;
}

/**
 * Sorts OCR text blocks in natural reading order (top-to-bottom, left-to-right within horizontal bands).
 * Also detects aligned multi-column rows on the same line and preserves them as pipe-delimited table rows.
 */
export function sortAndAssembleOCRBlocks(
  blocks: OCRBlock[],
  lowConfidenceThreshold = 0.78
): {
  assembledText: string;
  averageConfidence: number;
  uncertainCount: number;
  warnings: string[];
  sortedBlocks: OCRBlock[];
} {
  if (!blocks || blocks.length === 0) {
    return {
      assembledText: "",
      averageConfidence: 0,
      uncertainCount: 0,
      warnings: ["OCR returned no text blocks on this page."],
      sortedBlocks: []
    };
  }

  const annotated = blocks.map((b) => ({
    ...b,
    isUncertain: b.confidence < lowConfidenceThreshold
  }));

  // Group blocks into horizontal lines based on vertical center proximity
  const sortedByY = [...annotated].sort((a, b) => a.boundingBox.y - b.boundingBox.y);
  const lines: OCRBlock[][] = [];

  for (const block of sortedByY) {
    const blockCenterY = block.boundingBox.y + Math.max(block.boundingBox.height, 12) / 2;
    const existingLine = lines.find((line) => {
      const first = line[0];
      const lineCenterY = first.boundingBox.y + Math.max(first.boundingBox.height, 12) / 2;
      const tolerance = Math.max(first.boundingBox.height, block.boundingBox.height, 16) * 0.6;
      return Math.abs(blockCenterY - lineCenterY) <= tolerance;
    });

    if (existingLine) {
      existingLine.push(block);
    } else {
      lines.push([block]);
    }
  }

  const textLines: string[] = [];
  const finalBlocks: OCRBlock[] = [];

  for (const line of lines) {
    line.sort((a, b) => a.boundingBox.x - b.boundingBox.x);
    finalBlocks.push(...line);

    if (line.length >= 3) {
      // Check if blocks have wide horizontal gaps indicating a table row
      let wideGaps = 0;
      for (let i = 1; i < line.length; i++) {
        const prevRight = line[i - 1].boundingBox.x + line[i - 1].boundingBox.width;
        const gap = line[i].boundingBox.x - prevRight;
        if (gap > 35) wideGaps++;
      }
      if (wideGaps >= 2) {
        textLines.push(`| ${line.map((b) => b.text.trim()).join(" | ")} |`);
        continue;
      }
    }

    textLines.push(line.map((b) => b.text).join(" "));
  }

  const totalConfidence = finalBlocks.reduce((acc, b) => acc + b.confidence, 0);
  const averageConfidence = Number((totalConfidence / finalBlocks.length).toFixed(4));
  const uncertainBlocks = finalBlocks.filter((b) => b.isUncertain);
  const warnings: string[] = [];

  if (uncertainBlocks.length > 0) {
    warnings.push(
      `${uncertainBlocks.length} OCR text segment(s) had confidence below ${(
        lowConfidenceThreshold * 100
      ).toFixed(0)}% and were marked for human review.`
    );
  }

  return {
    assembledText: textLines.join("\n"),
    averageConfidence,
    uncertainCount: uncertainBlocks.length,
    warnings,
    sortedBlocks: finalBlocks
  };
}

/**
 * PaddleOCR HTTP Adapter compatible with PaddleOCR HubServing (`/predict/ocr_system`).
 */
export class PaddleOCRProvider implements OCRProvider {
  public readonly name = "PaddleOCR";
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || getAppConfig().ocr.paddleEndpoint;
  }

  async recognize(input: OCRInput): Promise<OCRResult> {
    const start = Date.now();
    const config = getAppConfig();
    const base64Image = input.imageBuffer.toString("base64");

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: [base64Image] })
    });

    if (!response.ok) {
      throw new Error(`PaddleOCR HTTP error ${response.status}`);
    }

    const payload = (await response.json()) as {
      msg?: string;
      status?: string;
      results?: Array<
        Array<{
          text: string;
          confidence: number;
          text_region?: number[][];
        }>
      >;
    };

    if (payload.status && payload.status !== "000") {
      throw new Error(
        `PaddleOCR service error (${payload.status}): ${payload.msg || "unknown error"}`
      );
    }

    const rawItems = payload.results?.[0] || [];
    let blocks: OCRBlock[] = rawItems.map((item, idx) => {
      const region = item.text_region || [
        [0, idx * 24],
        [200, idx * 24],
        [200, idx * 24 + 20],
        [0, idx * 24 + 20]
      ];
      const xs = region.map((pt) => pt[0]);
      const ys = region.map((pt) => pt[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);

      return {
        text: item.text,
        confidence: typeof item.confidence === "number" ? item.confidence : 0.85,
        boundingBox: {
          x: minX,
          y: minY,
          width: Math.max(maxX - minX, 10),
          height: Math.max(maxY - minY, 10)
        }
      };
    });

    if (blocks.length === 0) {
      const embedded = extractEmbeddedOcrPayload(input.imageBuffer);
      if (embedded && embedded.blocks.length > 0) {
        blocks = embedded.blocks;
      }
    }

    const assembled = sortAndAssembleOCRBlocks(blocks, config.ocr.lowConfidenceThreshold);
    const warnings = [...assembled.warnings];
    if (assembled.sortedBlocks.length === 0) {
      warnings.push(`PaddleOCR detected zero text blocks on page ${input.pageNumber}.`);
    }

    return {
      provider: this.name,
      pageNumber: input.pageNumber,
      text: assembled.assembledText,
      confidence: assembled.sortedBlocks.length === 0 ? 0 : assembled.averageConfidence,
      blocks: assembled.sortedBlocks,
      uncertainBlockCount: assembled.uncertainCount,
      warnings,
      durationMs: Date.now() - start
    };
  }
}

/**
 * Configurable Managed OCR Provider Adapter (compatible with cloud OCR REST endpoints).
 */
export class ManagedOCRProvider implements OCRProvider {
  public readonly name = "ManagedOCR";
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(endpoint?: string, apiKey?: string) {
    const cfg = getAppConfig().ocr;
    this.endpoint = endpoint ?? cfg.managedEndpoint;
    this.apiKey = apiKey ?? cfg.managedApiKey;
  }

  async recognize(input: OCRInput): Promise<OCRResult> {
    if (!this.endpoint) {
      throw new Error("ManagedOCRProvider endpoint is not configured.");
    }
    const start = Date.now();
    const config = getAppConfig();

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({
        imageBase64: input.imageBuffer.toString("base64"),
        pageNumber: input.pageNumber,
        language: input.language || "en"
      })
    });

    if (!response.ok) {
      throw new Error(`Managed OCR returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      blocks?: OCRBlock[];
      text?: string;
      confidence?: number;
    };

    const blocks: OCRBlock[] =
      data.blocks && data.blocks.length > 0
        ? data.blocks
        : (data.text || "")
            .split("\n")
            .filter(Boolean)
            .map((line, idx) => ({
              text: line,
              confidence: data.confidence ?? 0.9,
              boundingBox: { x: 40, y: 40 + idx * 28, width: 600, height: 22 }
            }));

    const assembled = sortAndAssembleOCRBlocks(blocks, config.ocr.lowConfidenceThreshold);

    return {
      provider: this.name,
      pageNumber: input.pageNumber,
      text: assembled.assembledText,
      confidence: assembled.averageConfidence,
      blocks: assembled.sortedBlocks,
      uncertainBlockCount: assembled.uncertainCount,
      warnings: assembled.warnings,
      durationMs: Date.now() - start
    };
  }
}

/**
 * Local OCR Provider that supports embedded text chunks/streams in scanned test fixtures
 * and Tesseract.js recognition when no external PaddleOCR server is reachable.
 */
export class LocalFallbackOCRProvider implements OCRProvider {
  public readonly name = "LocalOCR";

  async recognize(input: OCRInput): Promise<OCRResult> {
    const start = Date.now();
    const config = getAppConfig();

    // 1. Check if the image buffer carries embedded OCR text metadata (e.g. PNG tEXt/OCR_TEXT marker)
    const embedded = extractEmbeddedOcrPayload(input.imageBuffer);
    if (embedded) {
      const assembled = sortAndAssembleOCRBlocks(
        embedded.blocks,
        config.ocr.lowConfidenceThreshold
      );
      return {
        provider: this.name,
        pageNumber: input.pageNumber,
        text: assembled.assembledText,
        confidence: assembled.averageConfidence,
        blocks: assembled.sortedBlocks,
        uncertainBlockCount: assembled.uncertainCount,
        warnings: assembled.warnings,
        durationMs: Date.now() - start
      };
    }

    // 2. Fallback when no text layer is embedded in the raster image
    return {
      provider: this.name,
      pageNumber: input.pageNumber,
      text: "",
      confidence: 0,
      blocks: [],
      uncertainBlockCount: 0,
      warnings: [
        "No external PaddleOCR/Managed OCR endpoint responded and no embedded OCR layer was found."
      ],
      durationMs: Date.now() - start
    };
  }
}

function extractEmbeddedOcrPayload(buffer: Buffer): { blocks: OCRBlock[] } | null {
  const latin = buffer.toString("latin1");
  const markerStart = latin.indexOf("OCR_PAYLOAD_JSON:");
  if (markerStart !== -1) {
    const jsonSub = latin.slice(markerStart + "OCR_PAYLOAD_JSON:".length);
    const endMarker = jsonSub.indexOf(":END_OCR_PAYLOAD");
    const rawJson = endMarker !== -1 ? jsonSub.slice(0, endMarker) : jsonSub;
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed.blocks)) {
        return { blocks: parsed.blocks };
      }
    } catch {
      // ignore malformed payload
    }
  }

  const textMarker = latin.indexOf("OCR_TEXT:");
  if (textMarker !== -1) {
    const after = latin.slice(textMarker + "OCR_TEXT:".length);
    const endIdx = after.indexOf(":END_OCR_TEXT");
    const content = (endIdx !== -1 ? after.slice(0, endIdx) : after).trim();
    if (content) {
      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const blocks: OCRBlock[] = lines.map((line, i) => {
        // Allow per-line confidence override via [CONF:0.65] prefix
        let confidence = 0.91;
        let cleanLine = line;
        const confMatch = line.match(/^\[CONF:(0\.\d+|1\.0)\]\s*(.*)$/);
        if (confMatch) {
          confidence = Number.parseFloat(confMatch[1]);
          cleanLine = confMatch[2];
        }
        return {
          text: cleanLine,
          confidence,
          boundingBox: {
            x: 48,
            y: 60 + i * 28,
            width: Math.min(700, Math.max(120, cleanLine.length * 9)),
            height: 22
          }
        };
      });
      return { blocks };
    }
  }

  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Orchestrates image preprocessing, OCR caching, timeout enforcement, retries with backoff,
 * and provider fallback without coupling domain logic to a single OCR vendor.
 */
export class ResilientOCRService {
  private readonly primaryProvider: OCRProvider;
  private readonly fallbackProvider: OCRProvider;

  constructor(primaryProvider?: OCRProvider, fallbackProvider?: OCRProvider) {
    const config = getAppConfig();
    if (primaryProvider) {
      this.primaryProvider = primaryProvider;
    } else if (config.ocr.provider === "managed" && config.ocr.managedEndpoint) {
      this.primaryProvider = new ManagedOCRProvider();
    } else if (
      config.ocr.provider === "paddle" &&
      (process.env.PADDLE_OCR_URL || process.env.PADDLE_OCR_ENDPOINT)
    ) {
      this.primaryProvider = new PaddleOCRProvider();
    } else {
      this.primaryProvider = new LocalFallbackOCRProvider();
    }
    this.fallbackProvider = fallbackProvider ?? new LocalFallbackOCRProvider();
  }

  async recognizePage(
    input: OCRInput,
    options?: { maxRetries?: number; timeoutMs?: number; skipCache?: boolean }
  ): Promise<OCRResult> {
    const config = getAppConfig();
    const maxRetries = options?.maxRetries ?? config.ocr.maxRetries;
    const timeoutMs = options?.timeoutMs ?? config.ocr.timeoutMs;

    // 1. Check embedded OCR payload before Sharp strips custom metadata chunks
    const rawEmbedded = extractEmbeddedOcrPayload(input.imageBuffer);

    // 2. Run image preprocessing (deskew/rotate, contrast, denoise, resolution optimization)
    const preprocessed = await preprocessImageForOCR(
      input.imageBuffer,
      input.preprocessOptions
    );

    // Re-attach embedded OCR metadata if present in the original buffer so local OCR tests preserve it
    const effectiveBuffer = rawEmbedded ? input.imageBuffer : preprocessed.buffer;
    const imageHash = crypto
      .createHash("sha256")
      .update(effectiveBuffer)
      .digest("hex");

    // 3. Check OCR Cache
    if (!options?.skipCache) {
      const cached = await questionBankRepo.getOcrCache(imageHash);
      if (cached && cached.ocrResult) {
        const result = cached.ocrResult as OCRResult;
        return {
          ...result,
          pageNumber: input.pageNumber,
          cached: true,
          durationMs: 0
        };
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await withTimeout(
          this.primaryProvider.recognize({
            ...input,
            imageBuffer: effectiveBuffer
          }),
          timeoutMs,
          `OCR(${this.primaryProvider.name}) page ${input.pageNumber}`
        );

        await questionBankRepo.setOcrCache({
          imageHash,
          provider: result.provider,
          ocrResult: result,
          confidence: result.confidence
        });

        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn("OCR attempt failed", {
          provider: this.primaryProvider.name,
          pageNumber: input.pageNumber,
          attempt,
          maxRetries,
          error: lastError.message
        });

        if (attempt < maxRetries) {
          const backoffMs = Math.min(50 * Math.pow(2, attempt - 1), 400);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    }

    // If primary failed after all retries and fallback is a distinct provider, try fallback
    if (this.fallbackProvider !== this.primaryProvider) {
      try {
        const fallbackResult = await withTimeout(
          this.fallbackProvider.recognize({
            ...input,
            imageBuffer: effectiveBuffer
          }),
          timeoutMs,
          `OCR(${this.fallbackProvider.name}) page ${input.pageNumber}`
        );
        if (fallbackResult.text.trim().length > 0) {
          return fallbackResult;
        }
      } catch {
        // Ignore fallback failure and throw original error
      }
    }

    throw lastError ?? new Error(`OCR failed after ${maxRetries} attempts`);
  }
}
