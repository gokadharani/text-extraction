import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as createImport } from "@/app/api/imports/route";
import { questionBankRepo, UserDeclaredFormat } from "@/repositories/question-bank.repository";
import {
  buildValidPdfBuffer,
  buildValidDocxBuffer,
  buildValidXlsxBuffer
} from "@/lib/sample-documents";
import { classifyAndExtractDocument } from "@/adapters/documents/document-classifier";
import { serializeImportJob } from "@/lib/api-serializers";

describe("Document Type Selection & Upload Integration", () => {
  beforeEach(async () => {
    await questionBankRepo.resetForTests();
  });

  const samplePdfBuffer = buildValidPdfBuffer({
    pages: [
      {
        mode: "DIGITAL",
        digitalText:
          "Q1. What is the powerhouse of the cell?\n(A) Nucleus\n(B) Mitochondria\n(C) Ribosome\n(D) Golgi\nAnswer: B"
      }
    ]
  });

  it("1. Upload with default format selection (AUTO_DETECT)", async () => {
    const formData = new FormData();
    const fileBlob = new Blob([new Uint8Array(samplePdfBuffer)], { type: "application/pdf" });
    formData.append("file", fileBlob, "bio-exam.pdf");
    formData.append("userDeclaredFormat", "AUTO_DETECT");

    const req = new NextRequest("http://localhost:3000/api/imports", {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" },
      body: formData
    });

    const res = await createImport(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.job).toBeDefined();
    expect(data.job.userDeclaredFormat).toBe("AUTO_DETECT");

    // Verify stored record in repository
    const storedJob = await questionBankRepo.getImportJobById(data.job.id);
    expect(storedJob?.userDeclaredFormat).toBe("AUTO_DETECT");
  });

  it("2. Upload without a format specified defaults to AUTO_DETECT", async () => {
    const formData = new FormData();
    const fileBlob = new Blob([new Uint8Array(samplePdfBuffer)], { type: "application/pdf" });
    formData.append("file", fileBlob, "bio-exam-no-format.pdf");
    // userDeclaredFormat omitted intentionally

    const req = new NextRequest("http://localhost:3000/api/imports", {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" },
      body: formData
    });

    const res = await createImport(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.job.userDeclaredFormat).toBe("AUTO_DETECT");

    const storedJob = await questionBankRepo.getImportJobById(data.job.id);
    expect(storedJob?.userDeclaredFormat).toBe("AUTO_DETECT");
  });

  it("3. Upload with explicit selection of each supported format", async () => {
    const supportedFormats: UserDeclaredFormat[] = [
      "DIGITAL_PDF",
      "SCANNED_PRINTED_PDF",
      "SCANNED_HANDWRITTEN_PDF",
      "DOCX",
      "XLSX",
      "IMAGE"
    ];

    for (const format of supportedFormats) {
      const formData = new FormData();
      const fileBlob = new Blob([new Uint8Array(samplePdfBuffer)], { type: "application/pdf" });
      formData.append("file", fileBlob, `test-${format.toLowerCase()}.pdf`);
      formData.append("userDeclaredFormat", format);

      const req = new NextRequest("http://localhost:3000/api/imports", {
        method: "POST",
        headers: { "x-qbank-client": "web-workspace" },
        body: formData
      });

      const res = await createImport(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.job.userDeclaredFormat).toBe(format);

      const storedJob = await questionBankRepo.getImportJobById(data.job.id);
      expect(storedJob?.userDeclaredFormat).toBe(format);
    }
  });

  it("4. Upload with an invalid format value is rejected with HTTP 422 INVALID_DOCUMENT_TYPE", async () => {
    const formData = new FormData();
    const fileBlob = new Blob([new Uint8Array(samplePdfBuffer)], { type: "application/pdf" });
    formData.append("file", fileBlob, "invalid-format.pdf");
    formData.append("userDeclaredFormat", "INVALID_UNSUPPORTED_TYPE");

    const req = new NextRequest("http://localhost:3000/api/imports", {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" },
      body: formData
    });

    const res = await createImport(req);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe("INVALID_DOCUMENT_TYPE");
    expect(data.error.message).toContain("Invalid user-declared document type");
  });

  it("5. Backend detection remains authoritative: user declares scanned but document is digital", async () => {
    // Digital text PDF with userDeclaredFormat = SCANNED_PRINTED_PDF
    const digitalPdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          digitalText:
            "Q1. Which gas is most abundant in Earth's atmosphere?\n(A) Oxygen\n(B) Nitrogen\n(C) Carbon Dioxide\n(D) Hydrogen\nAnswer: B"
        }
      ]
    });

    const result = await classifyAndExtractDocument(
      digitalPdfBuf,
      "PDF",
      "application/pdf",
      undefined,
      "SCANNED_PRINTED_PDF"
    );

    // Authority retained: digital text extracted without OCR
    expect(result.detectedFormat).toBe("DIGITAL_PDF");
    expect(result.pages[0].ocrUsed).toBe(false);
    expect(result.pages[0].classification).toBe("DIGITAL");
    // Warning attached noting mismatch
    expect(result.pages[0].warnings).toContain(
      "User declared document as scanned, but usable digital text was detected."
    );
  });

  it("6. Backend detection remains authoritative: user declares digital but page lacks selectable text (scanned)", async () => {
    const scannedPdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "SCANNED",
          ocrText: "Q1. Identify the chemical symbol for Gold.\n(A) Au\n(B) Ag\nAnswer: A"
        }
      ]
    });

    const result = await classifyAndExtractDocument(
      scannedPdfBuf,
      "PDF",
      "application/pdf",
      undefined,
      "DIGITAL_PDF"
    );

    // Authority retained: OCR executed because no digital text existed
    expect(result.detectedFormat).toBe("SCANNED_PDF");
    expect(result.pages[0].classification).toBe("SCANNED");
    expect(result.pages[0].ocrUsed).toBe(true);
    expect(result.pages[0].warnings).toContain(
      "User declared document as digital, but page lacks selectable text. Scanned OCR was executed."
    );
  });

  it("7. Handwritten declaration attaches informational warning for review", async () => {
    const scannedPdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "SCANNED",
          ocrText: "Q1. Solve for x: 2x + 5 = 15.\n(A) 5\n(B) 10\nAnswer: A"
        }
      ]
    });

    const result = await classifyAndExtractDocument(
      scannedPdfBuf,
      "PDF",
      "application/pdf",
      undefined,
      "SCANNED_HANDWRITTEN_PDF"
    );

    expect(result.pages[0].warnings).toContain(
      "User declared document as handwritten: standard OCR baseline applied for review."
    );
  });

  it("8. Preserves extraction behavior for DOCX and XLSX with format hints", async () => {
    const docxBuf = buildValidDocxBuffer(
      "Biology Midterm\nQ1. What is osmosis?\nMovement of water across semipermeable membrane."
    );

    const docxResult = await classifyAndExtractDocument(
      docxBuf,
      "DOCX",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      undefined,
      "DOCX"
    );
    expect(docxResult.detectedFormat).toBe("DOCX");
    expect(docxResult.pages[0].rawText).toContain("osmosis");

    const xlsxBuf = await buildValidXlsxBuffer([
      {
        qNo: "1",
        section: "Section A",
        type: "MCQ",
        question: "What is 2 + 2?",
        optA: "3",
        optB: "4",
        optC: "5",
        optD: "6",
        answer: "B",
        explanation: "Simple addition."
      }
    ]);

    const xlsxResult = await classifyAndExtractDocument(
      xlsxBuf,
      "XLSX",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      undefined,
      "XLSX"
    );
    expect(xlsxResult.detectedFormat).toBe("XLSX");
    expect(xlsxResult.pages[0].rawText).toContain("What is 2 + 2?");
  });

  it("9. Serializer safely exposes userDeclaredFormat without leaking storageKey", async () => {
    const job = await questionBankRepo.createImportJob({
      fileName: "sample.pdf",
      originalMimeType: "application/pdf",
      fileSize: 1024,
      fileSha256: "dummy-sha256-hash-for-serialization-test",
      storageKey: "private/storage/secret/key/path.pdf",
      userDeclaredFormat: "DIGITAL_PDF"
    });

    const serialized = serializeImportJob(job);
    expect(serialized.userDeclaredFormat).toBe("DIGITAL_PDF");
    expect((serialized as any).storageKey).toBeUndefined();
    expect((serialized as any).sourceFileId).toBeUndefined();
  });

  it("10. Cross-category format mismatches attach audit warning without altering authoritative extraction routing", async () => {
    // 10a. User selects DOCX, but uploads a PDF
    const docxSelectedPdfUploaded = await classifyAndExtractDocument(
      samplePdfBuffer,
      "PDF",
      "application/pdf",
      undefined,
      "DOCX"
    );
    expect(docxSelectedPdfUploaded.detectedFormat).toBe("DIGITAL_PDF");
    expect(docxSelectedPdfUploaded.pages[0].warnings).toContain(
      "User declared document format as DOCX, but actual validated file type is DIGITAL_PDF (PDF). Extracted using authoritative DIGITAL_PDF pipeline."
    );
    expect(docxSelectedPdfUploaded.pages[0].rawText).toContain("powerhouse of the cell");

    // 10b. User selects IMAGE, but uploads a PDF
    const imageSelectedPdfUploaded = await classifyAndExtractDocument(
      samplePdfBuffer,
      "PDF",
      "application/pdf",
      undefined,
      "IMAGE"
    );
    expect(imageSelectedPdfUploaded.detectedFormat).toBe("DIGITAL_PDF");
    expect(imageSelectedPdfUploaded.pages[0].warnings).toContain(
      "User declared document format as IMAGE, but actual validated file type is DIGITAL_PDF (PDF). Extracted using authoritative DIGITAL_PDF pipeline."
    );

    // 10c. User selects XLSX, but uploads a DOCX
    const docxBuf = buildValidDocxBuffer("Literature Quiz\nQ1. Who wrote Hamlet?\nWilliam Shakespeare.");
    const xlsxSelectedDocxUploaded = await classifyAndExtractDocument(
      docxBuf,
      "DOCX",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      undefined,
      "XLSX"
    );
    expect(xlsxSelectedDocxUploaded.detectedFormat).toBe("DOCX");
    expect(xlsxSelectedDocxUploaded.pages[0].warnings).toContain(
      "User declared document format as XLSX, but actual validated file type is DOCX (DOCX). Extracted using authoritative DOCX pipeline."
    );
    expect(xlsxSelectedDocxUploaded.pages[0].rawText).toContain("Hamlet");
  });

  it("11. Handwritten declaration propagates review warning and sets question reviewStatus to NEEDS_ATTENTION", async () => {
    const scannedPdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "SCANNED",
          ocrText: "Q1. Find the derivative of f(x) = x^2.\n(A) 2x\n(B) x\nAnswer: A"
        }
      ]
    });

    const extraction = await classifyAndExtractDocument(
      scannedPdfBuf,
      "PDF",
      "application/pdf",
      undefined,
      "SCANNED_HANDWRITTEN_PDF"
    );

    expect(extraction.pages[0].warnings).toContain(
      "User declared document as handwritten: standard OCR baseline applied for review."
    );

    // Verify questions segmented from this page inherit the warning and reviewStatus
    const { segmentAndParseQuestions } = await import("@/domain/extraction/question-segmenter");
    const candidates = segmentAndParseQuestions([
      {
        pageNumber: 1,
        text: extraction.pages[0].rawText,
        ocrConfidence: extraction.pages[0].ocrConfidence,
        warnings: extraction.pages[0].warnings
      }
    ]);

    expect(candidates.length).toBe(1);
    expect(candidates[0].payload.warnings).toContain(
      "User declared document as handwritten: standard OCR baseline applied for review."
    );
    // Because warnings exist, status is escalated to NEEDS_ATTENTION for review
    expect(candidates[0].payload.reviewStatus).toBe("NEEDS_ATTENTION");
  });

  it("12. Auto Detect preserves existing behavior without attaching spurious format mismatch warnings", async () => {
    const autoPdfResult = await classifyAndExtractDocument(
      samplePdfBuffer,
      "PDF",
      "application/pdf",
      undefined,
      "AUTO_DETECT"
    );
    expect(autoPdfResult.detectedFormat).toBe("DIGITAL_PDF");
    expect(autoPdfResult.pages[0].warnings).toEqual([]);

    const docxBuf = buildValidDocxBuffer("Standard DOCX\nQ1. Test question?\nAnswer");
    const autoDocxResult = await classifyAndExtractDocument(
      docxBuf,
      "DOCX",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      undefined,
      "AUTO_DETECT"
    );
    expect(autoDocxResult.detectedFormat).toBe("DOCX");
    expect(autoDocxResult.pages[0].warnings).toEqual([]);
  });

  it("13. Handwritten warning visibility: review data passed to UI includes warning and NEEDS_ATTENTION status", async () => {
    const job = await questionBankRepo.createImportJob({
      fileName: "handwritten-math.pdf",
      originalMimeType: "application/pdf",
      fileSize: 2048,
      fileSha256: "sha256-hw-test-123",
      storageKey: "uploads/hw-test.pdf",
      userDeclaredFormat: "SCANNED_HANDWRITTEN_PDF"
    });

    const handwrittenWarning =
      "User declared document as handwritten: standard OCR baseline applied for review.";

    await questionBankRepo.saveStagingQuestionsTransactional(job.id, [
      {
        question: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Solve 3x = 9" }] }] },
        options: [
          { id: "A", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "3" }] }] } },
          { id: "B", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "6" }] }] } }
        ],
        answer: { type: "mcq", value: ["A"], status: "extracted" },
        explanation: null,
        type: "MCQ",
        sourceFileId: job.id,
        sourcePage: 1,
        sourcePageEnd: 1,
        sourceQuestionNumber: "1",
        sourceSection: null,
        sourceOrder: 1,
        confidence: 0.85,
        answerProvenance: "EXPLICIT_SOURCE",
        reviewStatus: "NEEDS_ATTENTION",
        sharedPassage: null,
        boundingBox: null,
        warnings: [handwrittenWarning],
        aiRepaired: false,
        aiRepairModel: null,
        aiRepairReason: null,
        contentHash: "hash-hw-1",
        isDuplicate: false,
        duplicateOfId: null
      }
    ]);

    // Query API endpoints consumed by review workspace UI
    const { GET: getJobDetails } = await import("@/app/api/imports/[id]/route");
    const { GET: getQuestions } = await import("@/app/api/imports/[id]/questions/route");

    const jobReq = new NextRequest(`http://localhost:3000/api/imports/${job.id}`, {
      headers: { "x-qbank-client": "web-workspace" }
    });
    const jobRes = await getJobDetails(jobReq, { params: { id: job.id } });
    expect(jobRes.status).toBe(200);
    const jobData = await jobRes.json();
    expect(jobData.job.userDeclaredFormat).toBe("SCANNED_HANDWRITTEN_PDF");

    const qReq = new NextRequest(`http://localhost:3000/api/imports/${job.id}/questions`, {
      headers: { "x-qbank-client": "web-workspace" }
    });
    const qRes = await getQuestions(qReq, { params: { id: job.id } });
    expect(qRes.status).toBe(200);
    const qData = await qRes.json();

    expect(qData.questions.length).toBe(1);
    expect(qData.questions[0].reviewStatus).toBe("NEEDS_ATTENTION");
    expect(qData.questions[0].warnings).toContain(handwrittenWarning);
  });

  it("14. Format mismatch end-to-end: upload succeeds without rejection, preserves extraction, and attaches non-duplicate warning", async () => {
    // DOCX declared, but PDF uploaded
    const formData = new FormData();
    const fileBlob = new Blob([new Uint8Array(samplePdfBuffer)], { type: "application/pdf" });
    formData.append("file", fileBlob, "exam-paper.pdf");
    formData.append("userDeclaredFormat", "DOCX");

    const req = new NextRequest("http://localhost:3000/api/imports", {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" },
      body: formData
    });

    const res = await createImport(req);
    expect(res.status).toBe(201); // Not rejected
    const data = await res.json();
    expect(data.job.userDeclaredFormat).toBe("DOCX");

    // Extraction routing remains authoritative based on binary validation (PDF -> DIGITAL_PDF)
    const extraction = await classifyAndExtractDocument(
      samplePdfBuffer,
      "PDF",
      "application/pdf",
      undefined,
      data.job.userDeclaredFormat
    );

    expect(extraction.detectedFormat).toBe("DIGITAL_PDF");
    const expectedWarning =
      "User declared document format as DOCX, but actual validated file type is DIGITAL_PDF (PDF). Extracted using authoritative DIGITAL_PDF pipeline.";
    expect(extraction.pages[0].warnings).toContain(expectedWarning);
    // Verify no duplicates
    const occurrences = extraction.pages[0].warnings.filter((w) => w === expectedWarning);
    expect(occurrences.length).toBe(1);
  });
});

