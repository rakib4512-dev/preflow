import { describe, it, expect, vi, beforeEach } from "vitest";

// All mocks must be hoisted so their variables are available in vi.mock factories.
const {
  mockShopFindUnique,
  mockNotifFindUnique,
  mockNotifCreate,
  mockOrderFindMany,
  mockGraphql,
} = vi.hoisted(() => ({
  mockShopFindUnique: vi.fn(),
  mockNotifFindUnique: vi.fn(),
  mockNotifCreate: vi.fn(),
  mockOrderFindMany: vi.fn(),
  mockGraphql: vi.fn(),
}));

vi.mock("../../db.server", () => ({
  default: {
    shop: { findUnique: mockShopFindUnique },
    preorderOrder: { findMany: mockOrderFindMany },
    customerNotification: { findUnique: mockNotifFindUnique, create: mockNotifCreate },
  },
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn().mockResolvedValue({ id: "email-id" }) };
  },
}));

vi.mock("../../shopify.server", () => ({
  unauthenticated: {
    admin: vi.fn().mockResolvedValue({ admin: { graphql: mockGraphql } }),
  },
}));

vi.mock("../buyer-token.server", () => ({
  createBuyerToken: vi.fn().mockReturnValue("mock-token"),
}));

import { handleShipDateNotify } from "../../jobs/handlers/ship-date-notify.server";

const baseJobData = {
  shopId: "shop-1",
  shopDomain: "test.myshopify.com",
  configId: "config-1",
  productGid: "gid://shopify/Product/100",
  variantGid: "",
  oldDate: "2026-06-01T00:00:00.000Z",
  newDate: "2026-07-01T00:00:00.000Z",
  productTitle: "Cool Widget",
};

function orderDetails(status: string, email: string | null = "buyer@example.com") {
  return {
    json: () =>
      Promise.resolve({
        data: {
          order: { email, displayFulfillmentStatus: status, statusPageUrl: null },
        },
      }),
  };
}

// Reset only the hoisted mocks before each test so queued mockResolvedValueOnce
// responses from a previous test don't bleed into the next one.
// (vi.clearAllMocks only clears call history, not the response queue.)
beforeEach(() => {
  mockShopFindUnique.mockReset();
  mockNotifFindUnique.mockReset();
  mockNotifCreate.mockReset();
  mockOrderFindMany.mockReset();
  mockGraphql.mockReset();
  process.env.SHOPIFY_APP_URL = "https://app.example.com";
});

describe("handleShipDateNotify", () => {
  it("skips orders that don't match the product", async () => {
    mockShopFindUnique.mockResolvedValue({ settings: {} });
    mockOrderFindMany.mockResolvedValueOnce([
      { id: "o1", orderGid: "gid://shopify/Order/1", lineItems: [{ product_id: 999, variant_id: null }] },
    ]).mockResolvedValueOnce([]);

    await handleShipDateNotify(baseJobData);

    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockNotifCreate).not.toHaveBeenCalled();
  });

  it("sends email and logs notification for an unfulfilled matching order", async () => {
    mockShopFindUnique.mockResolvedValue({ settings: {} });
    mockNotifFindUnique.mockResolvedValue(null); // no existing notification
    mockOrderFindMany
      .mockResolvedValueOnce([
        { id: "o2", orderGid: "gid://shopify/Order/2", lineItems: [{ product_id: 100, variant_id: null }] },
      ])
      .mockResolvedValueOnce([]);
    mockGraphql.mockResolvedValueOnce(orderDetails("UNFULFILLED"));
    mockNotifCreate.mockResolvedValue({});

    await handleShipDateNotify(baseJobData);

    expect(mockGraphql).toHaveBeenCalledOnce();
    expect(mockNotifCreate).toHaveBeenCalledOnce();
    const arg = mockNotifCreate.mock.calls[0][0];
    expect(arg.data.type).toBe("ship_date_delay");
    expect(arg.data.dedupeKey).toBe("config-1:2026-07-01T00:00:00.000Z:gid://shopify/Order/2");
  });

  it("skips already-fulfilled orders", async () => {
    mockShopFindUnique.mockResolvedValue({ settings: {} });
    mockNotifFindUnique.mockResolvedValue(null);
    mockOrderFindMany
      .mockResolvedValueOnce([
        { id: "o3", orderGid: "gid://shopify/Order/3", lineItems: [{ product_id: 100, variant_id: null }] },
      ])
      .mockResolvedValueOnce([]);
    mockGraphql.mockResolvedValueOnce(orderDetails("FULFILLED"));

    await handleShipDateNotify(baseJobData);

    expect(mockNotifCreate).not.toHaveBeenCalled();
  });

  it("skips orders with no customer email", async () => {
    mockShopFindUnique.mockResolvedValue({ settings: {} });
    mockNotifFindUnique.mockResolvedValue(null);
    mockOrderFindMany
      .mockResolvedValueOnce([
        { id: "o4", orderGid: "gid://shopify/Order/4", lineItems: [{ product_id: 100, variant_id: null }] },
      ])
      .mockResolvedValueOnce([]);
    mockGraphql.mockResolvedValueOnce(orderDetails("UNFULFILLED", null));

    await handleShipDateNotify(baseJobData);

    expect(mockNotifCreate).not.toHaveBeenCalled();
  });

  it("dedupes: skips order already in CustomerNotification", async () => {
    mockShopFindUnique.mockResolvedValue({ settings: {} });
    mockNotifFindUnique.mockResolvedValue({ id: "notif-existing" }); // already notified
    mockOrderFindMany
      .mockResolvedValueOnce([
        { id: "o5", orderGid: "gid://shopify/Order/5", lineItems: [{ product_id: 100, variant_id: null }] },
      ])
      .mockResolvedValueOnce([]);

    await handleShipDateNotify(baseJobData);

    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockNotifCreate).not.toHaveBeenCalled();
  });

  it("matches on variantId when the config is variant-scoped", async () => {
    const variantJob = { ...baseJobData, variantGid: "gid://shopify/ProductVariant/200" };
    mockShopFindUnique.mockResolvedValue({ settings: {} });
    mockNotifFindUnique.mockResolvedValue(null);
    mockOrderFindMany
      .mockResolvedValueOnce([
        { id: "o6", orderGid: "gid://shopify/Order/6", lineItems: [{ product_id: 100, variant_id: 200 }] },
      ])
      .mockResolvedValueOnce([]);
    mockGraphql.mockResolvedValueOnce(orderDetails("UNFULFILLED"));
    mockNotifCreate.mockResolvedValue({});

    await handleShipDateNotify(variantJob);

    expect(mockNotifCreate).toHaveBeenCalledOnce();
  });

  it("does NOT match when variant IDs differ", async () => {
    const variantJob = { ...baseJobData, variantGid: "gid://shopify/ProductVariant/200" };
    mockShopFindUnique.mockResolvedValue({ settings: {} });
    mockOrderFindMany
      .mockResolvedValueOnce([
        { id: "o7", orderGid: "gid://shopify/Order/7", lineItems: [{ product_id: 100, variant_id: 999 }] },
      ])
      .mockResolvedValueOnce([]);

    await handleShipDateNotify(variantJob);

    expect(mockGraphql).not.toHaveBeenCalled();
  });
});
