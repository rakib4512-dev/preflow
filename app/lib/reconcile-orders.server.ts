import prisma from "../db.server";
import type { AdminGraphQL } from "./preorder-saga.server";
import { handleOrderCreate } from "../jobs/handlers/order-create.server";

// Safety net for missed orders/create webhooks (unregistered webhook, downtime,
// blocked protected-customer-data delivery, etc.). Sweeps recent orders via the
// Admin API and runs them through the same idempotent handler the webhook uses,
// so usage counts, dashboard numbers, and confirmation emails self-heal.
// Throttled per shop; runs from the dashboard loader.

const SWEEP_INTERVAL_MS = 2 * 60 * 1000; // at most once per 2 minutes
const LOOKBACK_DAYS = 7;

export async function reconcileRecentOrders(
  admin: AdminGraphQL,
  shopDomain: string,
): Promise<void> {
  const shop = await prisma.shop.findUnique({
    where: { shop: shopDomain },
    select: { id: true, settings: true },
  });
  if (!shop) return;

  const settings = (shop.settings ?? {}) as Record<string, unknown>;
  const lastRun = settings.lastReconcileAt
    ? new Date(settings.lastReconcileAt as string).getTime()
    : 0;
  if (Date.now() - lastRun < SWEEP_INTERVAL_MS) return;

  // Stamp first so overlapping dashboard loads don't double-sweep
  await prisma.shop.update({
    where: { id: shop.id },
    data: { settings: { ...settings, lastReconcileAt: new Date().toISOString() } },
  });

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const res = await admin.graphql(
    `#graphql
    query RecentOrders($q: String!) {
      orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          legacyResourceId
          email
          lineItems(first: 50) {
            nodes {
              title
              quantity
              product { legacyResourceId }
              variant { legacyResourceId }
            }
          }
        }
      }
    }`,
    { variables: { q: `created_at:>=${since}` } },
  );

  const json = (await res.json()) as {
    data?: {
      orders?: {
        nodes: Array<{
          id: string;
          legacyResourceId: string;
          email?: string | null;
          lineItems: {
            nodes: Array<{
              title: string;
              quantity: number;
              product?: { legacyResourceId: string } | null;
              variant?: { legacyResourceId: string } | null;
            }>;
          };
        }>;
      };
    };
  };

  const orders = json.data?.orders?.nodes ?? [];
  let processed = 0;

  for (const o of orders) {
    // Skip orders already recorded — cheap pre-check before the full handler
    const seen = await prisma.preorderOrder.findUnique({
      where: { orderGid: o.id },
      select: { id: true },
    });
    if (seen) continue;

    const payload = {
      id: Number(o.legacyResourceId),
      admin_graphql_api_id: o.id,
      email: o.email ?? null,
      line_items: o.lineItems.nodes.map((li, i) => ({
        id: i,
        variant_id: li.variant ? Number(li.variant.legacyResourceId) : null,
        product_id: li.product ? Number(li.product.legacyResourceId) : null,
        name: li.title,
        quantity: li.quantity,
        price: "0",
      })),
    };

    try {
      await handleOrderCreate(shopDomain, payload as unknown as Record<string, unknown>);
      processed++;
    } catch (err) {
      console.error("[reconcile] failed for order", o.id, err);
    }
  }

  if (processed > 0) {
    console.log(`[reconcile] backfilled ${processed} missed pre-order(s) for ${shopDomain}`);
  }
}
