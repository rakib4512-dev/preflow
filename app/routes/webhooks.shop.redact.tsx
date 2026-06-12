import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GDPR: shop/redact arrives ~48 hours after uninstall and is Shopify's
// sanctioned signal to erase the shop's data. Deleting the Shop row cascades
// to PreorderConfig, PreorderOrder, BillingEvent, and CustomerNotification.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  const shopRecord = await prisma.shop.findUnique({
    where: { shop },
    select: { id: true },
  });

  if (shopRecord) {
    await prisma.shop.delete({ where: { id: shopRecord.id } });
  }

  // Sessions are keyed by domain, not shopId — clear any stragglers
  await prisma.session.deleteMany({ where: { shop } });
  await prisma.processedWebhook.deleteMany({ where: { shop } });

  return new Response(null, { status: 200 });
};
