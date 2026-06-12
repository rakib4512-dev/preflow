import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Prisma mock (vi.hoisted so variables are available inside vi.mock factory) ---
const { mockUpsert, mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("../../db.server", () => ({
  default: {
    preorderConfig: {
      upsert: mockUpsert,
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

import { enablePreorder, disablePreorder } from "../preorder-saga.server";

// --- Build admin mock helpers ---
function makeAdminMock(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const gql = overrides.graphql ?? vi.fn();
  return { graphql: gql } as unknown as Parameters<typeof enablePreorder>[0]["admin"];
}

function sellingPlanResponse(
  groupGid = "gid://shopify/SellingPlanGroup/1",
  planGid = "gid://shopify/SellingPlan/11",
) {
  return Promise.resolve({
    json: () =>
      Promise.resolve({
        data: {
          sellingPlanGroupCreate: {
            sellingPlanGroup: { id: groupGid, sellingPlans: { nodes: [{ id: planGid }] } },
            userErrors: [],
          },
        },
      }),
  });
}

function variantPoliciesResponse(policy = "DENY") {
  return Promise.resolve({
    json: () =>
      Promise.resolve({
        data: {
          product: {
            variants: {
              nodes: [{ id: "gid://shopify/ProductVariant/101", inventoryPolicy: policy }],
            },
          },
        },
      }),
  });
}

function bulkUpdateResponse() {
  return Promise.resolve({
    json: () =>
      Promise.resolve({
        data: {
          productVariantsBulkUpdate: {
            productVariants: [{ id: "gid://shopify/ProductVariant/101" }],
            userErrors: [],
          },
        },
      }),
  });
}

function metafieldResponse() {
  return Promise.resolve({
    json: () =>
      Promise.resolve({ data: { metafieldsSet: { metafields: [], userErrors: [] } } }),
  });
}

function metafieldsDeleteResponse() {
  return Promise.resolve({
    json: () =>
      Promise.resolve({ data: { metafieldsDelete: { deletedMetafields: [], userErrors: [] } } }),
  });
}

function tagResponse() {
  return Promise.resolve({
    json: () =>
      Promise.resolve({ data: { tagsAdd: { node: { id: "gid://shopify/Product/1" }, userErrors: [] } } }),
  });
}

function sellingPlanDeleteResponse() {
  return Promise.resolve({
    json: () =>
      Promise.resolve({ data: { sellingPlanGroupDelete: { deletedSellingPlanGroupId: "gid://shopify/SellingPlanGroup/1", userErrors: [] } } }),
  });
}

const baseInput = {
  shopId: "shop-1",
  shopDomain: "test.myshopify.com",
  productId: "gid://shopify/Product/1",
  message: "Pre-order now",
  shipDate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(null);
});

describe("enablePreorder saga", () => {
  it("returns success and sellingPlanGid on happy path", async () => {
    const gqlMock = vi.fn()
      .mockImplementationOnce(() => sellingPlanResponse())      // createSellingPlanGroup
      .mockImplementationOnce(() => variantPoliciesResponse())  // fetchVariantPolicies
      .mockImplementationOnce(() => bulkUpdateResponse())       // setVariantInventoryPolicy → CONTINUE
      .mockImplementationOnce(() => metafieldResponse())        // metafieldsSet
      .mockImplementationOnce(() => metafieldsDeleteResponse()) // ship_date delete (no shipDate)
      .mockImplementationOnce(() => tagResponse());             // tagProduct

    mockUpsert.mockResolvedValue({});

    const result = await enablePreorder({ ...baseInput, admin: makeAdminMock({ graphql: gqlMock }) });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.sellingPlanGid).toBe("gid://shopify/SellingPlanGroup/1");
    }
    expect(mockUpsert).toHaveBeenCalledOnce();
    // Upsert persists the numeric selling plan ID and the policy snapshot
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.create.sellingPlanId).toBe("11");
    expect(upsertArg.create.policySnapshot).toEqual([
      { id: "gid://shopify/ProductVariant/101", policy: "DENY" },
    ]);
  });

  it("rolls back metafields, inventory policy, and selling plan group if DB upsert fails", async () => {
    const gqlMock = vi.fn()
      .mockImplementationOnce(() => sellingPlanResponse())      // createSellingPlanGroup
      .mockImplementationOnce(() => variantPoliciesResponse())  // fetchVariantPolicies
      .mockImplementationOnce(() => bulkUpdateResponse())       // set CONTINUE
      .mockImplementationOnce(() => metafieldResponse())        // metafieldsSet
      .mockImplementationOnce(() => metafieldsDeleteResponse()) // ship_date delete
      .mockImplementationOnce(() => metafieldsDeleteResponse()) // rollback: clearPreorderMetafields
      .mockImplementationOnce(() => bulkUpdateResponse())       // rollback: restore DENY
      .mockImplementationOnce(() => sellingPlanDeleteResponse()); // rollback: delete created group

    mockUpsert.mockRejectedValue(new Error("DB connection error"));

    const result = await enablePreorder({ ...baseInput, admin: makeAdminMock({ graphql: gqlMock }) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("DB connection error");
    }
    expect(gqlMock).toHaveBeenCalledTimes(8);
  });

  it("fails gracefully when selling plan creation returns userErrors", async () => {
    const gqlMock = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: {
            sellingPlanGroupCreate: {
              sellingPlanGroup: null,
              userErrors: [{ field: "name", message: "Name taken" }],
            },
          },
        }),
    });

    const result = await enablePreorder({ ...baseInput, admin: makeAdminMock({ graphql: gqlMock }) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Selling plan creation failed");
    }
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("does not tag product or write DB if metafield write fails", async () => {
    const gqlMock = vi.fn()
      .mockImplementationOnce(() => sellingPlanResponse())
      .mockImplementationOnce(() => variantPoliciesResponse())
      .mockImplementationOnce(() => bulkUpdateResponse())
      .mockImplementationOnce(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              data: { metafieldsSet: { metafields: [], userErrors: [{ field: "value", message: "Invalid" }] } },
            }),
        }),
      )
      // rollback path: clearMetafields, restore policy, delete group
      .mockImplementationOnce(() => metafieldsDeleteResponse())
      .mockImplementationOnce(() => bulkUpdateResponse())
      .mockImplementationOnce(() => sellingPlanDeleteResponse());

    const result = await enablePreorder({ ...baseInput, admin: makeAdminMock({ graphql: gqlMock }) });

    expect(result.success).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("reuses the existing selling plan group on re-enable", async () => {
    mockFindUnique.mockResolvedValue({
      sellingPlanGid: "gid://shopify/SellingPlanGroup/1",
      sellingPlanId: "11",
      policySnapshot: [{ id: "gid://shopify/ProductVariant/101", policy: "DENY" }],
    });

    const gqlMock = vi.fn()
      .mockImplementationOnce(() => variantPoliciesResponse("CONTINUE")) // fetch
      .mockImplementationOnce(() => bulkUpdateResponse())                // set CONTINUE
      .mockImplementationOnce(() => metafieldResponse())                 // metafieldsSet
      .mockImplementationOnce(() => metafieldsDeleteResponse())          // ship_date delete
      .mockImplementationOnce(() => tagResponse());                      // tag

    mockUpsert.mockResolvedValue({});

    const result = await enablePreorder({ ...baseInput, admin: makeAdminMock({ graphql: gqlMock }) });

    expect(result.success).toBe(true);
    // No sellingPlanGroupCreate call — group reused
    const calls = gqlMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((q) => q.includes("sellingPlanGroupCreate"))).toBe(false);
    // Original snapshot (DENY) preserved, not overwritten by current CONTINUE state
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.update.policySnapshot).toEqual([
      { id: "gid://shopify/ProductVariant/101", policy: "DENY" },
    ]);
  });
});

