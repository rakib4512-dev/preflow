import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateOverageCost,
  nextTierPriceDiff,
  usagePercent,
  PLANS,
  OVERAGE_RATE,
} from "../billing.server";
import type { Plan } from "@prisma/client";

// Isolate from Prisma and Resend at module level
vi.mock("../../db.server", () => ({
  default: {
    billingEvent: { create: vi.fn() },
    shop: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn() };
  },
}));

describe("PLANS constant", () => {
  it("FREE has limit 10", () => expect(PLANS.FREE.monthlyLimit).toBe(10));
  it("GROWTH has limit 300 at $15", () => {
    expect(PLANS.GROWTH.monthlyLimit).toBe(300);
    expect(PLANS.GROWTH.price).toBe(15);
  });
  it("PRO is unlimited at $29", () => {
    expect(PLANS.PRO.monthlyLimit).toBe(Infinity);
    expect(PLANS.PRO.price).toBe(29);
  });
});

describe("nextTierPriceDiff", () => {
  it("FREE → GROWTH = $15", () => expect(nextTierPriceDiff("FREE")).toBe(15));
  it("GROWTH → PRO = $14", () => expect(nextTierPriceDiff("GROWTH")).toBe(14));
  it("PRO has Infinity cap", () => expect(nextTierPriceDiff("PRO")).toBe(Infinity));
});

describe("calculateOverageCost", () => {
  it("zero overage costs nothing", () => {
    expect(calculateOverageCost("FREE", 0)).toBe(0);
    expect(calculateOverageCost("GROWTH", 0)).toBe(0);
  });

  it("small overage on FREE is $0.05/order", () => {
    expect(calculateOverageCost("FREE", 1)).toBe(0.05);
    expect(calculateOverageCost("FREE", 10)).toBe(0.5);
  });

  it("overage on FREE is capped at $15 (price diff to GROWTH)", () => {
    // 400 orders * $0.05 = $20, but cap is $15
    expect(calculateOverageCost("FREE", 400)).toBe(15);
  });

  it("overage on GROWTH is capped at $14 (price diff to PRO)", () => {
    // 400 orders * $0.05 = $20, cap is $14
    expect(calculateOverageCost("GROWTH", 400)).toBe(14);
  });

  it("overage exactly at cap boundary (FREE, 300 orders = $15)", () => {
    // 300 * 0.05 = 15 exactly hits the cap
    expect(calculateOverageCost("FREE", 300)).toBe(15);
  });

  it("PRO has no overage because limit is Infinity", () => {
    expect(calculateOverageCost("PRO", 1000)).toBe(0);
  });
});

describe("usagePercent", () => {
  it("returns 0% for 0 usage", () => {
    expect(usagePercent(0, "FREE")).toBe(0);
  });

  it("returns 50% at half the FREE limit", () => {
    expect(usagePercent(5, "FREE")).toBe(50);
  });

  it("returns 100% at the limit", () => {
    expect(usagePercent(10, "FREE")).toBe(100);
  });

  it("returns > 100% when over limit (no capping — caller decides)", () => {
    expect(usagePercent(15, "FREE")).toBeGreaterThan(100);
  });

  it("returns 0% for PRO (unlimited)", () => {
    expect(usagePercent(999999, "PRO")).toBe(0);
  });

  it("returns correct percent for GROWTH", () => {
    expect(usagePercent(150, "GROWTH")).toBe(50);
    expect(usagePercent(210, "GROWTH")).toBe(70);
  });
});

describe("OVERAGE_RATE", () => {
  it("is $0.05", () => expect(OVERAGE_RATE).toBe(0.05));
});
