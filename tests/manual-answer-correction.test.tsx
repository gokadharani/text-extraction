// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QuestionReviewWorkspacePage from "@/app/imports/[id]/review/page";
import { PATCH as patchQuestion } from "@/app/api/questions/[id]/route";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { textToTiptapDoc } from "@/domain/richtext/tiptap-converter";
import { NextRequest } from "next/server";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "test-manual-edit-123" })
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

// Mock Tiptap rich editor to avoid ProseMirror DOM complexity in jsdom
vi.mock("@/components/richtext/TiptapRichEditor", () => ({
  TiptapRichEditor: ({ value }: any) => (
    <div data-testid="tiptap-editor">{JSON.stringify(value)}</div>
  )
}));

// Mock StudentLivePreview
vi.mock("@/components/richtext/StudentLivePreview", () => ({
  StudentLivePreview: ({ doc }: any) => (
    <div data-testid="student-preview">{JSON.stringify(doc)}</div>
  )
}));

describe("Feature: Manually Edit AI-Extracted Answers", () => {
  beforeEach(async () => {
    await questionBankRepo.resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. MCQ answer can be changed from one option to another in the Review UI", async () => {
    const mockQuestion = {
      id: "q-mcq-1",
      question: textToTiptapDoc("Which data structure uses LIFO?"),
      options: [
        { id: "A", content: textToTiptapDoc("Queue") },
        { id: "B", content: textToTiptapDoc("Stack") },
        { id: "C", content: textToTiptapDoc("Tree") }
      ],
      answer: {
        type: "mcq",
        value: ["A"], // Incorrect AI-extracted answer
        status: "extracted"
      },
      explanation: null,
      type: "MCQ",
      sourcePage: 1,
      sourcePageEnd: null,
      sourceQuestionNumber: "1",
      sourceSection: null,
      sourceOrder: 1,
      confidence: 0.95,
      answerProvenance: "EXPLICIT_SOURCE",
      reviewStatus: "PENDING_REVIEW",
      sharedPassage: null,
      boundingBox: null,
      warnings: [],
      aiRepaired: false,
      aiRepairModel: null,
      aiRepairReason: null,
      isDuplicate: false,
      duplicateOfId: null
    };

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/imports/test-manual-edit-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            job: {
              id: "test-manual-edit-123",
              fileName: "exam.pdf",
              status: "REVIEW_REQUIRED",
              currentStage: "READY_FOR_REVIEW",
              progressPercent: 100,
              totalPages: 1
            },
            pages: [{ pageNumber: 1, rawText: "1. Which data structure uses LIFO?", normalizedText: "1. Which data structure uses LIFO?", classification: "DIGITAL", ocrUsed: false }]
          })
        });
      }

      if (url === "/api/imports/test-manual-edit-123/questions") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            questions: [mockQuestion]
          })
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({})
      });
    });

    global.fetch = mockFetch;

    render(<QuestionReviewWorkspacePage />);

    // Wait for the question to load
    await waitFor(() => {
      expect(screen.getByText("Options & Correct Answer Selector")).toBeInTheDocument();
    });

    // Initial state: Option A is marked correct
    expect(screen.getByTitle("Correct answer selected (click to clear/unselect)")).toHaveTextContent("Option A");

    // Click Option B to correct the answer
    const optionBButton = screen.getByRole("button", { name: /Option B/i });
    expect(optionBButton).toHaveTextContent("Option B");
    fireEvent.click(optionBButton);

    // After clicking Option B, Option B is now marked as correct and Option A is unselected
    await waitFor(() => {
      expect(screen.getByTitle("Correct answer selected (click to clear/unselect)")).toHaveTextContent("Option B");
      // Summary banner shows Option B with Manually Corrected badge
      expect(screen.getAllByText("Option B").length).toBeGreaterThan(0);
      expect(screen.getByText("Manually Corrected")).toBeInTheDocument();
    });
  });

  it("2. MSQ allows selecting and toggling multiple correct options in the Review UI", async () => {
    const mockMsqQuestion = {
      id: "q-msq-1",
      question: textToTiptapDoc("Select all prime numbers:"),
      options: [
        { id: "A", content: textToTiptapDoc("2") },
        { id: "B", content: textToTiptapDoc("4") },
        { id: "C", content: textToTiptapDoc("5") }
      ],
      answer: {
        type: "msq",
        value: ["A"], // Only 2 extracted initially
        status: "extracted"
      },
      explanation: null,
      type: "MSQ",
      sourcePage: 1,
      sourcePageEnd: null,
      sourceQuestionNumber: "2",
      sourceSection: null,
      sourceOrder: 2,
      confidence: 0.9,
      answerProvenance: "EXPLICIT_SOURCE",
      reviewStatus: "PENDING_REVIEW",
      sharedPassage: null,
      boundingBox: null,
      warnings: [],
      aiRepaired: false,
      aiRepairModel: null,
      aiRepairReason: null,
      isDuplicate: false,
      duplicateOfId: null
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/imports/test-manual-edit-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            job: {
              id: "test-manual-edit-123",
              fileName: "exam.pdf",
              status: "REVIEW_REQUIRED",
              currentStage: "READY_FOR_REVIEW",
              progressPercent: 100,
              totalPages: 1
            },
            pages: []
          })
        });
      }
      if (url === "/api/imports/test-manual-edit-123/questions") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ questions: [mockMsqQuestion] })
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    render(<QuestionReviewWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText("Options & Correct Answer Selector")).toBeInTheDocument();
    });

    // Initially Option A is selected
    expect(screen.getByTitle("Correct answer selected (click to clear/unselect)")).toHaveTextContent("Option A");

    // Click Option C to also mark it correct
    const optionCButton = screen.getByRole("button", { name: /Option C/i });
    expect(optionCButton).toHaveTextContent("Option C");
    fireEvent.click(optionCButton);

    // Now both Option A and Option C are marked as correct
    await waitFor(() => {
      const selectedButtons = screen.getAllByTitle("Correct answer selected (click to clear/unselect)");
      expect(selectedButtons).toHaveLength(2);
      expect(selectedButtons[0]).toHaveTextContent("Option A");
      expect(selectedButtons[1]).toHaveTextContent("Option C");
    });

    // Toggle Option A off
    const optionASelectedButton = screen.getAllByTitle("Correct answer selected (click to clear/unselect)")[0];
    fireEvent.click(optionASelectedButton);

    // Now only Option C remains selected
    await waitFor(() => {
      const remainingSelected = screen.getAllByTitle("Correct answer selected (click to clear/unselect)");
      expect(remainingSelected).toHaveLength(1);
      expect(remainingSelected[0]).toHaveTextContent("Option C");
    });
  });

  it("3. TRUE_FALSE answer can be selected and changed in the Review UI", async () => {
    const mockTfQuestion = {
      id: "q-tf-1",
      question: textToTiptapDoc("The Earth revolves around the Sun."),
      options: [
        { id: "True", content: textToTiptapDoc("True") },
        { id: "False", content: textToTiptapDoc("False") }
      ],
      answer: {
        type: "true_false",
        value: ["False"], // Incorrectly extracted
        status: "extracted"
      },
      explanation: null,
      type: "TRUE_FALSE",
      sourcePage: 1,
      sourcePageEnd: null,
      sourceQuestionNumber: "3",
      sourceSection: null,
      sourceOrder: 3,
      confidence: 0.9,
      answerProvenance: "EXPLICIT_SOURCE",
      reviewStatus: "PENDING_REVIEW",
      sharedPassage: null,
      boundingBox: null,
      warnings: [],
      aiRepaired: false,
      aiRepairModel: null,
      aiRepairReason: null,
      isDuplicate: false,
      duplicateOfId: null
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/imports/test-manual-edit-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            job: {
              id: "test-manual-edit-123",
              fileName: "exam.pdf",
              status: "REVIEW_REQUIRED",
              currentStage: "READY_FOR_REVIEW",
              progressPercent: 100,
              totalPages: 1
            },
            pages: []
          })
        });
      }
      if (url === "/api/imports/test-manual-edit-123/questions") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ questions: [mockTfQuestion] })
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    render(<QuestionReviewWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText("True/False Answer:")).toBeInTheDocument();
    });

    // Initially False is selected
    expect(screen.getByRole("button", { name: /False \(Selected\)/i })).toBeInTheDocument();

    // Click True to change the answer
    const trueButton = screen.getByRole("button", { name: /^True$/i });
    fireEvent.click(trueButton);

    // Now True is selected and False is unselected
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /True \(Selected\)/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /False \(Selected\)/i })).not.toBeInTheDocument();
    });
  });

  it("4. An answer can be cleared (left unanswered) in the Review UI", async () => {
    const mockQuestion = {
      id: "q-clear-1",
      question: textToTiptapDoc("Sample question with extracted answer"),
      options: [
        { id: "A", content: textToTiptapDoc("Option 1") },
        { id: "B", content: textToTiptapDoc("Option 2") }
      ],
      answer: {
        type: "mcq",
        value: ["A"],
        status: "extracted"
      },
      explanation: null,
      type: "MCQ",
      sourcePage: 1,
      sourcePageEnd: null,
      sourceQuestionNumber: "4",
      sourceSection: null,
      sourceOrder: 4,
      confidence: 0.9,
      answerProvenance: "EXPLICIT_SOURCE",
      reviewStatus: "PENDING_REVIEW",
      sharedPassage: null,
      boundingBox: null,
      warnings: [],
      aiRepaired: false,
      aiRepairModel: null,
      aiRepairReason: null,
      isDuplicate: false,
      duplicateOfId: null
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/imports/test-manual-edit-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            job: {
              id: "test-manual-edit-123",
              fileName: "exam.pdf",
              status: "REVIEW_REQUIRED",
              currentStage: "READY_FOR_REVIEW",
              progressPercent: 100,
              totalPages: 1
            },
            pages: []
          })
        });
      }
      if (url === "/api/imports/test-manual-edit-123/questions") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ questions: [mockQuestion] })
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    render(<QuestionReviewWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText("Options & Correct Answer Selector")).toBeInTheDocument();
    });

    // Initially Option A is marked
    expect(screen.getAllByText("Option A").length).toBeGreaterThan(0);

    // Click "Clear Answer" button
    const clearButton = screen.getByTitle("Clear selected answer (leave question unanswered)");
    fireEvent.click(clearButton);

    // Summary banner now states unanswered
    await waitFor(() => {
      expect(screen.getByText("No answer marked (Unanswered)")).toBeInTheDocument();
      expect(screen.queryByTitle("Clear selected answer (leave question unanswered)")).not.toBeInTheDocument();
    });
  });

  it("5. Manual corrections are included in the save request", async () => {
    let capturedPatchBody: any = null;

    const mockQuestion = {
      id: "q-save-1",
      question: textToTiptapDoc("What is the capital of France?"),
      options: [
        { id: "A", content: textToTiptapDoc("London") },
        { id: "B", content: textToTiptapDoc("Paris") }
      ],
      answer: {
        type: "mcq",
        value: ["A"], // Extracted incorrectly
        status: "extracted"
      },
      explanation: null,
      type: "MCQ",
      sourcePage: 1,
      sourcePageEnd: null,
      sourceQuestionNumber: "5",
      sourceSection: null,
      sourceOrder: 5,
      confidence: 0.8,
      answerProvenance: "EXPLICIT_SOURCE",
      reviewStatus: "PENDING_REVIEW",
      sharedPassage: null,
      boundingBox: null,
      warnings: [],
      aiRepaired: false,
      aiRepairModel: null,
      aiRepairReason: null,
      isDuplicate: false,
      duplicateOfId: null
    };

    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url === "/api/imports/test-manual-edit-123") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            job: {
              id: "test-manual-edit-123",
              fileName: "exam.pdf",
              status: "REVIEW_REQUIRED",
              currentStage: "READY_FOR_REVIEW",
              progressPercent: 100,
              totalPages: 1
            },
            pages: []
          })
        });
      }
      if (url === "/api/imports/test-manual-edit-123/questions") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ questions: [mockQuestion] })
        });
      }
      if (url === "/api/questions/q-save-1" && opts?.method === "PATCH") {
        capturedPatchBody = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            question: {
              ...mockQuestion,
              answer: capturedPatchBody.answer
            }
          })
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    render(<QuestionReviewWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText("Options & Correct Answer Selector")).toBeInTheDocument();
    });

    // Click Option B to correct the answer
    const optB = screen.getByRole("button", { name: /Option B/i });
    fireEvent.click(optB);

    // Click Save button
    const saveButton = screen.getByRole("button", { name: /Save/i });
    fireEvent.click(saveButton);

    // Verify PATCH request payload
    await waitFor(() => {
      expect(capturedPatchBody).not.toBeNull();
      expect(capturedPatchBody.answer).toEqual({
        type: "mcq",
        value: ["B"],
        status: "verified"
      });
    });
  });

  it("6. Manual corrections persist in the repository after saving and reopening", async () => {
    // Create a real job and question in questionBankRepo
    const job = await questionBankRepo.createImportJob({
      fileName: "persistence-test.pdf",
      originalMimeType: "application/pdf",
      fileSize: 2048,
      fileSha256: "hash-persistence-1",
      storageKey: "imports/persistence-1.pdf"
    });

    const [savedQ] = await questionBankRepo.saveStagingQuestionsTransactional(job.id, [
      {
        question: textToTiptapDoc("Which planet is closest to the Sun?"),
        options: [
          { id: "A", content: textToTiptapDoc("Venus") },
          { id: "B", content: textToTiptapDoc("Mercury") },
          { id: "C", content: textToTiptapDoc("Mars") }
        ],
        answer: {
          type: "mcq",
          value: ["A"], // Wrong answer initially
          status: "extracted"
        },
        explanation: null,
        type: "MCQ",
        sourceFileId: "file-persist-1",
        sourcePage: 1,
        sourceQuestionNumber: "1",
        sourceOrder: 1,
        confidence: 0.9,
        answerProvenance: "EXPLICIT_SOURCE",
        reviewStatus: "PENDING_REVIEW",
        warnings: [],
        aiRepaired: false,
        contentHash: "hash-planet-1",
        isDuplicate: false
      }
    ]);

    // Perform manual correction: change answer from A to B via PATCH API
    const patchReq = new NextRequest(`http://localhost:3000/api/questions/${savedQ.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-qbank-client": "web-workspace"
      },
      body: JSON.stringify({
        answer: {
          type: "mcq",
          value: ["B"],
          status: "verified"
        }
      })
    });

    const patchRes = await patchQuestion(patchReq, { params: { id: savedQ.id } });
    expect(patchRes.status).toBe(200);

    // Reopen/fetch question from repository to ensure persistence
    const reloaded = await questionBankRepo.getQuestionById(savedQ.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.answer.value).toEqual(["B"]);
    expect(reloaded?.answer.status).toBe("verified");

    // Clear answer to unanswered and verify persistence
    const clearReq = new NextRequest(`http://localhost:3000/api/questions/${savedQ.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-qbank-client": "web-workspace"
      },
      body: JSON.stringify({
        answer: {
          type: "mcq",
          value: [],
          status: "missing"
        }
      })
    });

    const clearRes = await patchQuestion(clearReq, { params: { id: savedQ.id } });
    expect(clearRes.status).toBe(200);

    const reloadedCleared = await questionBankRepo.getQuestionById(savedQ.id);
    expect(reloadedCleared?.answer.value).toEqual([]);
    expect(reloadedCleared?.answer.status).toBe("missing");
  });

  it("7. Existing extraction and review behaviour remains unaffected", async () => {
    // Verify that questionBankRepo can still save questions, calculate content hash,
    // and maintain all existing attributes without regressions
    const job = await questionBankRepo.createImportJob({
      fileName: "unaffected-test.pdf",
      originalMimeType: "application/pdf",
      fileSize: 1024,
      fileSha256: "hash-unaffected-1",
      storageKey: "imports/unaffected-1.pdf"
    });

    const [q] = await questionBankRepo.saveStagingQuestionsTransactional(job.id, [
      {
        question: textToTiptapDoc("Standard test question"),
        options: [
          { id: "A", content: textToTiptapDoc("Option A") },
          { id: "B", content: textToTiptapDoc("Option B") }
        ],
        answer: {
          type: "mcq",
          value: ["A"],
          status: "extracted"
        },
        explanation: textToTiptapDoc("Standard explanation"),
        type: "MCQ",
        sourceFileId: "file-unaffected-1",
        sourcePage: 1,
        sourceQuestionNumber: "1",
        sourceOrder: 1,
        confidence: 1.0,
        answerProvenance: "EXPLICIT_SOURCE",
        reviewStatus: "PENDING_REVIEW",
        warnings: [],
        aiRepaired: false,
        contentHash: "hash-unaffected-q1",
        isDuplicate: false
      }
    ]);

    expect(q.options).toHaveLength(2);
    expect(q.answer.value).toEqual(["A"]);
    expect(q.explanation).not.toBeNull();
    expect(q.reviewStatus).toBe("PENDING_REVIEW");
  });
});