describe("disablePreorder saga", () => {
  it("returns success true when no config exists", async () => {
    mockFindUnique.mockResolvedValue(null);

    const gqlMock = vi.fn();
    const result = await disablePreorder({
      ...baseInput,
      admin: makeAdminMock({ graphql: gqlMock }),
    });

    expect(result.success).toBe(true);
    expect(gqlMock).not.toHaveBeenCalled();
  });

  it("clears metafields, deletes selling plan, restores inventory policy, and updates DB", async () => {
    mockFindUnique.mockResolvedValue({
      sellingPlanGid: "gid://shopify/SellingPlanGroup/1",
      sellingPlanId: "11",
      policySnapshot: [{ id: "gid://shopify/ProductVariant/101", policy: "DENY" }],
      shopId: "shop-1",
      productId: "gid://shopify/Product/1",
      variantId: "",
    });
    mockUpdate.mockResolvedValue({});

    const gqlMock = vi.fn()
      .mockImplementationOnce(() => metafieldsDeleteResponse())   // clearMetafields
      .mockImplementationOnce(() => sellingPlanDeleteResponse())  // deleteSellingPlanGroup
      .mockImplementationOnce(() => bulkUpdateResponse());        // restore DENY

    const result = await disablePreorder({
      ...baseInput,
      admin: makeAdminMock({ graphql: gqlMock }),
    });

    expect(result.success).toBe(true);
    expect(gqlMock).toHaveBeenCalledTimes(3);
    expect(mockUpdate).toHaveBeenCalledOnce();
    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg.data.sellingPlanId).toBeNull();
  });
});

