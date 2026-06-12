import prisma from "../../db.server";
import { upsertShop } from "../../lib/shop.server";

type ProductPayload = {
  admin_graphql_api_id: string;
  variants?: Array<{ admin_graphql_api_id: string }>;
};

// Keeps configs in sync with the product: when a merchant deletes a variant,
// any variant-level pre-order config pointing at it is disabled so the proxy
// and dashboard stop reporting a pre-order for a variant that no longer exists.
export async function handleProductUpdate(
  shop: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const product = payload as unknown as ProductPayload;
  const productId = product.admin_graphql_api_id;
  const shopRecord = await upsertShop(shop);

  const variantConfigs = await prisma.preorderConfig.findMany({
    where: { shopId: shopRecord.id, productId, enabled: true, NOT: { variantId: "" } },
    select: { id: true, variantId: true },
  });
  if (variantConfigs.length === 0) return;

  const liveVariantGids = new Set(
    (product.variants ?? []).map((v) => v.admin_graphql_api_id),
  );
  // Payload without variants tells us nothing — don't mass-disable on it
  if (liveVariantGids.size === 0) return;

  const orphaned = variantConfigs.filter((c) => !liveVariantGids.has(c.variantId));
  if (orphaned.length === 0) return;

  await prisma.preorderConfig.updateMany({
    where: { id: { in: orphaned.map((c) => c.id) } },
    data: { enabled: false },
  });
  console.log(
    `[product-sync] Disabled ${orphaned.length} orphaned variant config(s) for ${productId} on ${shop}`,
  );
}

export async function handleProductDelete(
  shop: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const product = payload as unknown as ProductPayload;
  const productId = product.admin_graphql_api_id;
  const shopRecord = await upsertShop(shop);

  await prisma.preorderConfig.updateMany({
    where: { shopId: shopRecord.id, productId },
    data: { enabled: false, sellingPlanGid: null, sellingPlanId: null },
  });
}
