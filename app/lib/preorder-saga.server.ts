import prisma from "../db.server";
import { Prisma } from "@prisma/client";

export interface AdminGraphQL {
  graphql(
    query: string,
    options?: { variables?: unknown },
  ): Promise<{ json(): Promise<unknown> }>;
}

export type EnablePreorderInput = {
  shopId: string;
  shopDomain: string;
  productId: string;
  variantId?: string;
  message: string;
  shipDate: Date | null;
  admin: AdminGraphQL;
};

export type DisablePreorderInput = {
  shopId: string;
  shopDomain: string;
  productId: string;
  variantId?: string;
  admin: AdminGraphQL;
};

export type UpdatePreorderInput = {
  shopId: string;
  productId: string;
  variantId?: string;
  message: string;
  shipDate: Date | null;
  admin: AdminGraphQL;
};

export type UpdatePreorderResult =
  | { success: true; oldShipDate: Date | null; newShipDate: Date | null }
  | { success: false; error: string };

export type SagaResult =
  | { success: true; sellingPlanGid: string }
  | { success: false; error: string };

const METAFIELD_NAMESPACE = "$app:preorder";

type PolicySnapshot = Array<{ id: string; policy: string }>;

export async function enablePreorder(input: EnablePreorderInput): Promise<SagaResult> {
  const { shopId, productId, variantId = "", message, shipDate, admin } = input;
  const normalizedVariantId = variantId || "";

  let sellingPlanGid: string | null = null;
  let sellingPlanId: string | null = null;
  let createdGroupThisCall = false;
  let metafieldsWritten = false;
  let policySnapshot: PolicySnapshot | null = null;
  let existing: { sellingPlanGid: string | null; sellingPlanId: string | null; policySnapshot: unknown } | null = null;

  try {
    // Reuse an existing selling plan group on re-enable instead of leaking a
    // new group each time. Inside the try so DB errors (e.g. missing columns
    // when migrations haven't run) surface as a result, not a 500.
    existing = await prisma.preorderConfig.findUnique({
      where: {
        shopId_productId_variantId: { shopId, productId, variantId: normalizedVariantId },
      },
      select: { sellingPlanGid: true, sellingPlanId: true, policySnapshot: true },
    });
    sellingPlanGid = existing?.sellingPlanGid ?? null;
    sellingPlanId = existing?.sellingPlanId ?? null;

    // Step 1: Create selling plan group (unless one already exists)
    if (!sellingPlanGid || !sellingPlanId) {
      const created = await createSellingPlanGroup(admin, productId, message);
      sellingPlanGid = created.groupGid;
      sellingPlanId = created.planId;
      createdGroupThisCall = true;
    }

    // Step 2: Snapshot variant inventory policies, then set CONTINUE so
    // out-of-stock items remain orderable (core pre-order behavior).
    // Skip the snapshot if one already exists (re-enable) — it holds the
    // merchant's true original policies.
    const variants = await fetchVariantPolicies(admin, productId, normalizedVariantId);
    policySnapshot = (existing?.policySnapshot as PolicySnapshot | null) ?? variants;
    await setVariantInventoryPolicy(
      admin,
      productId,
      variants.map((v) => v.id),
      "CONTINUE",
    );

    // Step 3: Write metafields (product-level if no variant, otherwise variant)
    await writePreorderMetafields(admin, productId, normalizedVariantId, {
      enabled: true,
      message,
      shipDate: shipDate?.toISOString() ?? null,
      sellingPlanId,
    });
    metafieldsWritten = true;

    // Step 4: Upsert DB config
    await prisma.preorderConfig.upsert({
      where: {
        shopId_productId_variantId: { shopId, productId, variantId: normalizedVariantId },
      },
      create: {
        shopId,
        productId,
        variantId: normalizedVariantId,
        enabled: true,
        message,
        shipDate,
        sellingPlanGid,
        sellingPlanId,
        policySnapshot,
      },
      update: {
        enabled: true,
        message,
        shipDate,
        sellingPlanGid,
        sellingPlanId,
        policySnapshot,
      },
    });

    // Step 5: Tag product
    await tagProduct(admin, productId, "preorder");

    return { success: true, sellingPlanGid };
  } catch (err) {
    // Rollback: remove metafields so storefront never shows half-state
    if (metafieldsWritten) {
      await clearPreorderMetafields(admin, productId, normalizedVariantId).catch(() => {});
    }
    // Restore inventory policies if we changed them
    if (policySnapshot) {
      await restoreVariantInventoryPolicy(admin, productId, policySnapshot).catch(() => {});
    }
    // Delete the selling plan group only if this call created it
    if (createdGroupThisCall && sellingPlanGid) {
      await deleteSellingPlanGroup(admin, sellingPlanGid).catch(() => {});
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function disablePreorder(input: DisablePreorderInput): Promise<SagaResult> {
  const { shopId, productId, variantId = "", admin } = input;
  const normalizedVariantId = variantId || "";

  const config = await prisma.preorderConfig.findUnique({
    where: {
      shopId_productId_variantId: { shopId, productId, variantId: normalizedVariantId },
    },
  });

  if (!config) return { success: true, sellingPlanGid: "" };

  // Clear metafields first so the storefront immediately stops showing the button
  await clearPreorderMetafields(admin, productId, normalizedVariantId).catch(() => {});

  // Remove selling plan group if present
  if (config.sellingPlanGid) {
    await deleteSellingPlanGroup(admin, config.sellingPlanGid).catch(() => {});
  }

  // Restore the merchant's original inventory policies
  const snapshot = config.policySnapshot as PolicySnapshot | null;
  if (snapshot && snapshot.length > 0) {
    await restoreVariantInventoryPolicy(admin, productId, snapshot).catch(() => {});
  }

  await prisma.preorderConfig.update({
    where: {
      shopId_productId_variantId: { shopId, productId, variantId: normalizedVariantId },
    },
    data: { enabled: false, sellingPlanGid: null, sellingPlanId: null, policySnapshot: Prisma.JsonNull },
  });

  return { success: true, sellingPlanGid: "" };
}

export async function updatePreorder(input: UpdatePreorderInput): Promise<UpdatePreorderResult> {
  const { shopId, productId, variantId = "", message, shipDate, admin } = input;
  const normalizedVariantId = variantId || "";

  const config = await prisma.preorderConfig.findUnique({
    where: { shopId_productId_variantId: { shopId, productId, variantId: normalizedVariantId } },
    select: { id: true, shipDate: true, sellingPlanId: true, enabled: true },
  });

  if (!config) return { success: false, error: "Pre-order config not found" };
  // Never write enabled:true metafields for a disabled config — that would
  // resurrect the storefront button with no selling plan behind it.
  if (!config.enabled) {
    return { success: false, error: "Pre-order is disabled for this product. Enable it first." };
  }

  const oldShipDate = config.shipDate;

  try {
    await writePreorderMetafields(admin, productId, normalizedVariantId, {
      enabled: true,
      message,
      shipDate: shipDate?.toISOString() ?? null,
      sellingPlanId: config.sellingPlanId,
    });

    await prisma.preorderConfig.update({
      where: { shopId_productId_variantId: { shopId, productId, variantId: normalizedVariantId } },
      data: { message, shipDate },
    });

    return { success: true, oldShipDate, newShipDate: shipDate };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// --- GraphQL helpers ---

async function createSellingPlanGroup(
  admin: AdminGraphQL,
  productId: string,
  _message: string,
): Promise<{ groupGid: string; planId: string }> {
  const res = await admin.graphql(
    `#graphql
    mutation CreateSellingPlanGroup($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput!) {
      sellingPlanGroupCreate(input: $input, resources: $resources) {
        sellingPlanGroup {
          id
          sellingPlans(first: 1) {
            nodes { id }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          name: "Pre-order",
          merchantCode: "preorder",
          options: ["Pre-order"],
          sellingPlansToCreate: [
            {
              name: "Pre-order: Full payment at checkout",
              options: ["Pre-order"],
              category: "PRE_ORDER",
              billingPolicy: {
                fixed: {
                  checkoutCharge: { type: "PERCENTAGE", value: { percentage: 100 } },
                  remainingBalanceChargeExactTime: null,
                  remainingBalanceChargeTrigger: "NO_REMAINING_BALANCE",
                },
              },
              deliveryPolicy: {
                fixed: {
                  fulfillmentTrigger: "UNKNOWN",
                },
              },
            },
          ],
        },
        resources: {
          productIds: [productId],
        },
      },
    },
  );

  const json = (await res.json()) as {
    data?: {
      sellingPlanGroupCreate?: {
        sellingPlanGroup?: { id: string; sellingPlans?: { nodes: Array<{ id: string }> } } | null;
        userErrors: Array<{ field: string; message: string }>;
      };
    };
  };
  const errors = json.data?.sellingPlanGroupCreate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`Selling plan creation failed: ${JSON.stringify(errors)}`);
  }

  const group = json.data?.sellingPlanGroupCreate?.sellingPlanGroup;
  const gid: string | undefined = group?.id;
  const planGid: string | undefined = group?.sellingPlans?.nodes?.[0]?.id;
  if (!gid || !planGid) throw new Error("Selling plan group/plan ID missing from response");
  // Storefront cart param wants the numeric ID, not the GID
  return { groupGid: gid, planId: planGid.split("/").pop()! };
}

// --- Inventory policy helpers ---

async function fetchVariantPolicies(
  admin: AdminGraphQL,
  productId: string,
  variantId: string,
): Promise<PolicySnapshot> {
  const res = await admin.graphql(
    `#graphql
    query VariantPolicies($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          nodes { id inventoryPolicy }
        }
      }
    }`,
    { variables: { id: productId } },
  );
  const json = (await res.json()) as {
    data?: { product?: { variants: { nodes: Array<{ id: string; inventoryPolicy: string }> } } | null };
  };
  const all = json.data?.product?.variants.nodes ?? [];
  const scoped = variantId ? all.filter((v) => v.id === variantId) : all;
  return scoped.map((v) => ({ id: v.id, policy: v.inventoryPolicy }));
}

async function setVariantInventoryPolicy(
  admin: AdminGraphQL,
  productId: string,
  variantIds: string[],
  policy: "CONTINUE" | "DENY",
): Promise<void> {
  if (variantIds.length === 0) return;
  const res = await admin.graphql(
    `#graphql
    mutation SetInventoryPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        productId,
        variants: variantIds.map((id) => ({ id, inventoryPolicy: policy })),
      },
    },
  );
  const json = (await res.json()) as {
    data?: { productVariantsBulkUpdate?: { userErrors: Array<{ field: string; message: string }> } };
  };
  const errors = json.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`Inventory policy update failed: ${JSON.stringify(errors)}`);
  }
}

