import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as listImports, POST as createImport } from "@/app/api/imports/route";
import {
  GET as getImportById,
  DELETE as deleteImportById
} from "@/app/api/imports/[id]/route";
import { GET as getImportStatus } from "@/app/api/imports/[id]/status/route";
import { GET as getImportQuestions } from "@/app/api/imports/[id]/questions/route";
import { PATCH as patchQuestion } from "@/app/api/questions/[id]/route";
import { POST as approveQuestion } from "@/app/api/questions/[id]/approve/route";
import { POST as rejectQuestion } from "@/app/api/questions/[id]/reject/route";
import { POST as bulkApprove } from "@/app/api/imports/[id]/bulk-approve/route";
import { GET as exportImport } from "@/app/api/imports/[id]/export/route";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { importPipelineService } from "@/services/import-pipeline.service";
import { buildValidPdfBuffer } from "@/lib/sample-documents";
import { textToTiptapDoc } from "@/domain/richtext/tiptap-converter";

describe("REST API Route Handlers & Security Guardrails", () => {
  beforeEach(async () => {
    await questionBankRepo.resetForTests();
  });

  it("1. Rejects requests with invalid Bearer token with HTTP 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/imports", {
      headers: {
        authorization: "Bearer invalid-attacker-token"
      }
    });
    const res = await listImports(req);
    expect(res.status).toBe(401);
  });

  it("2. Full API lifecycle: Upload -> Process -> Get Questions -> Patch -> Approve -> Reject -> Bulk-Approve -> Export -> Delete, without leaking storageKey", async () => {
    const pdfBuf = buildValidPdfBuffer({
      pages: [
        {
          mode: "DIGITAL",
          digitalText: [
            "Section A - Single Choice Questions (MCQ)",
            "Q1. What is the SI unit of electric current?",
            "(A) Volt",
            "(B) Ampere",
            "(C) Ohm",
            "(D) Watt",
            "Answer: B"
          ].join("\n")
        }
      ]
    });

    const formData = new FormData();
    const fileBlob = new Blob([new Uint8Array(pdfBuf)], { type: "application/pdf" });
    formData.append("file", fileBlob, "physics-unit.pdf");

    const uploadReq = new NextRequest("http://localhost:3000/api/imports", {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" },
      body: formData
    });

    const uploadRes = await createImport(uploadReq);
    expect(uploadRes.status).toBe(201);
    const uploadJson = await uploadRes.json();
    const jobId: string = uploadJson.job.id;
    expect(jobId).toBeTruthy();
    // Ensure internal storageKey is never exposed in API responses
    expect(uploadJson.job.storageKey).toBeUndefined();

    // Test duplicate upload rejection when rejectDuplicate=true
    const dupForm = new FormData();
    dupForm.append("file", fileBlob, "physics-unit.pdf");
    dupForm.append("rejectDuplicate", "true");
    const dupReq = new NextRequest("http://localhost:3000/api/imports", {
      method: "POST",
      headers: { "x-qbank-client": "web-workspace" },
      body: dupForm
    });
    const dupRes = await createImport(dupReq);
    expect(dupRes.status).toBe(409);

    // Run extraction pipeline synchronously in test environment
    await importPipelineService.processImportJob(jobId, pdfBuf);

    // GET /api/imports/[id]/status
    const statusReq = new NextRequest(
      `http://localhost:3000/api/imports/${jobId}/status`,
      { headers: { "x-qbank-client": "web-workspace" } }
    );
    const statusRes = await getImportStatus(statusReq, { params: { id: jobId } });
    const statusJson = await statusRes.json();
    expect(statusJson.totalExtractedQuestions).toBe(1);

    // GET /api/imports/[id]/questions
    const qReq = new NextRequest(
      `http://localhost:3000/api/imports/${jobId}/questions`,
      { headers: { "x-qbank-client": "web-workspace" } }
    );
    const qRes = await getImportQuestions(qReq, { params: { id: jobId } });
    const qJson = await qRes.json();
    expect(qJson.questions.length).toBe(1);
    const questionId: string = qJson.questions[0].id;
    expect(qJson.questions[0].sourceFileId).toBeUndefined();

    // PATCH /api/questions/[id]
    const patchReq = new NextRequest(
      `http://localhost:3000/api/questions/${questionId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-qbank-client": "web-workspace"
        },
        body: JSON.stringify({
          question: textToTiptapDoc("What is the base SI unit of electric current?")
        })
      }
    );
    const patchRes = await patchQuestion(patchReq, { params: { id: questionId } });
    expect(patchRes.status).toBe(200);

    // POST /api/questions/[id]/reject
    const rejectReq = new NextRequest(
      `http://localhost:3000/api/questions/${questionId}/reject`,
      { method: "POST", headers: { "x-qbank-client": "web-workspace" } }
    );
    const rejectRes = await rejectQuestion(rejectReq, { params: { id: questionId } });
    const rejectJson = await rejectRes.json();
    expect(rejectJson.question.reviewStatus).toBe("REJECTED");

    // POST /api/questions/[id]/approve
    const approveReq = new NextRequest(
      `http://localhost:3000/api/questions/${questionId}/approve`,
      { method: "POST", headers: { "x-qbank-client": "web-workspace" } }
    );
    const approveRes = await approveQuestion(approveReq, { params: { id: questionId } });
    const approveJson = await approveRes.json();
    expect(approveJson.question.reviewStatus).toBe("APPROVED");

    // POST /api/imports/[id]/bulk-approve
    const bulkReq = new NextRequest(
      `http://localhost:3000/api/imports/${jobId}/bulk-approve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-qbank-client": "web-workspace"
        },
        body: JSON.stringify({ action: "APPROVE" })
      }
    );
    const bulkRes = await bulkApprove(bulkReq, { params: { id: jobId } });
    expect(bulkRes.status).toBe(200);

    // GET /api/imports/[id]/export?format=json
    const expReq = new NextRequest(
      `http://localhost:3000/api/imports/${jobId}/export?format=json`,
      { headers: { "x-qbank-client": "web-workspace" } }
    );
    const expRes = await exportImport(expReq, { params: { id: jobId } });
    expect(expRes.status).toBe(200);
    const expData = JSON.parse(await expRes.text());
    expect(expData.questions.length).toBe(1);

    // GET /api/imports/[id]
    const detailReq = new NextRequest(
      `http://localhost:3000/api/imports/${jobId}`,
      { headers: { "x-qbank-client": "web-workspace" } }
    );
    const detailRes = await getImportById(detailReq, { params: { id: jobId } });
    expect(detailRes.status).toBe(200);

    // DELETE /api/imports/[id]
    const delReq = new NextRequest(
      `http://localhost:3000/api/imports/${jobId}`,
      { method: "DELETE", headers: { "x-qbank-client": "web-workspace" } }
    );
    const delRes = await deleteImportById(delReq, { params: { id: jobId } });
    expect(delRes.status).toBe(200);
  });

  it("3. PATCH /api/questions/[id] validates answer option IDs against final merged state", async () => {
    // Create a test job and question
    const job = await questionBankRepo.createImportJob({
      fileName: "test.pdf",
      originalMimeType: "application/pdf",
      fileSize: 1024,
      fileSha256: "hash-test-3",
      storageKey: "imports/test-3.pdf"
    });

    const [q] = await questionBankRepo.saveStagingQuestionsTransactional(job.id, [
      {
        question: textToTiptapDoc("Which element has atomic number 1?"),
        options: [
          { id: "A", content: textToTiptapDoc("Hydrogen") },
          { id: "B", content: textToTiptapDoc("Helium") },
          { id: "C", content: textToTiptapDoc("Lithium") }
        ],
        answer: {
          type: "mcq",
          value: ["A"],
          status: "extracted"
        },
        explanation: null,
        type: "MCQ",
        sourceFileId: "file-test-3",
        sourcePage: 1,
        sourceQuestionNumber: "1",
        sourceOrder: 1,
        confidence: 1.0,
        answerProvenance: "EXPLICIT_SOURCE",
        reviewStatus: "PENDING_REVIEW",
        warnings: [],
        aiRepaired: false,
        contentHash: "dummy-hash-1",
        isDuplicate: false
      }
    ]);

    // Subtest A: Update ONLY answer with an invalid option ID "Z" -> must return 422
    const invalidAnsReq = new NextRequest(
      `http://localhost:3000/api/questions/${q.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-qbank-client": "web-workspace"
        },
        body: JSON.stringify({
          answer: {
            type: "mcq",
            value: ["Z"], // Not in options [A, B, C]
            status: "verified"
          }
        })
      }
    );
    const invalidAnsRes = await patchQuestion(invalidAnsReq, { params: { id: q.id } });
    expect(invalidAnsRes.status).toBe(422);
    const invalidAnsJson = await invalidAnsRes.json();
    expect(invalidAnsJson.error.code).toBe("INVALID_OPTION_ID");
    expect(invalidAnsJson.error.message).toContain("Z");

    // Subtest B: Update ONLY options, removing option A while existing answer has ["A"] -> must return 422
    const invalidOptReq = new NextRequest(
      `http://localhost:3000/api/questions/${q.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-qbank-client": "web-workspace"
        },
        body: JSON.stringify({
          options: [
            { id: "B", content: textToTiptapDoc("Helium") },
            { id: "C", content: textToTiptapDoc("Lithium") }
          ]
        })
      }
    );
    const invalidOptRes = await patchQuestion(invalidOptReq, { params: { id: q.id } });
    expect(invalidOptRes.status).toBe(422);
    const invalidOptJson = await invalidOptRes.json();
    expect(invalidOptJson.error.code).toBe("INVALID_OPTION_ID");
    expect(invalidOptJson.error.message).toContain("A");

    // Subtest C: Update ONLY answer with a valid option ID "B" -> must return 200
    const validAnsReq = new NextRequest(
      `http://localhost:3000/api/questions/${q.id}`,
      {
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
      }
    );
    const validAnsRes = await patchQuestion(validAnsReq, { params: { id: q.id } });
    expect(validAnsRes.status).toBe(200);
    const validAnsJson = await validAnsRes.json();
    expect(validAnsJson.question.answer.value).toEqual(["B"]);

    // Subtest D: Update options and answer together validly -> must return 200
    const validBothReq = new NextRequest(
      `http://localhost:3000/api/questions/${q.id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-qbank-client": "web-workspace"
        },
        body: JSON.stringify({
          options: [
            { id: "X", content: textToTiptapDoc("New X") },
            { id: "Y", content: textToTiptapDoc("New Y") }
          ],
          answer: {
            type: "mcq",
            value: ["X"],
            status: "verified"
          }
        })
      }
    );
    const validBothRes = await patchQuestion(validBothReq, { params: { id: q.id } });
    expect(validBothRes.status).toBe(200);
    const validBothJson = await validBothRes.json();
    expect(validBothJson.question.answer.value).toEqual(["X"]);
    expect(validBothJson.question.options.map((o: any) => o.id)).toEqual(["X", "Y"]);
  });
});
