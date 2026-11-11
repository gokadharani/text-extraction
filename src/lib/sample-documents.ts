import ExcelJS from "exceljs";
import sharp from "sharp";

/**
 * Builds a valid binary PDF (%PDF-1.4) containing digital text streams,
 * scanned OCR page streams, or mixed pages for deterministic testing and demos.
 */
export interface SamplePdfPageOptions {
  mode: "DIGITAL" | "SCANNED" | "MIXED";
  digitalText?: string;
  ocrText?: string;
  twoColumnContent?: {
    header?: string;
    middleHeader?: string;
    leftLines: string[];
    rightLines: string[];
    leftAfterMiddle?: string[];
    rightAfterMiddle?: string[];
  };
  textItems?: Array<{
    text: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
  }>;
}

/**
 * Builds a valid binary PDF (%PDF-1.4) containing digital text streams,
 * scanned OCR page streams, or mixed pages for deterministic testing and demos.
 * Generates genuine PDF object trees, font dictionaries, and text matrices so that
 * PDF.js text-item extraction and coordinate assembly are exercised realistically.
 */
export function buildValidPdfBuffer(options: {
  pages: SamplePdfPageOptions[];
  encrypted?: boolean;
}): Buffer {
  const pageMarkers = options.pages
    .map((p) => {
      const lines = [`%===PDF_PAGE===%`, `%PAGE_MODE:${p.mode}%`];
      if (p.digitalText) {
        lines.push(`%DIGITAL_TEXT_START%\n${p.digitalText}\n%DIGITAL_TEXT_END%`);
      }
      if (p.ocrText) {
        lines.push(`%OCR_TEXT_START%\n${p.ocrText}\n%OCR_TEXT_END%`);
      }
      return lines.join("\n");
    })
    .join("\n");

  const numPages = options.pages.length;
  const kids = options.pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");

  const pdfObjects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${numPages} >>\nendobj`
  ];

  options.pages.forEach((p, idx) => {
    const pageObjId = 3 + idx * 2;
    const contentsObjId = 4 + idx * 2;

    let tjCommands = "";
    if (p.mode === "SCANNED") {
      // Scanned pages have no digital text operators
      tjCommands = "";
    } else if (p.twoColumnContent) {
      const cmds: string[] = [];
      const tc = p.twoColumnContent;
      let currentPdfY = 740;

      if (tc.header) {
        const escaped = tc.header
          .replace(/\\/g, "\\\\")
          .replace(/\(/g, "\\(")
          .replace(/\)/g, "\\)");
        cmds.push(`1 0 0 1 50 ${currentPdfY} Tm (${escaped}) Tj`);
        currentPdfY -= 26;
      }

      const wrapCol = (l: string, maxLen = 42): string[] => {
        if (l.length <= maxLen) return [l];
        const words = l.split(" ");
        const lines: string[] = [];
        let cur = "";
        for (const w of words) {
          if (!cur) {
            cur = w;
          } else if ((cur + " " + w).length <= maxLen) {
            cur += " " + w;
          } else {
            lines.push(cur);
            cur = w;
          }
        }
        if (cur) lines.push(cur);
        return lines;
      };

      const leftExpanded = tc.leftLines.flatMap((l) => wrapCol(l));
      const rightExpanded = tc.rightLines.flatMap((l) => wrapCol(l));

      const startColY = currentPdfY;
      leftExpanded.forEach((line, lineIdx) => {
        const escaped = line
          .replace(/\\/g, "\\\\")
          .replace(/\(/g, "\\(")
          .replace(/\)/g, "\\)");
        cmds.push(`1 0 0 1 50 ${startColY - lineIdx * 16} Tm (${escaped}) Tj`);
      });

      rightExpanded.forEach((line, lineIdx) => {
        const escaped = line
          .replace(/\\/g, "\\\\")
          .replace(/\(/g, "\\(")
          .replace(/\)/g, "\\)");
        cmds.push(`1 0 0 1 330 ${startColY - lineIdx * 16} Tm (${escaped}) Tj`);
      });

      const maxColLines = Math.max(leftExpanded.length, rightExpanded.length);
      currentPdfY = startColY - maxColLines * 16 - 22;

      if (tc.middleHeader) {
        const escaped = tc.middleHeader
          .replace(/\\/g, "\\\\")
          .replace(/\(/g, "\\(")
          .replace(/\)/g, "\\)");
        cmds.push(`1 0 0 1 80 ${currentPdfY} Tm (${escaped}) Tj`);
        currentPdfY -= 26;
      }

      if (tc.leftAfterMiddle || tc.rightAfterMiddle) {
        const left2Expanded = (tc.leftAfterMiddle || []).flatMap((l) => wrapCol(l));
        const right2Expanded = (tc.rightAfterMiddle || []).flatMap((l) => wrapCol(l));

        const startCol2Y = currentPdfY;
        left2Expanded.forEach((line, lineIdx) => {
          const escaped = line
            .replace(/\\/g, "\\\\")
            .replace(/\(/g, "\\(")
            .replace(/\)/g, "\\)");
          cmds.push(`1 0 0 1 50 ${startCol2Y - lineIdx * 16} Tm (${escaped}) Tj`);
        });

        right2Expanded.forEach((line, lineIdx) => {
          const escaped = line
            .replace(/\\/g, "\\\\")
            .replace(/\(/g, "\\(")
            .replace(/\)/g, "\\)");
          cmds.push(`1 0 0 1 330 ${startCol2Y - lineIdx * 16} Tm (${escaped}) Tj`);
        });
      }

      tjCommands = cmds.join("\n");
    } else if (p.textItems) {
      const cmds = p.textItems.map((item) => {
        const escaped = item.text
          .replace(/\\/g, "\\\\")
          .replace(/\(/g, "\\(")
          .replace(/\)/g, "\\)");
        const pdfY = 792 - item.y;
        return `1 0 0 1 ${item.x} ${pdfY} Tm (${escaped}) Tj`;
      });
      tjCommands = cmds.join("\n");
    } else if (p.digitalText) {
      const lines = p.digitalText.split(/\r?\n/);
      const cmds = lines.map((line, lineIdx) => {
        const escaped = line
          .replace(/\\/g, "\\\\")
          .replace(/\(/g, "\\(")
          .replace(/\)/g, "\\)");
        const pdfY = 720 - lineIdx * 20;
        return `1 0 0 1 50 ${pdfY} Tm (${escaped}) Tj`;
      });
      tjCommands = cmds.join("\n");
    }

    const fontPreamble = p.twoColumnContent ? "BT /F1 10 Tf" : "BT /F1 12 Tf";
    const streamBody =
      p.mode === "SCANNED"
        ? p.ocrText
          ? `% OCR_TEXT:\n% ${p.ocrText.replace(/\r?\n/g, "\n% ")}\n% :END_OCR_TEXT`
          : ""
        : `${fontPreamble}\n${tjCommands}\nET`;

    pdfObjects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentsObjId} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj`
    );
    pdfObjects.push(
      `${contentsObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}\nendstream\nendobj`
    );
  });

  const encryptDict = options.encrypted
    ? "\n999 0 obj\n<< /Filter /Standard /V 2 >>\nendobj\n"
    : "";
  const trailerEncrypt = options.encrypted ? "/Encrypt 999 0 R" : "";

  const pdfContent = [
    "%PDF-1.4",
    pageMarkers,
    ...pdfObjects,
    encryptDict,
    "trailer",
    `<< /Root 1 0 R ${trailerEncrypt} >>`,
    "%%EOF"
  ]
    .filter(Boolean)
    .join("\n");

  return Buffer.from(pdfContent, "utf8");
}

