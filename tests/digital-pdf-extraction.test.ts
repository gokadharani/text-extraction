import { describe, it, expect, beforeEach } from "vitest";
import {
  buildValidPdfBuffer,
  SamplePdfPageOptions
} from "@/lib/sample-documents";
import { classifyAndExtractDocument } from "@/adapters/documents/document-classifier";
import {
  assemblePdfTextItems,
  extractPdfDocument,
  PdfTextItemWithCoords
} from "@/adapters/documents/pdf-extractor";
import { segmentAndParseQuestions } from "@/domain/extraction/question-segmenter";
import { tiptapDocToPlainText } from "@/domain/richtext/tiptap-converter";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { ResilientOCRService } from "@/adapters/ocr/ocr-provider";

describe("Milestone 2 Phase 1: Digital PDF Extraction Accuracy & Multi-Column Layouts", () => {
  beforeEach(async () => {
    await questionBankRepo.resetForTests();
  });

  it("1. Two-column reading order: reads left column top-to-bottom before right column", async () => {
    const pdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          twoColumnContent: {
            leftLines: [
              "Q1. What is the fundamental unit of electric charge?",
              "(A) Coulomb",
              "(B) Ampere",
              "(C) Volt",
              "Answer: A"
            ],
            rightLines: [
              "Q2. Which law relates voltage, current, and resistance?",
              "(A) Ohm's Law",
              "(B) Newton's Law",
              "(C) Faraday's Law",
              "Answer: A"
            ]
          }
        }
      ]
    });

    const extracted = await classifyAndExtractDocument(
      pdfBuf,
      "PDF",
      "application/pdf"
    );

    expect(extracted.detectedFormat).toBe("DIGITAL_PDF");
    expect(extracted.pages[0].classification).toBe("DIGITAL");
    expect(extracted.pages[0].ocrUsed).toBe(false);

    const rawText = extracted.pages[0].rawText;

    // Q1 content should precede Q2 content in reading order
    const q1Index = rawText.indexOf("fundamental unit of");
    const q1OptAIndex = rawText.indexOf("(A) Coulomb");
    const q2Index = rawText.indexOf("relates voltage, current");
    const q2OptAIndex = rawText.indexOf("Ohm");

    expect(q1Index).toBeGreaterThanOrEqual(0);
    expect(q1OptAIndex).toBeGreaterThan(q1Index);
    expect(q2Index).toBeGreaterThan(q1OptAIndex);
    expect(q2OptAIndex).toBeGreaterThan(q2Index);

    // Parsing through question segmenter must successfully produce Q1 then Q2
    const candidates = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(candidates.length).toBe(2);
    expect(candidates[0].payload.sourceOrder).toBe(1);
    expect(candidates[0].payload.options.map((o) => tiptapDocToPlainText(o.content))).toEqual([
      "Coulomb",
      "Ampere",
      "Volt"
    ]);
    expect(candidates[0].payload.answer.value).toEqual(["A"]);

    expect(candidates[1].payload.sourceOrder).toBe(2);
    expect(
      candidates[1].payload.options.map((o) =>
        tiptapDocToPlainText(o.content).replace(/’/g, "'")
      )
    ).toEqual(["Ohm's Law", "Newton's Law", "Faraday's Law"]);
    expect(candidates[1].payload.answer.value).toEqual(["A"]);
  });

  it("2. Full-width headings with two-column content: partitions page into vertical bands", async () => {
    const pdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          twoColumnContent: {
            header: "FINAL EXAMINATION - COMPUTER SCIENCE AND NETWORKING",
            leftLines: [
              "Q1. Which layer of the OSI model does IP operate at?",
              "(A) Network Layer",
              "(B) Transport Layer",
              "Answer: A"
            ],
            rightLines: [
              "Q2. What is the standard port for HTTPS?",
              "(A) 443",
              "(B) 80",
              "Answer: A"
            ],
            middleHeader: "SECTION B - ADVANCED ARCHITECTURE AND CONCURRENCY",
            leftAfterMiddle: [
              "Q3. In distributed systems, what does the CAP theorem state?",
              "(A) Consistency, Availability, Partition tolerance",
              "(B) Concurrency, Atomicity, Persistence",
              "Answer: A"
            ],
            rightAfterMiddle: [
              "Q4. What synchronization primitive prevents race conditions?",
              "(A) Mutex",
              "(B) Semaphore",
              "Answer: A"
            ]
          }
        }
      ]
    });

    const extracted = await classifyAndExtractDocument(
      pdfBuf,
      "PDF",
      "application/pdf"
    );

    const rawText = extracted.pages[0].rawText;

    const topHeaderIdx = rawText.indexOf("FINAL EXAMINATION");
    const q1Idx = rawText.indexOf("Which layer of the OSI model");
    const q2Idx = rawText.indexOf("standard port for HTTPS");
    const middleHeaderIdx = rawText.indexOf("SECTION B");
    const q3Idx = rawText.indexOf("CAP theorem state");
    const q4Idx = rawText.indexOf("synchronization primitive");

    expect(topHeaderIdx).toBe(0);
    expect(q1Idx).toBeGreaterThan(topHeaderIdx);
    expect(q2Idx).toBeGreaterThan(q1Idx);
    expect(middleHeaderIdx).toBeGreaterThan(q2Idx);
    expect(q3Idx).toBeGreaterThan(middleHeaderIdx);
    expect(q4Idx).toBeGreaterThan(q3Idx);

    const candidates = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(candidates.length).toBe(4);
    expect(candidates[2].payload.sourceSection?.toUpperCase()).toContain("SECTION B");
  });

  it("3. Question and option text spanning multiple lines in two columns", async () => {
    const pdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          twoColumnContent: {
            leftLines: [
              "Q1. Consider an ideal heat engine operating between",
              "a high temperature reservoir T1 and low temperature T2.",
              "(A) The theoretical maximum thermal efficiency",
              "is governed solely by Carnot's theorem.",
              "(B) Thermal efficiency can reach 100% at room temperature.",
              "Answer: A"
            ],
            rightLines: [
              "Q2. In a series resonant RLC circuit excited by an AC source,",
              "the impedance of the circuit is purely resistive at resonance.",
              "(A) True",
              "(B) False",
              "Answer: True"
            ]
          }
        }
      ]
    });

    const extracted = await classifyAndExtractDocument(
      pdfBuf,
      "PDF",
      "application/pdf"
    );

    const rawText = extracted.pages[0].rawText;

    // Both lines of Q1 stem must stay together before Q1 option (A)
    const q1Stem1 = rawText.indexOf("Consider an ideal heat engine");
    const q1Stem2 = rawText.indexOf("high temperature reservoir T1");
    const q1OptA1 = rawText.indexOf("theoretical maximum");
    const q1OptA2 = rawText.indexOf("Carnot");

    expect(q1Stem1).toBeGreaterThanOrEqual(0);
    expect(q1Stem2).toBeGreaterThan(q1Stem1);
    expect(q1OptA1).toBeGreaterThan(q1Stem2);
    expect(q1OptA2).toBeGreaterThan(q1OptA1);

    // Q2 must not be interleaved into Q1's wrapped stem or options
    const q2Stem1 = rawText.indexOf("In a series resonant RLC circuit");
    expect(q2Stem1).toBeGreaterThan(q1OptA2);

    const candidates2 = segmentAndParseQuestions([{ pageNumber: 1, text: rawText }]);
    expect(candidates2.length).toBe(2);
    expect(tiptapDocToPlainText(candidates2[0].payload.options[0].content)).toContain("Carnot");
    expect(candidates2[1].payload.type).toBe("TRUE_FALSE");
  });

  it("4. Single-column PDF reading order: preserves normal sequential top-to-bottom order", async () => {
    const pdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          digitalText: [
            "STANDARD EXAMINATION - SINGLE COLUMN",
            "Q1. Which gas is most abundant in the Earth's atmosphere?",
            "(A) Nitrogen",
            "(B) Oxygen",
            "(C) Carbon Dioxide",
            "(D) Argon",
            "Answer: A",
            "Q2. What is the chemical symbol for gold?",
            "(A) Au",
            "(B) Ag",
            "(C) Fe",
            "(D) Cu",
            "Answer: A"
          ].join("\n")
        }
      ]
    });

    const extracted = await classifyAndExtractDocument(
      pdfBuf,
      "PDF",
      "application/pdf"
    );

    expect(extracted.detectedFormat).toBe("DIGITAL_PDF");
    const lines = extracted.pages[0].rawText.split("\n");

    expect(lines[0]).toBe("STANDARD EXAMINATION - SINGLE COLUMN");
    expect(lines[1]).toContain("Which gas is most abundant");
    expect(lines[2]).toBe("(A) Nitrogen");
    expect(lines[7]).toContain("chemical symbol for gold");
    expect(lines[8]).toBe("(A) Au");
  });

  it("5. Real PDF text-item assembly path: exercises PDF.js font stream without synthetic comment fallback", async () => {
    // Construct a PDF without %DIGITAL_TEXT_START% comments to guarantee PDF.js executes directly
    const rawPdfWithoutComments = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          digitalText: "Q1. Pure font stream question without comments?\n(A) Alpha\n(B) Beta\nAnswer: A"
        }
      ]
    });

    // Strip out any accidental %DIGITAL_TEXT_START% comment lines from the binary
    const sanitizedBuffer = Buffer.from(
      rawPdfWithoutComments.toString("latin1").replace(/%DIGITAL_TEXT_START%[\s\S]*?%DIGITAL_TEXT_END%/g, ""),
      "latin1"
    );

    const mockOcr = new ResilientOCRService({
      name: "MockOCR",
      recognize: async () => {
        throw new Error("OCR should NOT be called on purely digital PDFs!");
      }
    });

    const result = await extractPdfDocument(sanitizedBuffer, mockOcr);

    expect(result.detectedFormat).toBe("DIGITAL_PDF");
    expect(result.pages[0].ocrUsed).toBe(false);
    expect(result.pages[0].rawText).toContain("Pure font stream question");
    expect(result.pages[0].rawText).toContain("(A) Alpha");
    expect(result.pages[0].boundingBoxes.length).toBeGreaterThan(0);
  });

  it("6. Unit: assemblePdfTextItems detects 2-column gutter and assigns discrete OCR bounding boxes", () => {
    const items: PdfTextItemWithCoords[] = [
      { str: "TITLE", x: 50, y: 30, width: 350, height: 12 },
      { str: "Left 1", x: 50, y: 60, width: 80, height: 12 },
      { str: "Left 2", x: 50, y: 80, width: 80, height: 12 },
      { str: "Left 3", x: 50, y: 100, width: 80, height: 12 },
      { str: "Right 1", x: 320, y: 60, width: 80, height: 12 },
      { str: "Right 2", x: 320, y: 80, width: 80, height: 12 },
      { str: "Right 3", x: 320, y: 100, width: 80, height: 12 }
    ];

    const assembled = assemblePdfTextItems(items);
    const lines = assembled.text.split("\n");

    expect(lines).toEqual(["TITLE", "Left 1", "Left 2", "Left 3", "Right 1", "Right 2", "Right 3"]);

    // Verify bounding boxes for Left 1 and Right 1 are distinct and do not span across the whole page
    const leftBlock = assembled.blocks.find((b) => b.text === "Left 1");
    const rightBlock = assembled.blocks.find((b) => b.text === "Right 1");

    expect(leftBlock).toBeDefined();
    expect(rightBlock).toBeDefined();
    expect(leftBlock!.boundingBox.x).toBe(50);
    expect(leftBlock!.boundingBox.width).toBeLessThan(150);
    expect(rightBlock!.boundingBox.x).toBe(320);
    expect(rightBlock!.boundingBox.width).toBeLessThan(150);
  });

  it("7. Unit: assemblePdfTextItems safely falls back to single-column when layout is ambiguous or narrow", () => {
    // Narrow content: width < 200
    const narrowItems: PdfTextItemWithCoords[] = [
      { str: "Narrow 1", x: 50, y: 40, width: 100, height: 12 },
      { str: "Narrow 2", x: 50, y: 60, width: 100, height: 12 },
      { str: "Narrow 3", x: 50, y: 80, width: 100, height: 12 }
    ];

    const narrowResult = assemblePdfTextItems(narrowItems);
    expect(narrowResult.text).toBe("Narrow 1\nNarrow 2\nNarrow 3");

    // Single-column sentences spanning across the center
    const wideSingleColumnItems: PdfTextItemWithCoords[] = [
      { str: "Sentence one spanning across the entire page width", x: 50, y: 40, width: 450, height: 12 },
      { str: "Sentence two also spanning across the entire page width", x: 50, y: 60, width: 440, height: 12 },
      { str: "Sentence three also spanning across the page", x: 50, y: 80, width: 430, height: 12 },
      { str: "Sentence four also spanning across the page", x: 50, y: 100, width: 420, height: 12 }
    ];

    const singleResult = assemblePdfTextItems(wideSingleColumnItems);
    expect(singleResult.text.split("\n").length).toBe(4);
    expect(singleResult.text).toContain("Sentence one");
    expect(singleResult.text).toContain("Sentence four");
  });

  describe("Milestone 2 Phase 2: Digital PDF Question Parsing and Text Quality", () => {
    it("8. BUG-DPDF-03: Standalone question numbers on isolated lines attach to stems on the next line", () => {
      const pageText = [
        "1.",
        "What is the primary function of an operating system?",
        "(A) Resource management",
        "(B) Power generation",
        "(C) Physical cooling",
        "(D) Network cabling",
        "Answer: A",
        "",
        "2.",
        "Which protocol provides secure encrypted web communication?",
        "(A) HTTP",
        "(B) HTTPS",
        "(C) FTP",
        "(D) Telnet",
        "Answer: B"
      ].join("\n");

      const candidates = segmentAndParseQuestions([{ pageNumber: 1, text: pageText }]);
      expect(candidates.length).toBe(2);

      // Question 1
      expect(candidates[0].payload.sourceQuestionNumber).toBe("1");
      const q1Text = tiptapDocToPlainText(candidates[0].payload.question);
      expect(q1Text).toContain("What is the primary function of an operating system?");
      expect(candidates[0].payload.options.length).toBe(4);
      expect(candidates[0].payload.answer.value).toEqual(["A"]);
      expect(candidates[0].payload.type).toBe("MCQ");

      // Question 2
      expect(candidates[1].payload.sourceQuestionNumber).toBe("2");
      const q2Text = tiptapDocToPlainText(candidates[1].payload.question);
      expect(q2Text).toContain("Which protocol provides secure encrypted web communication?");
      expect(candidates[1].payload.options.length).toBe(4);
      expect(candidates[1].payload.answer.value).toEqual(["B"]);
      expect(candidates[1].payload.type).toBe("MCQ");
    });

    it("9. BUG-DPDF-03: Numbered options (1), (2), (3), (4) are parsed as options and not confused with question numbers", () => {
      const text = [
        "1.",
        "Which of the following is a non-renewable source of energy?",
        "(1) Solar energy",
        "(2) Wind energy",
        "(3) Coal",
        "(4) Tidal energy",
        "Answer: 3",
        "",
        "2.",
        "Select the primary colors in additive color mixing:",
        "[1] Red, Green, Blue",
        "[2] Red, Yellow, Blue",
        "[3] Cyan, Magenta, Yellow",
        "[4] Orange, Purple, Green",
        "Answer: 1"
      ].join("\n");

      const candidates = segmentAndParseQuestions([{ pageNumber: 1, text }]);
      expect(candidates.length).toBe(2);

      // Question 1
      expect(candidates[0].payload.sourceQuestionNumber).toBe("1");
      expect(tiptapDocToPlainText(candidates[0].payload.question)).toContain("non-renewable source");
      expect(candidates[0].payload.options.map((o) => o.id)).toEqual(["1", "2", "3", "4"]);
      expect(candidates[0].payload.options.map((o) => tiptapDocToPlainText(o.content))).toEqual([
        "Solar energy",
        "Wind energy",
        "Coal",
        "Tidal energy"
      ]);
      expect(candidates[0].payload.answer.value).toEqual(["3"]);
      expect(candidates[0].payload.type).toBe("MCQ");

      // Question 2
      expect(candidates[1].payload.sourceQuestionNumber).toBe("2");
      expect(candidates[1].payload.options.map((o) => o.id)).toEqual(["1", "2", "3", "4"]);
      expect(candidates[1].payload.options[0].id).toBe("1");
      expect(tiptapDocToPlainText(candidates[1].payload.options[0].content)).toBe("Red, Green, Blue");
      expect(candidates[1].payload.answer.value).toEqual(["1"]);
      expect(candidates[1].payload.type).toBe("MCQ");
    });

    it("10. BUG-DPDF-04: Repeated page section headers across pages do not prematurely flush multi-page questions", () => {
      const pages = [
        {
          pageNumber: 1,
          text: [
            "SECTION A: BIOLOGY",
            "1. Explain the mechanism of photosynthesis and describe the light reactions in detail:",
            "(A) Photosystem I absorbs light at 700 nm"
          ].join("\n")
        },
        {
          pageNumber: 2,
          text: [
            "SECTION A: BIOLOGY",
            "(B) Photosystem II absorbs light at 680 nm",
            "(C) ATP is synthesized via photophosphorylation",
            "(D) Carbon dioxide is fixed into sugars in the stroma",
            "Answer: A"
          ].join("\n")
        }
      ];

      const candidates = segmentAndParseQuestions(pages);
      expect(candidates.length).toBe(1);

      const q = candidates[0].payload;
      expect(q.sourceQuestionNumber).toBe("1");
      expect(q.sourceSection).toBe("Section A: BIOLOGY");
      expect(q.sourcePage).toBe(1);
      expect(q.sourcePageEnd).toBe(2);
      expect(q.options.length).toBe(4);
      expect(q.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
      expect(q.answer.value).toEqual(["A"]);
      expect(q.type).toBe("MCQ");
    });

    it("11. BUG-DPDF-04: Legitimate section heading transitions are retained and flush previous sections", () => {
      const pages = [
        {
          pageNumber: 1,
          text: [
            "SECTION A: COMPUTER SCIENCE",
            "1. What is an IP address?",
            "(A) Logical network identifier",
            "(B) Hardware physical address",
            "Answer: A"
          ].join("\n")
        },
        {
          pageNumber: 2,
          text: [
            "SECTION B: MATHEMATICS",
            "2. What is the derivative of sin(x)?",
            "(A) cos(x)",
            "(B) -cos(x)",
            "Answer: A"
          ].join("\n")
        }
      ];

      const candidates = segmentAndParseQuestions(pages);
      expect(candidates.length).toBe(2);

      expect(candidates[0].payload.sourceQuestionNumber).toBe("1");
      expect(candidates[0].payload.sourceSection).toBe("Section A: COMPUTER SCIENCE");
      expect(candidates[0].payload.sourcePage).toBe(1);

      expect(candidates[1].payload.sourceQuestionNumber).toBe("2");
      expect(candidates[1].payload.sourceSection).toBe("Section B: MATHEMATICS");
      expect(candidates[1].payload.sourcePage).toBe(2);
    });

    it("12. BUG-DPDF-04: Pagination footers are filtered out and do not pollute stems or options", () => {
      const pages = [
        {
          pageNumber: 1,
          text: [
            "1. What is the law of conservation of energy?",
            "Energy cannot be created or destroyed, only transformed from one form to another.",
            "Page 1 of 3",
            "- 1 -"
          ].join("\n")
        },
        {
          pageNumber: 2,
          text: [
            "(A) First Law of Thermodynamics",
            "(B) Second Law of Thermodynamics",
            "Answer: A",
            "Page 2 of 3"
          ].join("\n")
        }
      ];

      const candidates = segmentAndParseQuestions(pages);
      expect(candidates.length).toBe(1);

      const stemText = tiptapDocToPlainText(candidates[0].payload.question);
      expect(stemText).toContain("Energy cannot be created or destroyed");
      expect(stemText).not.toContain("Page 1 of 3");
      expect(stemText).not.toContain("- 1 -");

      const optText = candidates[0].payload.options.map((o) => tiptapDocToPlainText(o.content)).join(" ");
      expect(optText).not.toContain("Page 2 of 3");
    });

    it("13. BUG-DPDF-05: Unit: assemblePdfTextItems does not insert spaces between kerned adjacent text fragments", () => {
      const items: PdfTextItemWithCoords[] = [
        // "photosynthesis" split into two kerned fragments with gap = 0
        { str: "photo", x: 50, y: 100, width: 30, height: 12 },
        { str: "synthesis", x: 80, y: 100, width: 50, height: 12 },
        // "international" split into two fragments with gap = 0.5 (< 2.0)
        { str: "inter", x: 50, y: 120, width: 28, height: 12 },
        { str: "national", x: 78.5, y: 120, width: 45, height: 12 }
      ];

      const assembled = assemblePdfTextItems(items);
      const lines = assembled.text.split("\n");

      expect(lines[0]).toBe("photosynthesis");
      expect(lines[0]).not.toContain("photo synthesis");

      expect(lines[1]).toBe("international");
      expect(lines[1]).not.toContain("inter national");
    });

    it("14. BUG-DPDF-05: Unit: assemblePdfTextItems preserves real spaces between separate words and punctuation", () => {
      const items: PdfTextItemWithCoords[] = [
        // "What is an operating system?" with normal word spaces (gap >= 3.0)
        { str: "What", x: 50, y: 100, width: 28, height: 12 },
        { str: "is", x: 83, y: 100, width: 12, height: 12 },
        { str: "an", x: 100, y: 100, width: 14, height: 12 },
        { str: "operating", x: 119, y: 100, width: 55, height: 12 },
        { str: "system", x: 179, y: 100, width: 42, height: 12 },
        { str: "?", x: 221.5, y: 100, width: 6, height: 12 }
      ];

      const assembled = assemblePdfTextItems(items);
      expect(assembled.text).toBe("What is an operating system?");
    });

    it("15. BUG-DPDF-05: Mathematical formulas and expressions preserve spaces around operators", () => {
      const items: PdfTextItemWithCoords[] = [
        { str: "f(x)", x: 50, y: 100, width: 22, height: 12 },
        { str: "=", x: 77, y: 100, width: 8, height: 12 },
        { str: "x^2", x: 90, y: 100, width: 20, height: 12 },
        { str: "+", x: 115, y: 100, width: 8, height: 12 },
        { str: "2x", x: 128, y: 100, width: 14, height: 12 }
      ];

      const assembled = assemblePdfTextItems(items);
      expect(assembled.text).toBe("f(x) = x^2 + 2x");
    });

    it("16. Full Integration: Digital PDF with standalone numbers, numbered options, repeated headers, and footers", async () => {
      const pdfBuf = buildValidPdfBuffer({
        pages: [
          {
            mode: "DIGITAL",
            digitalText: [
              "SECTION A: SCIENCE",
              "1.",
              "Which organelle is responsible for cellular respiration?",
              "(1) Chloroplast",
              "(2) Mitochondria",
              "Page 1 of 2"
            ].join("\n")
          },
          {
            mode: "DIGITAL",
            digitalText: [
              "SECTION A: SCIENCE",
              "(3) Ribosome",
              "(4) Endoplasmic Reticulum",
              "Answer: 2",
              "Page 2 of 2"
            ].join("\n")
          }
        ]
      });

      const extracted = await classifyAndExtractDocument(
        pdfBuf,
        "PDF",
        "application/pdf"
      );

      expect(extracted.detectedFormat).toBe("DIGITAL_PDF");
      expect(extracted.totalPages).toBe(2);
      expect(extracted.pages[0].ocrUsed).toBe(false);
      expect(extracted.pages[1].ocrUsed).toBe(false);

      const candidates = segmentAndParseQuestions(
        extracted.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.rawText }))
      );

      expect(candidates.length).toBe(1);
      const q = candidates[0].payload;
      expect(q.sourceQuestionNumber).toBe("1");
      expect(q.sourceSection).toBe("Section A: SCIENCE");
      expect(q.sourcePage).toBe(1);
      expect(q.sourcePageEnd).toBe(2);
      expect(tiptapDocToPlainText(q.question)).toContain("cellular respiration");
      expect(tiptapDocToPlainText(q.question)).not.toContain("Page 1 of 2");

      expect(q.options.map((o) => o.id)).toEqual(["1", "2", "3", "4"]);
      expect(q.options.map((o) => tiptapDocToPlainText(o.content))).toEqual([
        "Chloroplast",
        "Mitochondria",
        "Ribosome",
        "Endoplasmic Reticulum"
      ]);
      expect(q.answer.value).toEqual(["2"]);
      expect(q.type).toBe("MCQ");
    });
  });
});
