import {
  ImportJobRecord,
  ImportPageRecord,
  QuestionRecord
} from "@/repositories/question-bank.repository";

export function serializeImportJob(job: ImportJobRecord) {
  const { storageKey: _redactedStorageKey, ...safeJob } = job;
  return {
    ...safeJob,
    userDeclaredFormat: job.userDeclaredFormat ?? "AUTO_DETECT",
    hasStoredFile: Boolean(_redactedStorageKey)
  };
}

export function serializeImportPage(page: ImportPageRecord) {
  const { previewStorageKey: _redactedPreviewKey, ...safePage } = page;
  return {
    ...safePage,
    hasPreviewAsset: Boolean(_redactedPreviewKey)
  };
}

export function serializeQuestion(question: QuestionRecord) {
  const { sourceFileId: _redactedSourceFile, ...safeQuestion } = question;
  return {
    ...safeQuestion,
    sourceDocumentId: question.importJobId
  };
}