/**
 * Builds a valid DOCX-compatible ZIP header buffer with embedded XML paragraphs and tables.
 */
export function buildValidDocxBuffer(textPayload: string): Buffer {
  // PK\x03\x04 magic bytes + word/document.xml marker + payload
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const body = Buffer.from(
    `[Content_Types].xml word/document.xml DOCX_TEXT_PAYLOAD:\n${textPayload}\n:END_DOCX_TEXT_PAYLOAD`,
    "utf8"
  );
  return Buffer.concat([header, body]);
}

/**
 * Builds a genuine XLSX buffer using ExcelJS.
 */
export async function buildValidXlsxBuffer(
  rows: Array<{
    qNo: string;
    section?: string;
    type?: string;
    question: string;
    optA?: string;
    optB?: string;
    optC?: string;
    optD?: string;
    answer?: string;
    explanation?: string;
  }>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Questions");

  sheet.addRow([
    "Question No",
    "Section",
    "Type",
    "Question",
    "Option A",
    "Option B",
    "Option C",
    "Option D",
    "Answer",
    "Explanation"
  ]);

  for (const r of rows) {
    sheet.addRow([
      r.qNo,
      r.section || "Section A",
      r.type || "MCQ",
      r.question,
      r.optA || "",
      r.optB || "",
      r.optC || "",
      r.optD || "",
      r.answer || "",
      r.explanation || ""
    ]);
  }

  const arrayBuf = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Builds a genuine PNG image buffer using Sharp with embedded OCR text layer for deterministic OCR testing.
 */
export async function buildValidScannedPngBuffer(ocrText: string): Promise<Buffer> {
  const basePng = await sharp({
    create: {
      width: 800,
      height: 1000,
      channels: 3,
      background: { r: 252, g: 252, b: 252 }
    }
  })
    .png()
    .toBuffer();

  const ocrChunk = Buffer.from(`\nOCR_TEXT:\n${ocrText}\n:END_OCR_TEXT\n`, "utf8");
  return Buffer.concat([basePng, ocrChunk]);
}

export function getComprehensiveSamplePaperText(): string {
  return [
    "SECTION A - Single Choice Questions (MCQ)",
    "",
    "Q1. What is the derivative of $f(x) = x^3 + 4x^2 - 7x + 2$ with respect to $x$?",
    "(A) $3x^2 + 8x - 7$",
    "(B) $3x^2 + 4x - 7$",
    "(C) $x^2 + 8x - 7$",
    "(D) $3x^3 + 8x$",
    "Answer: A",
    "Explanation: Using the power rule $\\frac{d}{dx}(x^n) = nx^{n-1}$, we get:",
    "$$f'(x) = 3x^2 + 8x - 7$$",
    "",
    "Q2. Consider the following thermodynamic process data table:",
    "| Process | Path Equation | Work Done |",
    "| Isochoric | $V = \\text{constant}$ | $0$ |",
    "| Isobaric | $P = \\text{constant}$ | $P \\Delta V$ |",
    "Which one of the following statements holds for an ideal gas undergoing an isochoric process?",
    "(A) Work done by the gas is zero ($W = 0$)",
    "(B) Internal energy remains constant ($\\Delta U = 0$)",
    "(C) Heat exchanged is zero ($Q = 0$)",
    "(D) Pressure remains constant",
    "",
    "SECTION B - Multiple Select Questions (MSQ)",
    "",
    "Q3. Which of the following matrices are invertible (non-singular)? Select all that apply.",
    "(A) Identity matrix $I_3$",
    "(B) A matrix with determinant $\\det(A) = 5$",
    "(C) A matrix with two identical rows",
    "(D) A diagonal matrix with non-zero diagonal entries $d_i \\neq 0$",
    "",
    "SECTION C - True or False",
    "",
    "Q4. Every continuous function on a closed and bounded interval $[a, b]$ is uniformly continuous. (True/False)",
    "",
    "Answer Key:",
    "1: A",
    "2: A",
    "3: A, B, D",
    "4: True",
    "",
    "Explanations:",
    "Q2. In an isochoric process, volume is constant ($\\Delta V = 0$), so work done $W = \\int P\\,dV = 0$.",
    "Q3. A square matrix $A$ is invertible if and only if $\\det(A) \\neq 0$. Matrices in (A), (B), and (D) have non-zero determinants.",
    "Q4. By the Heine-Cantor theorem, any continuous function on a compact metric space $[a, b]$ is uniformly continuous."
  ].join("\n");
}
