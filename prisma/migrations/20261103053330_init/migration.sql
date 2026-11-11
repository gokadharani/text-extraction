-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'REVIEW_REQUIRED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentFormat" AS ENUM ('DIGITAL_PDF', 'SCANNED_PDF', 'MIXED_PDF', 'DOCX', 'DOC', 'XLSX', 'XLS', 'IMAGE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PageClassification" AS ENUM ('DIGITAL', 'SCANNED', 'MIXED', 'TABULAR', 'DOCUMENT_FLOW');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'MSQ', 'TRUE_FALSE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AnswerProvenance" AS ENUM ('EXPLICIT_SOURCE', 'ANSWER_KEY', 'AI_INFERRED', 'MISSING');

-- CreateEnum
CREATE TYPE "QuestionReviewStatus" AS ENUM ('PENDING_REVIEW', 'NEEDS_ATTENTION', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('CREATED', 'EDITED', 'APPROVED', 'REJECTED', 'BULK_APPROVED', 'BULK_REJECTED', 'AI_REPAIRED');

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalMimeType" TEXT NOT NULL,
    "detectedFormat" "DocumentFormat" NOT NULL DEFAULT 'UNKNOWN',
    "fileSize" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "currentStage" TEXT NOT NULL DEFAULT 'UPLOADED',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "totalPages" INTEGER NOT NULL DEFAULT 0,
    "pagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalExtractedQuestions" INTEGER NOT NULL DEFAULT 0,
    "questionsRequiringReview" INTEGER NOT NULL DEFAULT 0,
    "approvedQuestionsCount" INTEGER NOT NULL DEFAULT 0,
    "ocrMethod" TEXT,
    "ocrDurationMs" INTEGER NOT NULL DEFAULT 0,
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "aiModel" TEXT,
    "aiInputTokens" INTEGER NOT NULL DEFAULT 0,
    "aiOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedAiCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aiBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.50,
    "processingDurationMs" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "isDuplicateFile" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportPage" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "classification" "PageClassification" NOT NULL DEFAULT 'DIGITAL',
    "rawText" TEXT NOT NULL DEFAULT '',
    "normalizedText" TEXT NOT NULL DEFAULT '',
    "ocrUsed" BOOLEAN NOT NULL DEFAULT false,
    "ocrProvider" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "ocrDurationMs" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "previewStorageKey" TEXT,
    "boundingBoxes" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "question" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "answer" JSONB NOT NULL,
    "explanation" JSONB,
    "type" "QuestionType" NOT NULL DEFAULT 'UNKNOWN',
    "sourceFileId" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "sourcePage" INTEGER NOT NULL DEFAULT 1,
    "sourcePageEnd" INTEGER,
    "sourceQuestionNumber" TEXT NOT NULL DEFAULT '1',
    "sourceSection" TEXT,
    "sourceOrder" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "answerProvenance" "AnswerProvenance" NOT NULL DEFAULT 'MISSING',
    "reviewStatus" "QuestionReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "sharedPassage" JSONB,
    "boundingBox" JSONB,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "aiRepaired" BOOLEAN NOT NULL DEFAULT false,
    "aiRepairModel" TEXT,
    "aiRepairReason" TEXT,
    "contentHash" TEXT NOT NULL,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfId" TEXT,
    "publishedToBank" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionAsset" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "questionId" TEXT,
    "pageNumber" INTEGER,
    "assetType" TEXT NOT NULL DEFAULT 'IMAGE',
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "altText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionReviewLog" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL DEFAULT 'system',
    "action" "ReviewAction" NOT NULL,
    "previousState" JSONB,
    "newState" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRepairCache" (
    "id" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "repairedJson" JSONB NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRepairCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrCache" (
    "id" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ocrResult" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcrCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

-- CreateIndex
CREATE INDEX "ImportJob_fileSha256_idx" ON "ImportJob"("fileSha256");

-- CreateIndex
CREATE INDEX "ImportJob_createdAt_idx" ON "ImportJob"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ImportJob_uploadedById_idx" ON "ImportJob"("uploadedById");

-- CreateIndex
CREATE INDEX "ImportPage_importJobId_idx" ON "ImportPage"("importJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportPage_importJobId_pageNumber_key" ON "ImportPage"("importJobId", "pageNumber");

-- CreateIndex
CREATE INDEX "Question_importJobId_idx" ON "Question"("importJobId");

-- CreateIndex
CREATE INDEX "Question_reviewStatus_idx" ON "Question"("reviewStatus");

-- CreateIndex
CREATE INDEX "Question_type_idx" ON "Question"("type");

-- CreateIndex
CREATE INDEX "Question_contentHash_idx" ON "Question"("contentHash");

-- CreateIndex
CREATE INDEX "Question_publishedToBank_idx" ON "Question"("publishedToBank");

-- CreateIndex
CREATE UNIQUE INDEX "Question_importJobId_sourceOrder_key" ON "Question"("importJobId", "sourceOrder");

-- CreateIndex
CREATE INDEX "QuestionAsset_importJobId_idx" ON "QuestionAsset"("importJobId");

-- CreateIndex
CREATE INDEX "QuestionAsset_questionId_idx" ON "QuestionAsset"("questionId");

-- CreateIndex
CREATE INDEX "QuestionAsset_sha256_idx" ON "QuestionAsset"("sha256");

-- CreateIndex
CREATE INDEX "QuestionReviewLog_questionId_idx" ON "QuestionReviewLog"("questionId");

-- CreateIndex
CREATE INDEX "QuestionReviewLog_createdAt_idx" ON "QuestionReviewLog"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AiRepairCache_inputHash_key" ON "AiRepairCache"("inputHash");

-- CreateIndex
CREATE INDEX "AiRepairCache_inputHash_idx" ON "AiRepairCache"("inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "OcrCache_imageHash_key" ON "OcrCache"("imageHash");

-- CreateIndex
CREATE INDEX "OcrCache_imageHash_idx" ON "OcrCache"("imageHash");

-- AddForeignKey
ALTER TABLE "ImportPage" ADD CONSTRAINT "ImportPage_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAsset" ADD CONSTRAINT "QuestionAsset_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAsset" ADD CONSTRAINT "QuestionAsset_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionReviewLog" ADD CONSTRAINT "QuestionReviewLog_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
