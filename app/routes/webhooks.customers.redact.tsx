import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GDPR: erase customer data from our systems. We store no direct customer
// PII, but PreorderOrder/CustomerNotification rows reference the customer's
// orders — delete them for the orders Shopify lists in the payload.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);

  const body = payload as { orders_to_redact?: Array<number | string> };
  const orderIds = body.orders_to_redact ?? [];

  if (orderIds.length > 0) {
    const orderGids = orderIds.map((id) => `gid://shopify/Order/${id}`);
    const shopRecord = await prisma.shop.findUnique({
      where: { shop },
      select: { id: true },
    });
    if (shopRecord) {
      await prisma.preorderOrder.deleteMany({
        where: { shopId: shopRecord.id, orderGid: { in: orderGids } },
      });
      await prisma.customerNotification.deleteMany({
        where: { shopId: shopRecord.id, orderGid: { in: orderGids } },
      });
    }
  }

  return new Response(null, { status: 200 });
};
