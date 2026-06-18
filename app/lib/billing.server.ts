import prisma from "../db.server";
import type { BillingEventType, Prisma } from "@prisma/client";
import { Resend } from "resend";
import {
  PLANS,
  OVERAGE_RATE,
  nextTierPriceDiff,
  calculateOverageCost,
  usagePercent,
  type Plan,
} from "./billing.shared";

// Re-export so server-only callers can import from one place
export { PLANS, OVERAGE_RATE, nextTierPriceDiff, calculateOverageCost, usagePercent };
export type { Plan };

const resend = new Resend(process.env.RESEND_API_KEY);

export async function logBillingEvent(
  shopId: string,
  type: BillingEventType,
  payload: Record<string, unknown>,
  emailedAt?: Date,
): Promise<void> {
  await prisma.billingEvent.create({
    data: { shopId, type, payload: payload as Prisma.InputJsonValue, emailedAt: emailedAt ?? null },
  });
}

/**
 * Increments usageThisCycle, sends warning emails at 70% and 100% (at most
 * once per cycle, tracked via BillingEvent rows), and bills overage through
 * Shopify's usage-record API. Never disables the widget — constraint 3.
 */
export async function checkAndRecordUsage(
  shopId: string,
  shopDomain: string,
): Promise<void> {
  const shop = await prisma.shop.update({
    where: { id: shopId },
    data: { usageThisCycle: { increment: 1 } },
    select: { usageThisCycle: true, plan: true, settings: true, cycleStart: true },
  });

  const plan = shop.plan as Plan;
  const limit = PLANS[plan].monthlyLimit;
  if (limit === Infinity) return;

  const pct = (shop.usageThisCycle / limit) * 100;
  const settings = shop.settings as Record<string, unknown>;
  const ownerEmail = (settings?.ownerEmail as string | undefined) ?? "";

  // Threshold warnings: existence-check against BillingEvent within the
  // current cycle. Safe under concurrent webhook workers (worst case: a
  // duplicate email, never a missed one).
  if (pct >= 100) {
    if (!(await hasEventThisCycle(shopId, "USAGE_WARNING_100", shop.cycleStart))) {
      const sentAt = new Date();
      await sendWarningEmail(ownerEmail, shopDomain, 100, plan);
      await logBillingEvent(shopId, "USAGE_WARNING_100", { usage: shop.usageThisCycle, limit }, sentAt);
    }
  } else if (pct >= 70) {
    if (!(await hasEventThisCycle(shopId, "USAGE_WARNING_70", shop.cycleStart))) {
      const sentAt = new Date();
      await sendWarningEmail(ownerEmail, shopDomain, 70, plan);
      await logBillingEvent(shopId, "USAGE_WARNING_70", { usage: shop.usageThisCycle, limit }, sentAt);
    }
  }

  // Overage: bill $OVERAGE_RATE per order past the limit via Shopify's usage
  // records (the subscription's usage line item cappedAmount enforces the cap).
  // FREE has no subscription so there is nothing to bill — the 100% warning
  // email is the upgrade nudge.
  if (shop.usageThisCycle > limit && plan !== "FREE") {
    const overageOrder = shop.usageThisCycle - limit;
    const billed = await createUsageRecord(shopDomain, overageOrder).catch((err) => {
      console.error("[billing] usage record failed for", shopDomain, err);
      return false;
    });
    if (billed) {
      await logBillingEvent(shopId, "OVERAGE_BILLED", {
        overageOrder,
        amount: OVERAGE_RATE,
        totalOverageCost: calculateOverageCost(plan, overageOrder),
      });
    }
  }
}

