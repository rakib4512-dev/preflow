import { Queue, Worker, type Job } from "bullmq";
import type { NotifyJobData } from "./jobs/handlers/ship-date-notify.server";

function parseRedisConnection(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || "localhost",
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      db: u.pathname ? Number(u.pathname.slice(1)) || 0 : 0,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

const redisHost = parseRedisConnection(
  process.env.REDIS_URL || "redis://localhost:6379",
);

// Producer connections must FAIL FAST when Redis is down. With ioredis
// defaults, queue.add() buffers in the offline queue and retries forever —
// the awaiting webhook request never responds, Shopify times out, and the
// Partner dashboard fills with ERR deliveries.
const producerConnection = {
  ...redisHost,
  enableOfflineQueue: false,
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
};

// Workers are long-lived consumers: BullMQ requires maxRetriesPerRequest null
// so blocking reads survive reconnects. Retrying forever is correct here.
const workerConnection = {
  ...redisHost,
  maxRetriesPerRequest: null as null,
};

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

export const webhookQueue = new Queue("webhooks", { connection: producerConnection, defaultJobOptions });

export const notifyQueue = new Queue<NotifyJobData>("notifications", { connection: producerConnection, defaultJobOptions });

// Surface connection problems once instead of crashing on 'error' events
webhookQueue.on("error", (err) => console.warn("[queue:webhooks]", err.message));
notifyQueue.on("error", (err) => console.warn("[queue:notifications]", err.message));

export type WebhookJobData = {
  topic: string;
  shop: string;
  webhookId: string;
  payload: Record<string, unknown>;
};

export type { NotifyJobData };

let webhookWorkerStarted = false;
let notifyWorkerStarted = false;

export function startWebhookWorker() {
  if (webhookWorkerStarted) return;
  webhookWorkerStarted = true;

  const worker = new Worker<WebhookJobData>(
    "webhooks",
    async (job: Job<WebhookJobData>) => {
      const { processWebhookJob } = await import("./jobs/webhook-processor.server");
      await processWebhookJob(job.data);
    },
    { connection: workerConnection, concurrency: 5 },
  );
  worker.on("error", (err) => console.warn("[worker:webhooks]", err.message));
}

export function startNotificationWorker() {
  if (notifyWorkerStarted) return;
  notifyWorkerStarted = true;

  const worker = new Worker<NotifyJobData>(
    "notifications",
    async (job: Job<NotifyJobData>) => {
      const { handleShipDateNotify } = await import("./jobs/handlers/ship-date-notify.server");
      await handleShipDateNotify(job.data);
    },
    { connection: workerConnection, concurrency: 2 },
  );
  worker.on("error", (err) => console.warn("[worker:notifications]", err.message));
}
