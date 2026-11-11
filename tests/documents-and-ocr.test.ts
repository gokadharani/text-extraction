import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach } from "vitest";
import { validateUploadedFile } from "@/lib/storage/file-validator";
import {
  buildValidPdfBuffer,
  buildValidDocxBuffer,
  buildValidXlsxBuffer,
  buildValidScannedPngBuffer
} from "@/lib/sample-documents";
import { classifyAndExtractDocument } from "@/adapters/documents/document-classifier";
import { extractPdfDocument } from "@/adapters/documents/pdf-extractor";
import {
  OCRInput,
  OCRProvider,
  OCRResult,
  PaddleOCRProvider,
  ResilientOCRService
} from "@/adapters/ocr/ocr-provider";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { segmentAndParseQuestions } from "@/domain/extraction/question-segmenter";
import { tiptapDocToPlainText } from "@/domain/richtext/tiptap-converter";

describe("Document Classification, File Validation & OCR Pipeline", () => {
  beforeEach(async () => {
    await questionBankRepo.resetForTests();
  });

  it("1. Digital PDF extraction: extracts text via PDF.js/stream without running OCR", async () => {
    const pdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          digitalText:
            "Q1. Which planet is known as the Red Planet?\n(A) Venus\n(B) Mars\n(C) Jupiter\n(D) Saturn\nAnswer: B"
        }
      ]
    });

    const validation = validateUploadedFile(pdfBuf, "astronomy.pdf");
    expect(validation.valid).toBe(true);
    expect(validation.category).toBe("PDF");

    const extracted = await classifyAndExtractDocument(
      pdfBuf,
      "PDF",
      "application/pdf"
    );

    expect(extracted.detectedFormat).toBe("DIGITAL_PDF");
    expect(extracted.totalPages).toBe(1);
    expect(extracted.pages[0].classification).toBe("DIGITAL");
    expect(extracted.pages[0].ocrUsed).toBe(false);
    expect(extracted.pages[0].rawText).toContain("Red Planet");
  });

  it("2. Scanned PDF extraction: detects lack of digital text and runs OCR", async () => {
    const scannedPdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "SCANNED",
          ocrText:
            "Q1. What is the speed of light in vacuum?\n(A) $3 \\times 10^8$ m/s\n(B) $3 \\times 10^6$ m/s\nAnswer: A"
        }
      ]
    });

    const extracted = await classifyAndExtractDocument(
      scannedPdfBuf,
      "PDF",
      "application/pdf"
    );

    expect(extracted.detectedFormat).toBe("SCANNED_PDF");
    expect(extracted.pages[0].classification).toBe("SCANNED");
    expect(extracted.pages[0].ocrUsed).toBe(true);
    expect(extracted.pages[0].rawText).toContain("speed of light");
  });

  it("3. Mixed PDF extraction: runs digital extraction on page 1 and OCR only on scanned page 2", async () => {
    const mixedPdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          digitalText:
            "Q1. Digital question on page one with sufficient characters to be classified as digital.\n(A) Alpha\n(B) Beta\nAnswer: A"
        },
        {
          mode: "SCANNED",
          ocrText:
            "Q2. Scanned question on page two requiring OCR recognition.\n(A) Gamma\n(B) Delta\nAnswer: B"
        }
      ]
    });

    const extracted = await classifyAndExtractDocument(
      mixedPdfBuf,
      "PDF",
      "application/pdf"
    );

    expect(extracted.detectedFormat).toBe("MIXED_PDF");
    expect(extracted.totalPages).toBe(2);
    expect(extracted.pages[0].classification).toBe("DIGITAL");
    expect(extracted.pages[0].ocrUsed).toBe(false);
    expect(extracted.pages[1].classification).toBe("SCANNED");
    expect(extracted.pages[1].ocrUsed).toBe(true);
    expect(extracted.pages[1].rawText).toContain("Scanned question on page two");
  });

  it("4. DOCX extraction: extracts paragraphs and formatting from DOCX archive", async () => {
    const docxBuf = buildValidDocxBuffer(
      "Section A\nQ1. What is the chemical formula of water?\n(A) H~2~O\n(B) CO~2~\nAnswer: A"
    );

    const validation = validateUploadedFile(docxBuf, "chemistry.docx");
    expect(validation.valid).toBe(true);
    expect(validation.category).toBe("DOCX");

    const extracted = await classifyAndExtractDocument(
      docxBuf,
      "DOCX",
      validation.detectedMimeType!
    );

    expect(extracted.detectedFormat).toBe("DOCX");
    expect(extracted.pages[0].rawText).toContain("chemical formula of water");
  });

  it("5. XLSX extraction: extracts structured rows and columns using ExcelJS", async () => {
    const xlsxBuf = await buildValidXlsxBuffer([
      {
        qNo: "1",
        section: "Section A",
        type: "MCQ",
        question: "What is 12 * 12?",
        optA: "124",
        optB: "144",
        optC: "164",
        optD: "120",
        answer: "B",
        explanation: "12 multiplied by 12 equals 144."
      }
    ]);

    const validation = validateUploadedFile(xlsxBuf, "math-sheet.xlsx");
    expect(validation.valid).toBe(true);
    expect(validation.category).toBe("XLSX");

    const extracted = await classifyAndExtractDocument(
      xlsxBuf,
      "XLSX",
      validation.detectedMimeType!
    );

    expect(extracted.detectedFormat).toBe("XLSX");
    expect(extracted.pages[0].rawText).toContain("What is 12 * 12?");
    expect(extracted.pages[0].rawText).toContain("(B) 144");
    expect(extracted.pages[0].rawText).toContain("Answer: B");
  });

  it("6. Image OCR & Low-Confidence Scanned Pages: preprocesses with Sharp and flags uncertain OCR lines without discarding them", async () => {
    const pngBuf = await buildValidScannedPngBuffer(
      "[CONF:0.62] Q1. Partially faded scan question about quantum tunneling?\n(A) True\n(B) False"
    );

    const validation = validateUploadedFile(pngBuf, "scan-page.png");
    expect(validation.valid).toBe(true);
    expect(validation.category).toBe("PNG");

    const extracted = await classifyAndExtractDocument(
      pngBuf,
      "PNG",
      "image/png"
    );

    expect(extracted.detectedFormat).toBe("IMAGE");
    expect(extracted.pages[0].ocrUsed).toBe(true);
    // Low confidence text is NOT discarded
    expect(extracted.pages[0].rawText).toContain("quantum tunneling");
    // Warning is recorded for human review
    expect(extracted.pages[0].warnings.length).toBeGreaterThan(0);
    expect(extracted.pages[0].warnings[0]).toContain("confidence below");
  });

  it("7. OCR Retries: retries transient OCR provider failures and succeeds on retry", async () => {
    let attempts = 0;
    const flakyProvider: OCRProvider = {
      name: "FlakyPaddleOCR",
      async recognize(input: OCRInput): Promise<OCRResult> {
        attempts++;
        if (attempts < 3) {
          throw new Error("Transient network timeout from OCR worker");
        }
        return {
          provider: "FlakyPaddleOCR",
          pageNumber: input.pageNumber,
          text: "Q1. Recovered question after OCR retry?\n(A) Yes\n(B) No\nAnswer: A",
          confidence: 0.94,
          blocks: [],
          uncertainBlockCount: 0,
          warnings: [],
          durationMs: 15
        };
      }
    };

    const ocrService = new ResilientOCRService(flakyProvider);
    const pngBuf = await buildValidScannedPngBuffer("test");

    const res = await ocrService.recognizePage(
      { imageBuffer: pngBuf, pageNumber: 1 },
      { maxRetries: 3, skipCache: true }
    );

    expect(attempts).toBe(3);
    expect(res.text).toContain("Recovered question after OCR retry");
    expect(res.provider).toBe("FlakyPaddleOCR");
  });

  it("8. Security & Malformed Documents: rejects spoofed extensions, encrypted PDFs, and executable/EICAR payloads", () => {
    // Extension spoofing: PNG bytes named .pdf
    const fakePdf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const spoofRes = validateUploadedFile(fakePdf, "spoofed.pdf");
    expect(spoofRes.valid).toBe(false);
    expect(spoofRes.errorCode).toBe("SIGNATURE_MISMATCH");

    // Encrypted PDF
    const encryptedPdf = buildValidPdfBuffer({
      pages: [{ mode: "DIGITAL", digitalText: "Secret" }],
      encrypted: true
    });
    const encRes = validateUploadedFile(encryptedPdf, "locked.pdf");
    expect(encRes.valid).toBe(false);
    expect(encRes.errorCode).toBe("ENCRYPTED_DOCUMENT");

    // Windows MZ executable disguised as .pdf
    const exeBuf = Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00", "latin1");
    const exeRes = validateUploadedFile(exeBuf, "malware.pdf");
    expect(exeRes.valid).toBe(false);
    expect(exeRes.errorCode).toBe("SUSPICIOUS_CONTENT");
  });

  it("9. Scanned PDF: renders each page to PNG, invokes OCR with image buffers (never raw PDF), and recognizes all 5 questions", async () => {
    const fixturePath = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "digital-assessment-with-answers.pdf"
    );
    expect(fs.existsSync(fixturePath)).toBe(true);
    const pdfBuf = fs.readFileSync(fixturePath);

    // Deterministic PaddleOCR HubServing payloads for Page 1 & Page 2
    const page1Detections = [
      { text: "Section A - Computer Science Assessment", confidence: 0.96, text_region: [[50, 40], [400, 40], [400, 60], [50, 60]] },
      { text: "Q1. Which data structure operates on a Last-In-First-Out (LIFO) basis?", confidence: 0.97, text_region: [[50, 80], [550, 80], [550, 100], [50, 100]] },
      { text: "(A) Queue", confidence: 0.95, text_region: [[60, 110], [150, 110], [150, 130], [60, 130]] },
      { text: "(B) Stack", confidence: 0.98, text_region: [[60, 140], [150, 140], [150, 160], [60, 160]] },
      { text: "(C) Binary Tree", confidence: 0.95, text_region: [[60, 170], [170, 170], [170, 190], [60, 190]] },
      { text: "(D) Linked List", confidence: 0.94, text_region: [[60, 200], [170, 200], [170, 220], [60, 220]] },
      { text: "Answer: B", confidence: 0.99, text_region: [[50, 235], [160, 235], [160, 255], [50, 255]] },
      { text: "Explanation: A stack is a LIFO structure where elements are added and removed from the same end.", confidence: 0.94, text_region: [[50, 265], [680, 265], [680, 285], [50, 285]] },
      { text: "Q2. What is the average-case time complexity of QuickSort?", confidence: 0.96, text_region: [[50, 320], [520, 320], [520, 340], [50, 340]] },
      { text: "(A) O(n)", confidence: 0.95, text_region: [[60, 350], [150, 350], [150, 370], [60, 370]] },
      { text: "(B) O(n^2)", confidence: 0.95, text_region: [[60, 380], [150, 380], [150, 400], [60, 400]] },
      { text: "(C) O(n log n)", confidence: 0.98, text_region: [[60, 410], [180, 410], [180, 430], [60, 430]] },
      { text: "(D) O(log n)", confidence: 0.94, text_region: [[60, 440], [160, 440], [160, 460], [60, 460]] },
      { text: "Answer: C", confidence: 0.99, text_region: [[50, 475], [160, 475], [160, 495], [50, 495]] }
    ];

    const page2Detections = [
      { text: "Section B - Systems and Networks", confidence: 0.95, text_region: [[50, 40], [350, 40], [350, 60], [50, 60]] },
      { text: "Q3. Which of the following protocols operate at the Transport Layer? (Select all that apply)", confidence: 0.97, text_region: [[50, 80], [650, 80], [650, 100], [50, 100]] },
      { text: "(A) TCP", confidence: 0.96, text_region: [[60, 110], [150, 110], [150, 130], [60, 130]] },
      { text: "(B) UDP", confidence: 0.96, text_region: [[60, 140], [150, 140], [150, 160], [60, 160]] },
      { text: "(C) IP", confidence: 0.95, text_region: [[60, 170], [150, 170], [150, 190], [60, 190]] },
      { text: "(D) HTTP", confidence: 0.95, text_region: [[60, 200], [150, 200], [150, 220], [60, 220]] },
      { text: "Answer: A, B", confidence: 0.98, text_region: [[50, 235], [170, 235], [170, 255], [50, 255]] },
      { text: "Q4. True or False: HTTPS encrypts data in transit using TLS.", confidence: 0.96, text_region: [[50, 290], [550, 290], [550, 310], [50, 310]] },
      { text: "Answer: True", confidence: 0.99, text_region: [[50, 325], [170, 325], [170, 345], [50, 345]] },
      { text: "Q5. True or False: Java supports multiple inheritance through classes.", confidence: 0.95, text_region: [[50, 380], [550, 380], [550, 400], [50, 400]] },
      { text: "Answer: False", confidence: 0.99, text_region: [[50, 415], [170, 415], [170, 435], [50, 435]] }
    ];

    const originalFetch = globalThis.fetch;
    let paddleCallCount = 0;

    try {
      globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toContain("/predict/ocr_system");
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeDefined();

        const parsedBody = JSON.parse(init!.body as string);
        expect(Array.isArray(parsedBody.images)).toBe(true);
        expect(parsedBody.images.length).toBe(1);

        paddleCallCount++;
        const results = paddleCallCount === 1 ? page1Detections : page2Detections;

        return new Response(
          JSON.stringify({
            status: "000",
            msg: "",
            results: [results]
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      };

      // Spy on OCR calls to verify imageBuffer is a valid PNG and NEVER raw %PDF
      const receivedBuffers: Buffer[] = [];
      const realPaddle = new PaddleOCRProvider();

      const spyProvider: OCRProvider = {
        name: "SpyPaddleOCR",
        async recognize(input: OCRInput): Promise<OCRResult> {
          receivedBuffers.push(input.imageBuffer);
          // Verify buffer is a genuine PNG, NOT %PDF
          const isPdf = input.imageBuffer.slice(0, 4).toString("utf8") === "%PDF";
          expect(isPdf).toBe(false);
          const isPng = input.imageBuffer.slice(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          );
          expect(isPng).toBe(true);

          return realPaddle.recognize(input);
        }
      };

      const spyOcrService = new ResilientOCRService(spyProvider);
      const extracted = await extractPdfDocument(pdfBuf, spyOcrService);

      expect(extracted.detectedFormat).toBe("SCANNED_PDF");
      expect(extracted.totalPages).toBe(2);
      expect(receivedBuffers.length).toBe(2);
      expect(paddleCallCount).toBe(2);

      // Verify both pages used OCR and returned non-empty text
      for (const page of extracted.pages) {
        expect(page.classification).toBe("SCANNED");
        expect(page.ocrUsed).toBe(true);
        expect(page.rawText.length).toBeGreaterThan(50);
        expect(page.ocrConfidence).toBeGreaterThan(0.85);
      }

      // Verify OCR text reaches question segmentation pipeline and extracts all 5 questions
      const candidates = segmentAndParseQuestions(
        extracted.pages.map((p) => ({
          pageNumber: p.pageNumber,
          text: p.rawText,
          ocrConfidence: p.ocrConfidence,
          warnings: p.warnings
        }))
      );

      expect(candidates.length).toBe(5);

      // Q1: MCQ (Stack / LIFO)
      expect(candidates[0].payload.type).toBe("MCQ");
      expect(tiptapDocToPlainText(candidates[0].payload.question)).toContain("Last-In-First-Out");
      expect(candidates[0].payload.options.length).toBe(4);
      expect(candidates[0].payload.answer.value).toEqual(["B"]);

      // Q2: MCQ (QuickSort)
      expect(candidates[1].payload.type).toBe("MCQ");
      expect(tiptapDocToPlainText(candidates[1].payload.question)).toContain("QuickSort");
      expect(candidates[1].payload.options.length).toBe(4);
      expect(candidates[1].payload.answer.value).toEqual(["C"]);

      // Q3: MSQ (Transport Layer)
      expect(candidates[2].payload.type).toBe("MSQ");
      expect(tiptapDocToPlainText(candidates[2].payload.question)).toContain("Transport Layer");

      // Q4: TRUE_FALSE (HTTPS)
      expect(candidates[3].payload.type).toBe("TRUE_FALSE");
      expect(tiptapDocToPlainText(candidates[3].payload.question)).toContain("HTTPS encrypts");
      expect(candidates[3].payload.answer.value).toEqual(["True"]);

      // Q5: TRUE_FALSE (Java Multiple Inheritance)
      expect(candidates[4].payload.type).toBe("TRUE_FALSE");
      expect(tiptapDocToPlainText(candidates[4].payload.question)).toContain("multiple inheritance");
      expect(candidates[4].payload.answer.value).toEqual(["False"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60000);

  it("10. OCR Failure Handling & Unit Suite: handles status errors, zero detections, network failures, HTTP 500, and valid responses", async () => {
    const errorProvider = new PaddleOCRProvider("http://mock-paddle-endpoint");
    const originalFetch = globalThis.fetch;
    try {
      // 1. Verify PaddleOCRProvider throws on non-"000" status
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ status: "101", msg: "Input data inconsistent" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });

      await expect(
        errorProvider.recognize({ imageBuffer: Buffer.from("dummy"), pageNumber: 1 })
      ).rejects.toThrow("PaddleOCR service error (101): Input data inconsistent");

      // 2. Verify HTTP 200 with zero detections produces a warning and 0 confidence
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ status: "000", results: [[]] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });

      const emptyRes = await errorProvider.recognize({
        imageBuffer: Buffer.from("dummy"),
        pageNumber: 1
      });
      expect(emptyRes.confidence).toBe(0);
      expect(emptyRes.text).toBe("");
      expect(emptyRes.warnings.some((w) => w.includes("PaddleOCR detected zero text blocks"))).toBe(
        true
      );

      // 3. Verify connection failure / network error handling
      globalThis.fetch = async () => {
        throw new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:8866");
      };

      await expect(
        errorProvider.recognize({ imageBuffer: Buffer.from("dummy"), pageNumber: 1 })
      ).rejects.toThrow("fetch failed");

      // 4. Verify HTTP 500 server error response rejection
      globalThis.fetch = async () =>
        new Response("Internal Server Error", { status: 500 });

      await expect(
        errorProvider.recognize({ imageBuffer: Buffer.from("dummy"), pageNumber: 1 })
      ).rejects.toThrow("PaddleOCR HTTP error 500");

      // 5. Verify successful OCR response directly on PaddleOCRProvider
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            status: "000",
            results: [
              [
                {
                  text: "Q1. What is the unit of electric current?",
                  confidence: 0.98,
                  text_region: [[20, 30], [300, 30], [300, 50], [20, 50]]
                },
                {
                  text: "(A) Ampere",
                  confidence: 0.97,
                  text_region: [[30, 60], [150, 60], [150, 80], [30, 80]]
                }
              ]
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const successRes = await errorProvider.recognize({
        imageBuffer: Buffer.from("dummy"),
        pageNumber: 1
      });
      expect(successRes.text).toContain("electric current");
      expect(successRes.text).toContain("Ampere");
      expect(successRes.confidence).toBeGreaterThan(0.95);
      expect(successRes.blocks.length).toBe(2);
      expect(successRes.uncertainBlockCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("11. Rendering failure: scanned page with no readable images or text never passes raw PDF bytes to OCR", async () => {
    // PDF page with empty stream and no image XObjects
    const emptyScannedPdf = buildValidPdfBuffer({
      pages: [{ mode: "SCANNED", digitalText: "", ocrText: "" }]
    });

    let ocrCalled = false;
    const trackerProvider: OCRProvider = {
      name: "TrackerOCR",
      async recognize(input: OCRInput): Promise<OCRResult> {
        ocrCalled = true;
        const isPdf = input.imageBuffer.slice(0, 4).toString("utf8") === "%PDF";
        expect(isPdf).toBe(false);
        return {
          provider: "TrackerOCR",
          pageNumber: input.pageNumber,
          text: "",
          confidence: 0,
          blocks: [],
          uncertainBlockCount: 0,
          warnings: [],
          durationMs: 0
        };
      }
    };

    const trackerService = new ResilientOCRService(trackerProvider);
    const result = await extractPdfDocument(emptyScannedPdf, trackerService);

    // Verify raw PDF bytes were NEVER sent to OCR
    expect(result.pages[0].ocrUsed).toBe(false);
    expect(result.pages[0].warnings.some((w) => w.includes("contains no readable digital text or image content"))).toBe(
      true
    );
    expect(ocrCalled).toBe(false);
  });

  // Opt-in integration test: executes only when explicitly enabled via RUN_LIVE_PADDLE_OCR=true
  const isLiveOcrOptedIn =
    process.env.RUN_LIVE_PADDLE_OCR === "true" ||
    process.env.TEST_LIVE_PADDLE_OCR === "true";

  (isLiveOcrOptedIn ? it : it.skip)(
    "12. (Live Integration) Real PaddleOCR Server: connects to live PaddleOCR endpoint at localhost:8866 and extracts document",
    async () => {
      const fixturePath = path.join(
        process.cwd(),
        "tests",
        "fixtures",
        "digital-assessment-with-answers.pdf"
      );
      expect(fs.existsSync(fixturePath)).toBe(true);
      const pdfBuf = fs.readFileSync(fixturePath);

      const livePaddle = new PaddleOCRProvider();
      const ocrService = new ResilientOCRService(livePaddle);
      const extracted = await extractPdfDocument(pdfBuf, ocrService);

      expect(extracted.detectedFormat).toBe("SCANNED_PDF");
      expect(extracted.totalPages).toBe(2);
      expect(extracted.pages[0].rawText.length).toBeGreaterThan(20);
    },
    60000
  );
});
