import prisma from "../../db.server";
import { upsertShop } from "../../lib/shop.server";
import { checkAndRecordUsage, resetCycleIfNeeded } from "../../lib/billing.server";
import { createBuyerToken } from "../../lib/buyer-token.server";
import { buyerCancelLinkEmail } from "../../lib/email-templates.server";
import { Resend } from "resend";
import type { Prisma } from "@prisma/client";

const resend = new Resend(process.env.RESEND_API_KEY);

type LineItem = {
  id: number;
  variant_id: number | null;
  product_id: number | null;
  name: string;
  quantity: number;
  price: string;
};

type OrderPayload = {
  id: number;
  admin_graphql_api_id: string;
  email?: string | null;
  customer?: { email?: string | null } | null;
  line_items: LineItem[];
};

export async function handleOrderCreate(
  shop: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const order = payload as unknown as OrderPayload;
  const orderGid = order.admin_graphql_api_id;

  const shopRecord = await upsertShop(shop);

  const variantGids = order.line_items
    .filter((li) => li.variant_id != null)
    .map((li) => `gid://shopify/ProductVariant/${li.variant_id}`);

  const productGids = order.line_items
    .filter((li) => li.product_id != null)
    .map((li) => `gid://shopify/Product/${li.product_id}`);

  console.log("[order-create] shop:", shop, "shopId:", shopRecord.id);
  console.log("[order-create] variantGids:", variantGids);
  console.log("[order-create] productGids:", productGids);

  const configs = await prisma.preorderConfig.findMany({
    where: {
      shopId: shopRecord.id,
      enabled: true,
      OR: [
        { variantId: { in: variantGids } },
        { variantId: "", productId: { in: productGids } },
      ],
    },
  });

  console.log("[order-create] matched configs:", configs.length);

  if (configs.length === 0) {
    const allEnabled = await prisma.preorderConfig.findMany({
      where: { shopId: shopRecord.id, enabled: true },
      select: { productId: true, variantId: true },
    });
    console.log("[order-create] all enabled configs:", JSON.stringify(allEnabled));
    return;
  }

  // create + P2002-catch instead of upsert: we must know whether this order
  // was seen before, so a duplicate webhook run never double-counts usage.
  let isNewOrder = true;
  try {
    await prisma.preorderOrder.create({
      data: {
        shopId: shopRecord.id,
        orderGid,
        lineItems: order.line_items as unknown as object[],
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      isNewOrder = false;
    } else {
      throw err;
    }
  }

  // Confirmation email with the "Manage my pre-order" link — this is the only
  // way buyers ever receive their self-service cancel URL. (Internally deduped.)
  await sendConfirmationEmail(shop, shopRecord.id, order, configs).catch((err) => {
    console.error("[order-create] confirmation email failed for", orderGid, err);
  });

  if (isNewOrder) {
    // Roll the 30-day cycle BEFORE counting this order against it
    await resetCycleIfNeeded(shopRecord.id);
    await checkAndRecordUsage(shopRecord.id, shop);
  }
}

async function sendConfirmationEmail(
  shop: string,
  shopId: string,
  order: OrderPayload,
  configs: Array<{ shipDate: Date | null }>,
): Promise<void> {
  const customerEmail = order.email ?? order.customer?.email ?? null;
  console.log("[order-create] sendConfirmationEmail customerEmail:", customerEmail);
  if (!customerEmail) {
    console.warn("[order-create] no customerEmail in payload — PCD not approved or guest order");
    return;
  }

  const orderGid = order.admin_graphql_api_id;
  const dedupeKey = `${orderGid}:confirmation`;
  const existing = await prisma.customerNotification.findUnique({ where: { dedupeKey } });
  if (existing) {
    console.log("[order-create] confirmation already sent for", orderGid);
    return;
  }

  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  console.log("[order-create] appUrl:", appUrl);
  if (!appUrl) return;

  const shopSettings = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { settings: true },
  });
  const settings = (shopSettings?.settings ?? {}) as Record<string, unknown>;
  const introText = (settings.notificationIntroText as string | undefined) || undefined;
  const fromEmail = (settings.fromEmail as string | undefined) || "onboarding@resend.dev";

  const token = createBuyerToken(orderGid, shop);
  const manageUrl = `${appUrl}/buyer/cancel/${token}`;
  const storeName = shop.replace(".myshopify.com", "");
  const productTitle = order.line_items[0]?.name ?? "your pre-order";
  // Earliest ship date among matched configs, if any
  const shipDates = configs.map((c) => c.shipDate).filter((d): d is Date => d != null);
  const shipDate = shipDates.length > 0
    ? new Date(Math.min(...shipDates.map((d) => d.getTime()))).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const { subject, html, text } = buyerCancelLinkEmail({
    storeName,
    productTitle,
    shipDate,
    manageUrl,
    introText,
  });

  console.log("[order-create] sending email from:", fromEmail, "to:", customerEmail);
  await resend.emails.send({
    from: fromEmail,
    to: customerEmail,
    subject,
    html,
    text,
  });

  await prisma.customerNotification.create({
    data: {
      shopId,
      orderGid,
      type: "preorder_confirmation",
      payload: { productTitle, shipDate } as unknown as Prisma.InputJsonValue,
      dedupeKey,
    },
  });
}