async function restoreVariantInventoryPolicy(
  admin: AdminGraphQL,
  productId: string,
  snapshot: PolicySnapshot,
): Promise<void> {
  // Only restore variants that weren't already CONTINUE before we touched them
  const toRestore = snapshot.filter((s) => s.policy !== "CONTINUE");
  if (toRestore.length === 0) return;
  await admin.graphql(
    `#graphql
    mutation RestoreInventoryPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        productId,
        variants: toRestore.map((s) => ({ id: s.id, inventoryPolicy: s.policy })),
      },
    },
  );
}

async function deleteSellingPlanGroup(
  admin: AdminGraphQL,
  sellingPlanGroupGid: string,
): Promise<void> {
  await admin.graphql(
    `#graphql
    mutation DeleteSellingPlanGroup($id: ID!) {
      sellingPlanGroupDelete(id: $id) {
        deletedSellingPlanGroupId
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { id: sellingPlanGroupGid } },
  );
}

async function writePreorderMetafields(
  admin: AdminGraphQL,
  productId: string,
  variantId: string,
  data: { enabled: boolean; message: string; shipDate: string | null; sellingPlanId?: string | null },
): Promise<void> {
  const ownerId = variantId || productId;
  const metafields: Array<{ ownerId: string; namespace: string; key: string; value: string; type: string }> = [
    {
      ownerId,
      namespace: METAFIELD_NAMESPACE,
      key: "enabled",
      value: String(data.enabled),
      type: "boolean",
    },
    {
      ownerId,
      namespace: METAFIELD_NAMESPACE,
      key: "message",
      value: data.message,
      type: "single_line_text_field",
    },
  ];
  // Numeric selling plan ID — rendered into the storefront form as the
  // `selling_plan` cart parameter so checkout actually uses the pre-order plan.
  if (data.sellingPlanId) {
    metafields.push({
      ownerId: productId, // selling plan applies product-wide; always store on the product
      namespace: METAFIELD_NAMESPACE,
      key: "selling_plan_id",
      value: data.sellingPlanId,
      type: "single_line_text_field",
    });
  }
  // Shopify rejects blank single_line_text_field values — only set when non-empty
  if (data.shipDate) {
    metafields.push({
      ownerId,
      namespace: METAFIELD_NAMESPACE,
      key: "ship_date",
      value: data.shipDate,
      type: "single_line_text_field",
    });
  }

  const res = await admin.graphql(
    `#graphql
    mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key }
        userErrors { field message }
      }
    }`,
    { variables: { metafields } },
  );

  const json = (await res.json()) as { data?: { metafieldsSet?: { metafields: unknown[]; userErrors: Array<{ field: string; message: string }> } } };
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`Metafield write failed: ${JSON.stringify(errors)}`);
  }

  // When no ship_date, delete any previously stored value so Liquid shows the
  // "Ships when available" fallback instead of a stale date.
  if (!data.shipDate) {
    await admin.graphql(
      `#graphql
      mutation DeleteShipDate($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields { key }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [{ ownerId, namespace: METAFIELD_NAMESPACE, key: "ship_date" }],
        },
      },
    ).catch(() => {}); // non-fatal — metafield may not exist yet
  }
}

async function clearPreorderMetafields(
  admin: AdminGraphQL,
  productId: string,
  variantId: string,
): Promise<void> {
  const ownerId = variantId || productId;
  // DELETE all three metafields instead of writing blank values.
  // Writing message="" or ship_date="" would fail Shopify's blank-value validation.
  // Deletion makes the metafields nil in Liquid, so the pre-order block is
  // unconditionally hidden without needing a cache flush.
  await admin.graphql(
    `#graphql
    mutation ClearPreorderMetafields($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { key }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          { ownerId, namespace: METAFIELD_NAMESPACE, key: "enabled" },
          { ownerId, namespace: METAFIELD_NAMESPACE, key: "message" },
          { ownerId, namespace: METAFIELD_NAMESPACE, key: "ship_date" },
          { ownerId: productId, namespace: METAFIELD_NAMESPACE, key: "selling_plan_id" },
        ],
      },
    },
  );
}

async function tagProduct(
  admin: AdminGraphQL,
  productId: string,
  tag: string,
): Promise<void> {
  await admin.graphql(
    `#graphql
    mutation TagProduct($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }`,
    { variables: { id: productId, tags: [tag] } },
  );
}

