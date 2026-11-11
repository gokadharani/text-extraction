// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import UploadQuestionPapersPage from "@/app/upload/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "test-import-123" }),
  useRouter: () => ({ push: vi.fn() })
}));

// Mock next/link to render standard <a> tags
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

describe("Document-Type-First Two-Step Upload Experience", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("1. The selection screen displays five document categories in order including Auto Detect (Recommended)", () => {
    render(<UploadQuestionPapersPage />);

    // Five category options
    expect(screen.getByText("Auto Detect")).toBeDefined();
    expect(screen.getByText("Recommended")).toBeDefined();
    expect(screen.getByText("Digital PDF")).toBeDefined();
    expect(screen.getByText("Scanned PDF — Printed Text")).toBeDefined();
    expect(screen.getByText("Scanned PDF — Handwriting")).toBeDefined();
    expect(screen.getByText("Other Supported Formats")).toBeDefined();

    // Verify descriptions
    expect(
      screen.getByText("Automatically detect the document format and extraction pathway.")
    ).toBeDefined();
    expect(
      screen.getByText("A PDF created digitally, where text can be selected and copied.")
    ).toBeDefined();
    expect(
      screen.getByText("A scanned document containing printed questions and text.")
    ).toBeDefined();
    expect(
      screen.getByText("A scanned PDF containing handwritten questions or answers.")
    ).toBeDefined();
    expect(screen.getByText("Upload Word, Excel, or image documents.")).toBeDefined();

    // Informational note for handwriting
    expect(
      screen.getByText(
        /Handwriting recognition may be less accurate\. Please review extracted questions and answers carefully\./
      )
    ).toBeDefined();

    // Supported formats listed for Auto Detect and Other Supported Formats
    expect(screen.getByText("PDF, DOCX, DOC, XLSX, XLS, JPG, JPEG, PNG, WEBP")).toBeDefined();
    expect(screen.getByText("DOCX, XLSX, JPG, JPEG, PNG, WEBP")).toBeDefined();

    // Confirm individual standalone cards are NOT shown
    expect(screen.queryByText("Word Document (DOCX)")).toBeNull();
    expect(screen.queryByText("Excel Document (XLSX)")).toBeNull();
    expect(screen.queryByText("Image (JPG, PNG, WEBP)")).toBeNull();
  });

  it("2. A user cannot continue to Step 2 without selecting a category", async () => {
    render(<UploadQuestionPapersPage />);

    const continueBtn = screen.getByText("Continue to Upload");
    // Initially disabled
    expect(continueBtn.hasAttribute("disabled")).toBe(true);

    // Clicking while disabled stays on Step 1
    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Dropzone from Step 2 should not be visible
    expect(screen.queryByText("Drag & drop question documents here")).toBeNull();
    expect(screen.getByText("Please select a category to proceed.")).toBeDefined();

    // Once a category is selected, the button is enabled and transitions to Step 2
    const digitalPdfCard = screen.getByText("Digital PDF");
    await act(async () => {
      fireEvent.click(digitalPdfCard);
    });

    expect(continueBtn.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      fireEvent.click(continueBtn);
    });

    // Now Step 2 dropzone is visible
    expect(screen.getByText("Drag & drop question documents here")).toBeDefined();
    expect(screen.getByText("Selected Category:")).toBeDefined();
  });

  it("3. Digital PDF accepts only PDF files and sets accept='.pdf'", async () => {
    const { container } = render(<UploadQuestionPapersPage />);

    // Select Digital PDF and proceed
    await act(async () => {
      fireEvent.click(screen.getByText("Digital PDF"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    // Check hidden file input accept attribute
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput).toBeDefined();
    expect(fileInput.getAttribute("accept")).toBe(".pdf");

    // Add a non-PDF file
    const docxFile = new File(["dummy docx content"], "questions.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [docxFile] } });
    });

    // Should reject with clear user-friendly error
    expect(
      screen.getByText(/File "questions\.docx" is not a PDF\. Only \.pdf files are accepted for Digital PDF\./)
    ).toBeDefined();

    // Add a valid PDF file
    const pdfFile = new File(["%PDF-1.4 sample"], "physics-exam.pdf", {
      type: "application/pdf"
    });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdfFile] } });
    });

    // Valid file shows in queue with Upload button
    expect(screen.getByText("physics-exam.pdf")).toBeDefined();
    expect(screen.getByText("Start Upload & Extraction (1)")).toBeDefined();
  });

  it("4. Scanned Printed PDF accepts only PDF files", async () => {
    const { container } = render(<UploadQuestionPapersPage />);

    await act(async () => {
      fireEvent.click(screen.getByText("Scanned PDF — Printed Text"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput.getAttribute("accept")).toBe(".pdf");

    const pngFile = new File(["fake png"], "scan.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pngFile] } });
    });

    expect(
      screen.getByText(
        /File "scan\.png" is not a PDF\. Only \.pdf files are accepted for Scanned PDF — Printed Text\./
      )
    ).toBeDefined();
  });

  it("5. Scanned Handwriting PDF accepts only PDF files and displays handwriting advisory", async () => {
    const { container } = render(<UploadQuestionPapersPage />);

    await act(async () => {
      fireEvent.click(screen.getByText("Scanned PDF — Handwriting"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    // Advisory note shown in Step 2 banner
    expect(screen.getByText("Handwritten Document Note:")).toBeDefined();

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput.getAttribute("accept")).toBe(".pdf");

    const xlsxFile = new File(["fake xlsx"], "sheet.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [xlsxFile] } });
    });

    expect(
      screen.getByText(
        /File "sheet\.xlsx" is not a PDF\. Only \.pdf files are accepted for Scanned PDF — Handwriting\./
      )
    ).toBeDefined();
  });

  it("6. Other Supported Formats accepts DOCX, XLSX, JPG, PNG, WEBP and rejects PDF", async () => {
    const { container } = render(<UploadQuestionPapersPage />);

    await act(async () => {
      fireEvent.click(screen.getByText("Other Supported Formats"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput.getAttribute("accept")).toContain(".docx");
    expect(fileInput.getAttribute("accept")).toContain(".xlsx");
    expect(fileInput.getAttribute("accept")).toContain(".png");
    expect(fileInput.getAttribute("accept")).not.toBe(".pdf");

    // Attempting to upload a PDF under Other Formats
    const pdfFile = new File(["%PDF-1.4 test"], "test.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdfFile] } });
    });

    expect(
      screen.getByText(
        "PDF files are not supported under 'Other Supported Formats'. Please select a PDF category in Step 1."
      )
    ).toBeDefined();

    // Adding valid other formats: docx, xlsx, png
    const docx = new File(["docx bytes"], "test.docx", { type: "application/docx" });
    const xlsx = new File(["xlsx bytes"], "test.xlsx", { type: "application/xlsx" });
    const png = new File(["png bytes"], "test.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [docx, xlsx, png] } });
    });

    expect(screen.getByText("test.docx")).toBeDefined();
    expect(screen.getByText("test.xlsx")).toBeDefined();
    expect(screen.getByText("test.png")).toBeDefined();
    expect(screen.getByText("Start Upload & Extraction (3)")).toBeDefined();
  });

  it("7. Drag-and-drop applies the same category-specific validation", async () => {
    const { container } = render(<UploadQuestionPapersPage />);

    await act(async () => {
      fireEvent.click(screen.getByText("Digital PDF"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    const dropzone = screen.getByText("Drag & drop question documents here").closest("div");
    expect(dropzone).toBeDefined();

    const invalidFile = new File(["image"], "photo.jpg", { type: "image/jpeg" });
    await act(async () => {
      fireEvent.drop(dropzone!, {
        dataTransfer: { files: [invalidFile] }
      });
    });

    expect(
      screen.getByText(/File "photo\.jpg" is not a PDF\. Only \.pdf files are accepted for Digital PDF\./)
    ).toBeDefined();
  });

  it("8. Changing format clears incompatible files from queue with notification", async () => {
    const { container } = render(<UploadQuestionPapersPage />);

    // 1. Select Digital PDF and add a PDF file
    await act(async () => {
      fireEvent.click(screen.getByText("Digital PDF"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const pdfFile = new File(["%PDF"], "math.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdfFile] } });
    });
    expect(screen.getByText("math.pdf")).toBeDefined();

    // 2. Click "Change Format" to return to Step 1
    await act(async () => {
      fireEvent.click(screen.getByText("Change Format"));
    });

    // 3. Select Other Supported Formats (where .pdf is incompatible)
    await act(async () => {
      fireEvent.click(screen.getByText("Other Supported Formats"));
    });

    // 4. Return to Step 2
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    // math.pdf was incompatible so it was removed with notice
    expect(screen.queryByText("math.pdf")).toBeNull();
    expect(
      screen.getByText(/Removed 1 incompatible file\(s\) that do not match Other Supported Formats\./)
    ).toBeDefined();
  });

  it("9. Multi-file upload under Other Supported Formats maps each file separately to its correct userDeclaredFormat", async () => {
    // Intercept XMLHttpRequest to inspect FormData
    const sentFormDataList: FormData[] = [];

    class MockXMLHttpRequest {
      upload = { onprogress: null };
      status = 201;
      responseText = JSON.stringify({ job: { id: "mock-job-123", isDuplicateFile: false } });
      headers: Record<string, string> = {};

      open(method: string, url: string) {}
      setRequestHeader(key: string, val: string) {
        this.headers[key] = val;
      }
      send(data: any) {
        sentFormDataList.push(data);
        if (typeof (this as any).onload === "function") {
          (this as any).onload();
        }
      }
      abort() {}
    }

    (global as any).XMLHttpRequest = MockXMLHttpRequest;

    const { container } = render(<UploadQuestionPapersPage />);

    await act(async () => {
      fireEvent.click(screen.getByText("Other Supported Formats"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const docxFile = new File(["docx"], "exam.docx", { type: "application/docx" });
    const xlsxFile = new File(["xlsx"], "sheet.xlsx", { type: "application/xlsx" });
    const imgFile = new File(["png"], "figure.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [docxFile, xlsxFile, imgFile] } });
    });

    // Click "Start Upload & Extraction (3)"
    const uploadAllBtn = screen.getByText("Start Upload & Extraction (3)");
    await act(async () => {
      fireEvent.click(uploadAllBtn);
    });

    expect(sentFormDataList.length).toBe(3);

    // File 1: exam.docx -> userDeclaredFormat: DOCX
    const file1Name = (sentFormDataList[0].get("file") as File).name;
    const file1Format = sentFormDataList[0].get("userDeclaredFormat");
    expect(file1Name).toBe("exam.docx");
    expect(file1Format).toBe("DOCX");

    // File 2: sheet.xlsx -> userDeclaredFormat: XLSX
    const file2Name = (sentFormDataList[1].get("file") as File).name;
    const file2Format = sentFormDataList[1].get("userDeclaredFormat");
    expect(file2Name).toBe("sheet.xlsx");
    expect(file2Format).toBe("XLSX");

    // File 3: figure.png -> userDeclaredFormat: IMAGE
    const file3Name = (sentFormDataList[2].get("file") as File).name;
    const file3Format = sentFormDataList[2].get("userDeclaredFormat");
    expect(file3Name).toBe("figure.png");
    expect(file3Format).toBe("IMAGE");
  });

  it("10. PDF upload sends exact selected PDF format enum", async () => {
    const sentFormDataList: FormData[] = [];

    class MockXMLHttpRequest {
      upload = { onprogress: null };
      status = 201;
      responseText = JSON.stringify({ job: { id: "job-pdf", isDuplicateFile: false } });
      headers: Record<string, string> = {};
      open() {}
      setRequestHeader(key: string, val: string) {
        this.headers[key] = val;
      }
      send(data: any) {
        sentFormDataList.push(data);
        if (typeof (this as any).onload === "function") {
          (this as any).onload();
        }
      }
      abort() {}
    }

    (global as any).XMLHttpRequest = MockXMLHttpRequest;

    const { container } = render(<UploadQuestionPapersPage />);

    // Select Scanned PDF — Handwriting
    await act(async () => {
      fireEvent.click(screen.getByText("Scanned PDF — Handwriting"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const pdf = new File(["%PDF"], "hw.pdf", { type: "application/pdf" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdf] } });
    });

    const startBtn = screen.getByText("Start Upload & Extraction (1)");
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(sentFormDataList.length).toBe(1);
    expect(sentFormDataList[0].get("userDeclaredFormat")).toBe("SCANNED_HANDWRITTEN_PDF");
  });

  it("11. Auto Detect category accepts both PDF and non-PDF files and sets accept to all formats", async () => {
    const { container } = render(<UploadQuestionPapersPage />);

    // Select Auto Detect and proceed
    await act(async () => {
      fireEvent.click(screen.getByText("Auto Detect"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    // Check file input accept attribute contains all supported formats
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(fileInput.getAttribute("accept")).toBe(".pdf,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg,.webp");

    // Add multiple diverse files: pdf, docx, xlsx, png
    const pdfFile = new File(["%PDF-1.4 test"], "paper.pdf", { type: "application/pdf" });
    const docxFile = new File(["docx content"], "questions.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    const xlsxFile = new File(["xlsx content"], "data.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const pngFile = new File(["png content"], "scan.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdfFile, docxFile, xlsxFile, pngFile] } });
    });

    expect(screen.getByText("paper.pdf")).toBeDefined();
    expect(screen.getByText("questions.docx")).toBeDefined();
    expect(screen.getByText("data.xlsx")).toBeDefined();
    expect(screen.getByText("scan.png")).toBeDefined();
    expect(screen.getByText("Start Upload & Extraction (4)")).toBeDefined();
  });

  it("12. Auto Detect rejects unsupported file extension with clear allowed formats message", async () => {
    const { container } = render(<UploadQuestionPapersPage />);

    await act(async () => {
      fireEvent.click(screen.getByText("Auto Detect"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const txtFile = new File(["plain text"], "notes.txt", { type: "text/plain" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [txtFile] } });
    });

    expect(
      screen.getByText(
        'Unsupported extension ".txt". Allowed: PDF, DOCX, DOC, XLSX, XLS, JPG, JPEG, PNG, WEBP.'
      )
    ).toBeDefined();
  });

  it("13. Auto Detect upload sends userDeclaredFormat = 'AUTO_DETECT' for all file types", async () => {
    const sentFormDataList: FormData[] = [];

    class MockXMLHttpRequest {
      upload = { onprogress: null };
      status = 201;
      responseText = JSON.stringify({ job: { id: "job-autodetect-123", isDuplicateFile: false } });
      headers: Record<string, string> = {};
      open() {}
      setRequestHeader(key: string, val: string) {
        this.headers[key] = val;
      }
      send(data: any) {
        sentFormDataList.push(data);
        if (typeof (this as any).onload === "function") {
          (this as any).onload();
        }
      }
      abort() {}
    }

    (global as any).XMLHttpRequest = MockXMLHttpRequest;

    const { container } = render(<UploadQuestionPapersPage />);

    await act(async () => {
      fireEvent.click(screen.getByText("Auto Detect"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const pdfFile = new File(["%PDF"], "biology.pdf", { type: "application/pdf" });
    const docxFile = new File(["docx"], "exam.docx", { type: "application/docx" });
    const imgFile = new File(["jpg"], "formula.jpg", { type: "image/jpeg" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdfFile, docxFile, imgFile] } });
    });

    const startBtn = screen.getByText("Start Upload & Extraction (3)");
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(sentFormDataList.length).toBe(3);
    // Every file uploaded under Auto Detect sends userDeclaredFormat = "AUTO_DETECT"
    expect(sentFormDataList[0].get("userDeclaredFormat")).toBe("AUTO_DETECT");
    expect(sentFormDataList[1].get("userDeclaredFormat")).toBe("AUTO_DETECT");
    expect(sentFormDataList[2].get("userDeclaredFormat")).toBe("AUTO_DETECT");
  });

  it("14. Switching from Auto Detect to Digital PDF removes non-PDF files and keeps PDF files", async () => {
    const { container } = render(<UploadQuestionPapersPage />);

    // 1. Select Auto Detect
    await act(async () => {
      fireEvent.click(screen.getByText("Auto Detect"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    // 2. Add both a PDF and a DOCX file
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const pdfFile = new File(["%PDF"], "math.pdf", { type: "application/pdf" });
    const docxFile = new File(["docx"], "notes.docx", { type: "application/docx" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdfFile, docxFile] } });
    });

    expect(screen.getByText("math.pdf")).toBeDefined();
    expect(screen.getByText("notes.docx")).toBeDefined();

    // 3. Switch format to Digital PDF
    await act(async () => {
      fireEvent.click(screen.getByText("Change Format"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Digital PDF"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    // math.pdf is retained, notes.docx was removed
    expect(screen.getByText("math.pdf")).toBeDefined();
    expect(screen.queryByText("notes.docx")).toBeNull();
    expect(
      screen.getByText(/Removed 1 incompatible file\(s\) that do not match Digital PDF\./)
    ).toBeDefined();

    // 4. Switch back to Auto Detect
    await act(async () => {
      fireEvent.click(screen.getByText("Change Format"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Auto Detect"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Continue to Upload"));
    });

    // math.pdf is still present without any removal notice
    expect(screen.getByText("math.pdf")).toBeDefined();
  });
});
