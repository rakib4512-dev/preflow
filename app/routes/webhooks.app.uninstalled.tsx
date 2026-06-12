import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../lib/enqueue-webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, webhookId } = await authenticate.webhook(request);

  await enqueueWebhook({
    topic: topic as string,
    shop,
    webhookId: webhookId as string,
    payload: payload as Record<string, unknown>,
  });

  return new Response(null, { status: 200 });
};
