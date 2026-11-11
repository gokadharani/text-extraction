export interface AppConfig {
  databaseUrl: string;
  authSecret: string;
  defaultApiToken: string;
  signedUrlSecret: string;
  redisUrl: string;
  queueFallbackInProcess: boolean;
  storageProvider: "local" | "s3";
  localStorageRoot: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  limits: {
    maxFileSizeBytes: number;
    maxPageCount: number;
    maxImageDimension: number;
    processingTimeoutMs: number;
  };
  ocr: {
    provider: "paddle" | "managed" | "tesseract";
    paddleEndpoint: string;
    managedEndpoint: string;
    managedApiKey: string;
    timeoutMs: number;
    maxRetries: number;
    lowConfidenceThreshold: number;
  };
  ai: {
    openAiApiKey: string;
    defaultModel: string;
    escalationModel: string;
    repairConfidenceThreshold: number;
    budgetPerImportUsd: number;
    maxOutputTokens: number;
  };
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getAppConfig(): AppConfig {
  const storageProviderRaw = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  const ocrProviderRaw = (process.env.OCR_PROVIDER || "paddle").toLowerCase();

  return {
    databaseUrl:
      process.env.DATABASE_URL ||
      "postgresql://postgres:123456@localhost:5432/question_bank?schema=public",
    authSecret:
      process.env.APP_AUTH_SECRET || "default-dev-auth-secret-do-not-use-in-prod-32chars",
    defaultApiToken: process.env.DEFAULT_API_TOKEN || "qbank-dev-token-2026",
    signedUrlSecret:
      process.env.SIGNED_URL_SECRET || "default-signed-asset-url-secret-key-2026",
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    queueFallbackInProcess:
      process.env.QUEUE_FALLBACK_IN_PROCESS !== "false",
    storageProvider: storageProviderRaw === "s3" ? "s3" : "local",
    localStorageRoot: process.env.LOCAL_STORAGE_ROOT || "./.private-storage",
    s3: {
      endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
      region: process.env.S3_REGION || "us-east-1",
      bucket: process.env.S3_BUCKET || "question-bank-private",
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ""
    },
    limits: {
      maxFileSizeBytes: parseIntEnv(process.env.MAX_FILE_SIZE_BYTES, 50 * 1024 * 1024), // 50 MB
      maxPageCount: parseIntEnv(process.env.MAX_PAGE_COUNT, 200),
      maxImageDimension: parseIntEnv(process.env.MAX_IMAGE_DIMENSION, 6000),
      processingTimeoutMs: parseIntEnv(process.env.PROCESSING_TIMEOUT_MS, 300_000)
    },
    ocr: {
      provider:
        ocrProviderRaw === "managed"
          ? "managed"
          : ocrProviderRaw === "tesseract"
            ? "tesseract"
            : "paddle",
      paddleEndpoint:
        process.env.PADDLE_OCR_URL ||
        process.env.PADDLE_OCR_ENDPOINT ||
        "http://localhost:8866/predict/ocr_system",
      managedEndpoint: process.env.MANAGED_OCR_ENDPOINT || "",
      managedApiKey: process.env.MANAGED_OCR_API_KEY || "",
      timeoutMs: parseIntEnv(process.env.OCR_TIMEOUT_MS, 30_000),
      maxRetries: parseIntEnv(process.env.OCR_MAX_RETRIES, 3),
      lowConfidenceThreshold: parseFloatEnv(process.env.OCR_LOW_CONFIDENCE_THRESHOLD, 0.78)
    },
    ai: {
      openAiApiKey: process.env.OPENAI_API_KEY || "",
      defaultModel: process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini",
      escalationModel: process.env.OPENAI_ESCALATION_MODEL || "gpt-4o",
      repairConfidenceThreshold: parseFloatEnv(
        process.env.AI_REPAIR_CONFIDENCE_THRESHOLD,
        0.75
      ),
      budgetPerImportUsd: parseFloatEnv(process.env.AI_BUDGET_PER_IMPORT_USD, 0.5),
      maxOutputTokens: parseIntEnv(process.env.AI_MAX_OUTPUT_TOKENS, 2048)
    }
  };
}
