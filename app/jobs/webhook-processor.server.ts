import prisma from "../db.server";
import type { WebhookJobData } from "../queue.server";
import { upsertShop } from "../lib/shop.server";
import { handleOrderCreate } from "./handlers/order-create.server";
import { handleProductUpdate, handleProductDelete } from "./handlers/product-sync.server";
import { handleAppSubscriptionUpdate } from "./handlers/subscription-update.server";
import { handleAppUninstalled } from "./handlers/app-uninstalled.server";

export async function processWebhookJob(data: WebhookJobData): Promise<void> {
  const { topic, shop, webhookId, payload } = data;

  // Skip if a previous attempt fully completed. The marker is written AFTER
  // successful processing (below) — writing it first would make BullMQ's
  // retries no-ops and silently drop failed webhooks. Handlers are idempotent
  // (upserts + dedupe keys), so an occasional duplicate run is safe.
  const already = await prisma.processedWebhook.findUnique({ where: { webhookId } });
  if (already) return;

  switch (topic) {
    case "ORDERS_CREATE":
      await handleOrderCreate(shop, payload);
      break;
    case "PRODUCTS_UPDATE":
      await handleProductUpdate(shop, payload);
      break;
    case "PRODUCTS_DELETE":
      await handleProductDelete(shop, payload);
      break;
    case "APP_SUBSCRIPTIONS_UPDATE":
      await handleAppSubscriptionUpdate(shop, payload);
      break;
    case "APP_UNINSTALLED":
      await handleAppUninstalled(shop);
      break;
    default:
      break;
  }

  // Mark completed — ignore unique-violation if a concurrent run won the race.
  await prisma.processedWebhook
    .create({ data: { webhookId, topic, shop } })
    .catch((err: { code?: string }) => {
      if (err?.code !== "P2002") throw err;
    });
}

