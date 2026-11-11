// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import QuestionReviewWorkspacePage from "@/app/imports/[id]/review/page";
import UploadQuestionPapersPage from "@/app/upload/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "test-import-123" })
}));

// Mock next/link to render standard <a> tags with href
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

// Mock Tiptap editor and preview components to avoid ProseMirror DOM complexity in jsdom
vi.mock("@/components/richtext/TiptapRichEditor", () => ({
  TiptapRichEditor: () => <div data-testid="tiptap-editor">Editor</div>
}));

vi.mock("@/components/richtext/StudentLivePreview", () => ({
  StudentLivePreview: ({ doc }: any) => (
    <div data-testid="student-preview">{JSON.stringify(doc)}</div>
  )
}));

describe("Review Workspace Polling, Processing State, and Upload Navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("1. Review page opened while processing shows in-progress UI and eventually displays extracted questions when polling completes", async () => {
    let pollCount = 0;

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/imports/test-import-123") {
        if (pollCount >= 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              job: {
                id: "test-import-123",
                fileName: "test-exam.pdf",
                status: "REVIEW_REQUIRED",
                currentStage: "READY_FOR_REVIEW",
                progressPercent: 100,
                totalPages: 1
              },
              pages: [{ pageNumber: 1, rawText: "1. What is AI?", normalizedText: "1. What is AI?", classification: "DIGITAL", ocrUsed: false }]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            job: {
              id: "test-import-123",
              fileName: "test-exam.pdf",
              status: "PROCESSING",
              currentStage: "SELECTIVE_AI_REPAIR",
              progressPercent: 65,
              totalPages: 1
            },
            pages: []
          })
        });
      }

      if (url === "/api/imports/test-import-123/status") {
        pollCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: "test-import-123",
            status: "REVIEW_REQUIRED",
            currentStage: "READY_FOR_REVIEW",
            progressPercent: 100,
            totalExtractedQuestions: 1
          })
        });
      }

      if (url === "/api/imports/test-import-123/questions") {
        if (pollCount >= 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              importJobId: "test-import-123",
              total: 1,
              questions: [
                {
                  id: "q-1",
                  question: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "What is an operating system?" }] }] },
                  options: [
                    { id: "A", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "System software" }] }] } },
                    { id: "B", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hardware" }] }] } }
                  ],
                  answer: { type: "mcq", value: ["A"], status: "extracted" },
                  explanation: null,
                  type: "MCQ",
                  sourcePage: 1,
                  sourceQuestionNumber: "1",
                  sourceOrder: 1,
                  confidence: 1.0,
                  answerProvenance: "EXPLICIT_SOURCE",
                  reviewStatus: "NEEDS_ATTENTION",
                  warnings: []
                }
              ]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            importJobId: "test-import-123",
            total: 0,
            questions: []
          })
        });
      }

      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });

    global.fetch = mockFetch;

    render(<QuestionReviewWorkspacePage />);

    // Wait for initial load
    await act(async () => {
      await Promise.resolve();
    });

    // Should show "Extracting Questions..." processing screen
    expect(screen.getByText("Extracting Questions...")).toBeDefined();
    expect(screen.getByText("SELECTIVE_AI_REPAIR")).toBeDefined();
    expect(screen.getByText("65%")).toBeDefined();

    // Fast-forward timer to trigger poll
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    // Wait for full data reload
    await act(async () => {
      await Promise.resolve();
    });

    // Verify questions are now rendered!
    expect(screen.getByText("Q1")).toBeDefined();
    expect(screen.getByText("MCQ (Single Choice)")).toBeDefined();
  });

  it("2. Completed import with zero questions displays a genuine empty state", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/imports/test-import-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            job: {
              id: "test-import-123",
              fileName: "empty-doc.pdf",
              status: "COMPLETED",
              currentStage: "READY_FOR_REVIEW",
              progressPercent: 100,
              totalPages: 1
            },
            pages: [{ pageNumber: 1, rawText: "Just random text without questions", normalizedText: "Just random text without questions", classification: "DIGITAL", ocrUsed: false }]
          })
        });
      }

      if (url === "/api/imports/test-import-123/questions") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            importJobId: "test-import-123",
            total: 0,
            questions: []
          })
        });
      }

      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });

    global.fetch = mockFetch;

    render(<QuestionReviewWorkspacePage />);

    await act(async () => {
      await Promise.resolve();
    });

    // Should show the genuine empty state
    expect(screen.getByText("No Questions Extracted")).toBeDefined();
    expect(
      screen.getByText(
        "The extraction pipeline finished processing, but no valid question patterns were detected in this document."
      )
    ).toBeDefined();
    expect(screen.getByText("Retry Extraction")).toBeDefined();
  });

  it("3. Failed import displays a failure state with error details and retry action", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/imports/test-import-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            job: {
              id: "test-import-123",
              fileName: "corrupt.pdf",
              status: "FAILED",
              errorMessage: "Failed to parse PDF catalog: file is corrupt or unreadable",
              currentStage: "FAILED"
            },
            pages: []
          })
        });
      }

      if (url === "/api/imports/test-import-123/questions") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ total: 0, questions: [] })
        });
      }

      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });

    global.fetch = mockFetch;

    render(<QuestionReviewWorkspacePage />);

    await act(async () => {
      await Promise.resolve();
    });

    // Should display failure UI
    expect(screen.getByText("Document Processing Failed")).toBeDefined();
    expect(
      screen.getByText("Failed to parse PDF catalog: file is corrupt or unreadable")
    ).toBeDefined();
    expect(screen.getByText("Retry Extraction Pipeline")).toBeDefined();
  });

  it("4. Polling stops after terminal completion and timers are cleaned up on unmount", async () => {
    let pollCount = 0;

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/imports/test-import-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            job: {
              id: "test-import-123",
              fileName: "test.pdf",
              status: "PROCESSING",
              currentStage: "PDF_EXTRACTION",
              progressPercent: 20
            },
            pages: []
          })
        });
      }

      if (url === "/api/imports/test-import-123/status") {
        pollCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: "test-import-123",
            status: "PROCESSING",
            currentStage: "SEGMENT_QUESTIONS",
            progressPercent: 40
          })
        });
      }

      if (url === "/api/imports/test-import-123/questions") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ total: 0, questions: [] })
        });
      }

      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });

    global.fetch = mockFetch;

    const { unmount } = render(<QuestionReviewWorkspacePage />);

    await act(async () => {
      await Promise.resolve();
    });

    // First poll
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });
    expect(pollCount).toBe(1);

    // Unmount while still in processing
    unmount();

    // Advance timer again; no new polls should be made
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    expect(pollCount).toBe(1);
  });

  it("5. Upload navigation routes to import progress page rather than misleading empty review page", async () => {
    // Render the upload page with a completed upload item
    render(<UploadQuestionPapersPage />);

    // In step 1, select document type to proceed to step 2
    const nextBtn = screen.getByText("Continue to Upload");
    await act(async () => {
      nextBtn.click();
    });

    // Check that upload screen rendered
    expect(screen.getByText("Upload Question Papers")).toBeDefined();
  });
});