async function hasEventThisCycle(
  shopId: string,
  type: BillingEventType,
  cycleStart: Date,
): Promise<boolean> {
  const existing = await prisma.billingEvent.findFirst({
    where: { shopId, type, createdAt: { gte: cycleStart } },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Creates a $OVERAGE_RATE usage record on the active subscription's usage
 * line item. Returns false when there is no usage line item or the capped
 * amount has been reached (Shopify rejects records past the cap).
 */
async function createUsageRecord(shopDomain: string, overageOrder: number): Promise<boolean> {
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(shopDomain);

  const subRes = await admin.graphql(`#graphql
    query UsageLineItem {
      appInstallation {
        activeSubscriptions {
          status
          lineItems {
            id
            plan { pricingDetails { __typename } }
          }
        }
      }
    }
  `);
  const subJson = (await subRes.json()) as {
    data?: {
      appInstallation?: {
        activeSubscriptions: Array<{
          status: string;
          lineItems: Array<{ id: string; plan: { pricingDetails: { __typename: string } } }>;
        }>;
      };
    };
  };
  const active = (subJson.data?.appInstallation?.activeSubscriptions ?? []).find(
    (s) => s.status === "ACTIVE",
  );
  const usageLineItem = active?.lineItems.find(
    (li) => li.plan.pricingDetails.__typename === "AppUsagePricing",
  );
  if (!usageLineItem) return false;

  const res = await admin.graphql(
    `#graphql
    mutation CreateUsageRecord($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!) {
      appUsageRecordCreate(
        subscriptionLineItemId: $subscriptionLineItemId
        price: $price
        description: $description
      ) {
        appUsageRecord { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        subscriptionLineItemId: usageLineItem.id,
        price: { amount: OVERAGE_RATE, currencyCode: "USD" },
        description: `Pre-order overage (order ${overageOrder} past plan limit)`,
      },
    },
  );
  const json = (await res.json()) as {
    data?: { appUsageRecordCreate?: { appUsageRecord?: { id: string } | null; userErrors: Array<{ message: string }> } };
  };
  const errors = json.data?.appUsageRecordCreate?.userErrors ?? [];
  if (errors.length > 0) {
    // Most common: "Total price exceeds balance remaining" — cap reached.
    console.warn("[billing] usage record rejected:", errors.map((e) => e.message).join("; "));
    return false;
  }
  return Boolean(json.data?.appUsageRecordCreate?.appUsageRecord?.id);
}

async function sendWarningEmail(
  to: string,
  shop: string,
  percent: number,
  plan: Plan,
): Promise<void> {
  if (!to) return;
  const limit = PLANS[plan].monthlyLimit;
  // FREE has no subscription to bill against, so overage is never charged there.
  const overageLine =
    plan === "FREE"
      ? `Pre-orders will <strong>never stop</strong> — upgrade to raise your limit.`
      : `Pre-orders will <strong>never stop</strong> — any overages are billed at $${OVERAGE_RATE}/order, capped at $${nextTierPriceDiff(plan)} per cycle.`;
  await resend.emails.send({
    from: "PreFlow <onboarding@resend.dev>",
    to,
    subject: `[PreFlow] You've used ${percent}% of your pre-order limit`,
    html: `
      <p>Your store <strong>${shop}</strong> has used ${percent}% of its ${limit} pre-order limit on the ${PLANS[plan].name}.</p>
      <p>${overageLine}</p>
      <p>Upgrade to remove the limit entirely.</p>
    `,
  });
}

type CycleFields = { cycleStart: Date; usageThisCycle: number };

/**
 * Rolls the 30-day usage cycle if it has expired. Returns the current cycle
 * fields (post-reset when a reset happened), so callers that already hold the
 * shop row can use the values without a follow-up read.
 *
 * Pass `preloaded` when the caller has already fetched cycleStart/usageThisCycle
 * to avoid a redundant SELECT on the same row.
 */
export async function resetCycleIfNeeded(
  shopId: string,
  preloaded?: CycleFields,
): Promise<CycleFields> {
  const shop =
    preloaded ??
    (await prisma.shop.findUnique({
      where: { id: shopId },
      select: { cycleStart: true, usageThisCycle: true },
    }));
  if (!shop) return { cycleStart: new Date(), usageThisCycle: 0 };

  const now = new Date();
  const cycleAge = now.getTime() - shop.cycleStart.getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  if (cycleAge >= thirtyDays) {
    await prisma.shop.update({
      where: { id: shopId },
      data: { usageThisCycle: 0, cycleStart: now },
    });
    return { cycleStart: now, usageThisCycle: 0 };
  }

  return { cycleStart: shop.cycleStart, usageThisCycle: shop.usageThisCycle };
}

