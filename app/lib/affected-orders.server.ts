import prisma from "../db.server";

const PAGE_SIZE = 200;

/**
 * Counts pre-orders whose line items actually contain the given product (or
 * variant). lineItems is a JSON column, so filtering happens in JS — paginated
 * to keep memory bounded.
 */
export async function countAffectedPreorders(
  shopId: string,
  productGid: string,
  variantGid: string,
): Promise<number> {
  const numericProductId = extractNumericId(productGid);
  const numericVariantId = variantGid ? extractNumericId(variantGid) : null;

  let cursor: string | undefined;
  let count = 0;

  for (;;) {
    const orders = await prisma.preorderOrder.findMany({
      where: { shopId },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: { id: true, lineItems: true },
    });

    if (orders.length === 0) break;

    for (const order of orders) {
      const lineItems = order.lineItems as Array<{
        product_id?: number | null;
        variant_id?: number | null;
      }>;
      const matches = lineItems.some((li) => {
        if (numericVariantId) return li.variant_id != null && String(li.variant_id) === numericVariantId;
        return li.product_id != null && String(li.product_id) === numericProductId;
      });
      if (matches) count++;
    }

    cursor = orders[orders.length - 1].id;
    if (orders.length < PAGE_SIZE) break;
  }

  return count;
}

function extractNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}
