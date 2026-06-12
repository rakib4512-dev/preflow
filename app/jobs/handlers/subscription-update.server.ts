import prisma from "../../db.server";
import { upsertShop } from "../../lib/shop.server";
import type { Plan } from "@prisma/client";
import { logBillingEvent } from "../../lib/billing.server";

type AppSubscriptionPayload = {
  app_subscription: {
    admin_graphql_api_id: string;
    name: string;
    status: string;
  };
};

const PLAN_NAME_MAP: Record<string, Plan> = {
  "Growth Plan": "GROWTH",
  "Pro Plan": "PRO",
  "Free Plan": "FREE",
};

export async function handleAppSubscriptionUpdate(
  shop: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const data = payload as unknown as AppSubscriptionPayload;
  const shopRecord = await upsertShop(shop);
  const sub = data.app_subscription;

  if (sub.status === "CANCELLED" || sub.status === "EXPIRED") {
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { plan: "FREE" },
    });
    await logBillingEvent(shopRecord.id, "PLAN_CANCELLED", { subscription: sub });
    return;
  }

  if (sub.status === "ACTIVE") {
    const plan: Plan = PLAN_NAME_MAP[sub.name] ?? "FREE";
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { plan },
    });
    await logBillingEvent(shopRecord.id, "PLAN_CHANGED", { plan, subscription: sub });
  }
}
