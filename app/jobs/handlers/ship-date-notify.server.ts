import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { Resend } from "resend";
import { createBuyerToken } from "../../lib/buyer-token.server";
import { shipDateDelayEmail } from "../../lib/email-templates.server";
import type { Prisma } from "@prisma/client";

const resend = new Resend(process.env.RESEND_API_KEY);

export type NotifyJobData = {
  shopId: string;
  shopDomain: string;
  configId: string;
  productGid: string;
  variantGid: string;
  oldDate: string | null;
  newDate: string;
  productTitle: string;
};

const FULFILLED_STATUSES = new Set(["FULFILLED", "RESTOCKED"]);
const PAGE_SIZE = 100;

export async function handleShipDateNotify(data: NotifyJobData): Promise<void> {
  const { shopId, shopDomain, configId, productGid, variantGid, oldDate, newDate, productTitle } = data;

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { settings: true },
  });
  const settings = (shop?.settings ?? {}) as Record<string, unknown>;
  const introText = (settings.notificationIntroText as string | undefined) ?? undefined;

  const { admin } = await unauthenticated.admin(shopDomain);

  // Extract numeric IDs for lineItems matching
  const numericProductId = extractNumericId(productGid);
  const numericVariantId = variantGid ? extractNumericId(variantGid) : null;

  let cursor: string | undefined;
  let processed = 0;

  // Paginate through all PreorderOrders for this shop
  for (;;) {
    const orders = await prisma.preorderOrder.findMany({
      where: { shopId },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: { id: true, orderGid: true, lineItems: true },
    });

    if (orders.length === 0) break;

    for (const order of orders) {
      const lineItems = order.lineItems as Array<{ product_id?: number | null; variant_id?: number | null }>;
      const matches = lineItems.some((li) => {
        if (numericVariantId) return li.variant_id != null && String(li.variant_id) === numericVariantId;
        return li.product_id != null && String(li.product_id) === numericProductId;
      });
      if (!matches) continue;

      const dedupeKey = `${configId}:${newDate}:${order.orderGid}`;

      const existing = await prisma.customerNotification.findUnique({ where: { dedupeKey } });
      if (existing) continue;

      // Query Shopify for fulfillment status + customer email
      const orderDetails = await fetchOrderDetails(admin, order.orderGid);
      if (!orderDetails) continue;

      if (FULFILLED_STATUSES.has(orderDetails.fulfillmentStatus)) continue;

      const customerEmail = orderDetails.email;
      if (!customerEmail) continue;

      const token = createBuyerToken(order.orderGid, shopDomain);
      const appUrl = process.env.SHOPIFY_APP_URL ?? "";
      const manageUrl = `${appUrl}/buyer/cancel/${token}`;

      const { subject, html, text } = shipDateDelayEmail({
        storeName: shopDomain.replace(".myshopify.com", ""),
        productTitle,
        oldDate: oldDate ? formatDate(oldDate) : "—",
        newDate: formatDate(newDate),
        orderStatusUrl: orderDetails.statusPageUrl ?? manageUrl,
        introText,
      });

      await resend.emails.send({
        from: `${shopDomain.replace(".myshopify.com", "")} <noreply@preflow.app>`,
        to: customerEmail,
        subject,
        html,
        text,
      });

      await prisma.customerNotification.create({
        data: {
          shopId,
          orderGid: order.orderGid,
          type: "ship_date_delay",
          payload: { configId, oldDate, newDate, productTitle } as unknown as Prisma.InputJsonValue,
          dedupeKey,
          sentAt: new Date(),
        },
      });

      processed++;
    }

    cursor = orders[orders.length - 1].id;
    if (orders.length < PAGE_SIZE) break;
  }

  console.log(`[ship-date-notify] Sent ${processed} notifications for shop ${shopDomain}`);
}

async function fetchOrderDetails(
  admin: { graphql(q: string, opts?: { variables?: unknown }): Promise<{ json(): Promise<unknown> }> },
  orderGid: string,
): Promise<{ email: string | null; fulfillmentStatus: string; statusPageUrl: string | null } | null> {
  try {
    const res = await admin.graphql(
      `#graphql
      query OrderDetails($id: ID!) {
        order(id: $id) {
          email
          displayFulfillmentStatus
          statusPageUrl
        }
      }`,
      { variables: { id: orderGid } },
    );
    const json = (await res.json()) as {
      data?: { order?: { email?: string; displayFulfillmentStatus: string; statusPageUrl?: string } | null };
    };
    const order = json.data?.order;
    if (!order) return null;
    return {
      email: order.email ?? null,
      fulfillmentStatus: order.displayFulfillmentStatus,
      statusPageUrl: order.statusPageUrl ?? null,
    };
  } catch {
    return null;
  }
}

function extractNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
}
