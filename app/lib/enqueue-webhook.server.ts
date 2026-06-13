import { webhookQueue } from "../queue.server";
import type { WebhookJobData } from "../queue.server";

const ENQUEUE_TIMEOUT_MS = 800;

export async function enqueueWebhook(data: WebhookJobData): Promise<void> {
  try {
    // jobId alone is sufficient for deduplication — no two jobs with the same
    // Shopify webhook ID can exist in the queue.
    // Hard timeout: Shopify drops webhook deliveries after ~5s, so we must
    // never let a slow/unreachable Redis hold the response hostage.
    await withTimeout(
      webhookQueue.add(data.topic, data, { jobId: data.webhookId || undefined }),
      ENQUEUE_TIMEOUT_MS,
    );
  } catch (err) {
    console.warn(
      "[enqueueWebhook] queue unavailable, processing inline:",
      data.topic,
      "for",
      data.shop,
      err instanceof Error ? err.message : err,
    );
    // Fallback: process the webhook inline so nothing is lost when Redis is
    // down (common in local dev). processWebhookJob is idempotent via the
    // ProcessedWebhook table, so a duplicate inline run is safe.
    try {
      const { processWebhookJob } = await import("../jobs/webhook-processor.server");
      await processWebhookJob(data);
    } catch (inlineErr) {
      // Log but never throw — callers must return 200 to Shopify. A non-200
      // triggers Shopify's retry storm and fills the dashboard with ERR rows.
      console.error("[enqueueWebhook] inline fallback failed", data.topic, inlineErr);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`enqueue timed out after ${ms}ms`)), ms);
    timer.unref?.();
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
