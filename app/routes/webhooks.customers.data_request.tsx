import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// GDPR: customer data request — log and respond 200 within 30 days
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);
  return new Response(null, { status: 200 });
};
