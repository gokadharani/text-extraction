import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { getAppConfig } from "@/config/env";
import { createLogger } from "@/lib/logger";
import { IMPORT_QUEUE_NAME, ImportQueueJobPayload } from "@/queue/import-queue";
import { importPipelineService } from "@/services/import-pipeline.service";

const logger = createLogger("BullMQWorker");

export function startImportWorker(): Worker<ImportQueueJobPayload> {
  const config = getAppConfig();
  const connection = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null
  });

  const worker = new Worker<ImportQueueJobPayload>(
    IMPORT_QUEUE_NAME,
    async (job: Job<ImportQueueJobPayload>) => {
      const { importJobId } = job.data;
      logger.info("Worker picked up import job", {
        importJobId,
        attempt: job.attemptsMade + 1
      });
      await importPipelineService.processImportJob(importJobId);
    },
    {
      connection,
      concurrency: 3
    }
  );

  worker.on("completed", (job) => {
    logger.info("Worker completed import job", {
      importJobId: job.data.importJobId
    });
  });

  worker.on("failed", (job, err) => {
    logger.error("Worker failed import job", {
      importJobId: job?.data?.importJobId,
      error: err.message
    });
  });

  return worker;
}

if (require.main === module) {
  logger.info("Starting standalone Question Bank BullMQ Worker...");
  const worker = startImportWorker();
  process.on("SIGINT", async () => {
    await worker.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await worker.close();
    process.exit(0);
  });
}
