// Pure constants and functions — safe to import from both server and client code

export type Plan = "FREE" | "GROWTH" | "PRO";

export const PLANS = {
  FREE: { name: "Free Plan", monthlyLimit: 10, price: 0 },
  GROWTH: { name: "Growth Plan", monthlyLimit: 300, price: 15 },
  PRO: { name: "Pro Plan", monthlyLimit: Infinity, price: 29 },
} as const satisfies Record<Plan, { name: string; monthlyLimit: number; price: number }>;

export const OVERAGE_RATE = 0.05;

export function nextTierPriceDiff(plan: Plan): number {
  if (plan === "FREE") return PLANS.GROWTH.price - PLANS.FREE.price;
  if (plan === "GROWTH") return PLANS.PRO.price - PLANS.GROWTH.price;
  return Infinity;
}

export function calculateOverageCost(plan: Plan, overage: number): number {
  if (overage <= 0) return 0;
  if (PLANS[plan].monthlyLimit === Infinity) return 0;
  const tierDiff = nextTierPriceDiff(plan);
  return Math.min(overage * OVERAGE_RATE, tierDiff);
}

export function usagePercent(usageThisCycle: number, plan: Plan): number {
  const limit = PLANS[plan].monthlyLimit;
  if (limit === Infinity) return 0;
  return (usageThisCycle / limit) * 100;
}
