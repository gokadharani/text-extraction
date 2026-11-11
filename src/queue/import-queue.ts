import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getAppConfig } from "@/config/env";
import { createLogger } from "@/lib/logger";
import { questionBankRepo } from "@/repositories/question-bank.repository";
import { importPipelineService } from "@/services/import-pipeline.service";

const logger = createLogger("ImportQueue");

export const IMPORT_QUEUE_NAME = "question-bank-import-queue";

export interface ImportQueueJobPayload {
  importJobId: string;
  attemptTimestamp: number;
}

let bullQueue: Queue<ImportQueueJobPayload> | null = null;
let redisChecked = false;
let redisAvailable = false;

const activeLocalJobs = new Set<string>();

async function getBullQueue(): Promise<Queue<ImportQueueJobPayload> | null> {
  if (process.env.NODE_ENV === "test") {
    return null;
  }
  if (redisChecked) {
    return redisAvailable ? bullQueue : null;
  }

  redisChecked = true;
  const config = getAppConfig();

  try {
    const connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      connectTimeout: 1200,
      lazyConnect: true
    });

    await connection.connect();
    await connection.ping();

    bullQueue = new Queue<ImportQueueJobPayload>(IMPORT_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000
        },
        removeOnComplete: 100,
        removeOnFail: 200
      }
    });
    redisAvailable = true;
    logger.info("Connected to Redis BullMQ queue", { queueName: IMPORT_QUEUE_NAME });
    return bullQueue;
  } catch (err) {
    redisAvailable = false;
    logger.warn(
      "Redis unavailable; using non-blocking asynchronous background worker fallback",
      { reason: err instanceof Error ? err.message : String(err) }
    );
    return null;
  }
}

/**
 * Enqueues an import job for asynchronous processing.
 * Prevents duplicate concurrent execution for the same importJobId.
 */
export async function enqueueImportJob(
  importJobId: string,
  options?: { runSynchronouslyForTest?: boolean }
): Promise<{ queuedVia: "bullmq" | "async-worker" }> {
  await questionBankRepo.updateImportJob(importJobId, {
    status: "QUEUED",
    currentStage: "QUEUED",
    progressPercent: 5,
    errorMessage: null,
    errorCode: null,
    cancelledAt: null
  });

  if (options?.runSynchronouslyForTest) {
    await importPipelineService.processImportJob(importJobId);
    return { queuedVia: "async-worker" };
  }

  const queue = await getBullQueue();
  if (queue) {
    // Remove any completed/failed BullMQ job with the same ID before re-adding on retry
    const existingJob = await queue.getJob(importJobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === "completed" || state === "failed") {
        await existingJob.remove();
      } else if (state === "active" || state === "waiting" || state === "delayed") {
        return { queuedVia: "bullmq" };
      }
    }

    await queue.add(
      "process-import",
      {
        importJobId,
        attemptTimestamp: Date.now()
      },
      {
        jobId: importJobId
      }
    );
    return { queuedVia: "bullmq" };
  }

  // Fallback non-blocking background execution when Redis is not running locally
  if (!activeLocalJobs.has(importJobId)) {
    activeLocalJobs.add(importJobId);
    setTimeout(async () => {
      try {
        const current = await questionBankRepo.getImportJobById(importJobId);
        if (current && !current.cancelledAt && current.status === "QUEUED") {
          await importPipelineService.processImportJob(importJobId);
        }
      } catch {
        // Error state already recorded on ImportJob by ImportPipelineService
      } finally {
        activeLocalJobs.delete(importJobId);
      }
    }, 25);
  }

  return { queuedVia: "async-worker" };
}

/**
 * Cancels a queued or pending import job.
 */
export async function cancelQueuedImportJob(importJobId: string): Promise<boolean> {
  const job = await questionBankRepo.getImportJobById(importJobId);
  if (!job) return false;

  const queue = await getBullQueue();
  if (queue) {
    const bullJob = await queue.getJob(importJobId);
    if (bullJob) {
      const state = await bullJob.getState();
      if (state === "waiting" || state === "delayed") {
        await bullJob.remove();
      }
    }
  }

  activeLocalJobs.delete(importJobId);

  await questionBankRepo.updateImportJob(importJobId, {
    status: "FAILED",
    currentStage: "CANCELLED",
    errorCode: "JOB_CANCELLED",
    errorMessage: "Import job was cancelled by user.",
    cancelledAt: new Date()
  });

  return true;
}
