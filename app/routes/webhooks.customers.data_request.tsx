import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const APP_OPERATOR_EMAIL = "rakibpabna426@gmail.com";

// GDPR: customer data request. Shopify requires the merchant to be able to
// compile the personal data we hold about a given customer within 30 days.
//
// PreFlow stores no direct customer profile — the only customer-linked data is
// order references (PreorderOrder / CustomerNotification keyed by orderGid).
// We log a structured audit line and email the app operator so a human can
// respond within the SLA window. The handler must still return 200 promptly,
// so all side effects are best-effort and never block the response.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const body = payload as {
    customer?: { id?: number | string; email?: string };
    orders_requested?: Array<number | string>;
  };

  const customerEmail = body.customer?.email ?? "unknown";
  const customerId = body.customer?.id ?? "unknown";
  const orderIds = body.orders_requested ?? [];

  // Audit trail — visible in Railway logs even if email delivery fails.
  console.log(
    `[GDPR data_request] shop=${shop} customer=${customerId} email=${customerEmail} orders=${JSON.stringify(orderIds)}`,
  );

  // Look up what we actually hold for these orders, so the operator can reply
  // with a precise answer instead of guessing.
  let heldOrders: string[] = [];
  try {
    const shopRecord = await prisma.shop.findUnique({
      where: { shop },
      select: { id: true },
    });
    if (shopRecord && orderIds.length > 0) {
      const orderGids = orderIds.map((id) => `gid://shopify/Order/${id}`);
      const rows = await prisma.preorderOrder.findMany({
        where: { shopId: shopRecord.id, orderGid: { in: orderGids } },
        select: { orderGid: true },
      });
      heldOrders = rows.map((r) => r.orderGid);
    }
  } catch (err) {
    console.error("[GDPR data_request] lookup failed:", err);
  }

  // Notify the operator so the 30-day SLA can be met.
  if (process.env.RESEND_API_KEY) {
    const text = [
      `GDPR customer data request received.`,
      ``,
      `Shop: ${shop}`,
      `Customer ID: ${customerId}`,
      `Customer email: ${customerEmail}`,
      `Orders requested: ${orderIds.length ? orderIds.join(", ") : "(none specified)"}`,
      `PreFlow records found for these orders: ${heldOrders.length ? heldOrders.join(", ") : "none"}`,
      ``,
      `PreFlow stores no customer profile data — only the order references above`,
      `(product/variant/quantity for pre-order line items). Respond to the merchant`,
      `within 30 days of receipt.`,
    ].join("\n");

    await resend.emails
      .send({
        from: "PreFlow <onboarding@resend.dev>",
        to: APP_OPERATOR_EMAIL,
        subject: `GDPR data request — ${shop}`,
        text,
      })
      .catch((err) => console.error("[GDPR data_request] notify email failed:", err));
  }

  return new Response(null, { status: 200 });
};
