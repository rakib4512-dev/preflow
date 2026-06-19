import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

type CacheEntry = {
  value: StateResponse;
  expiresAt: number;
};

type StateResponse = {
  enabled: boolean;
  message: string;
  ship_date: string | null;
  selling_plan_id: string | null;
  discount_percent: number | null;
};

const DISABLED: StateResponse = {
  enabled: false,
  message: "",
  ship_date: null,
  selling_plan_id: null,
  discount_percent: null,
};

function jsonRes(data: unknown, init?: number | { status?: number; headers?: Record<string, string> }): Response {
  const status = typeof init === "number" ? init : (init?.status ?? 200);
  const extra = typeof init === "object" ? (init?.headers ?? {}) : {};
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 30_000;

function getCached(key: string): StateResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key: string, value: StateResponse): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Verifies Shopify's HMAC signature for App Proxy requests
  const context = await authenticate.public.appProxy(request);

  // Session may be undefined if the customer isn't logged in — that's fine
  const url = new URL(request.url);
  const shopDomain =
    context.session?.shop ?? url.searchParams.get("shop") ?? "";

  if (!shopDomain) {
    return jsonRes(DISABLED, { status: 400 });
  }

  const variantIdRaw = url.searchParams.get("variant_id");
  const productIdRaw = url.searchParams.get("product_id");

  if (!variantIdRaw) {
    return jsonRes(DISABLED);
  }

  const variantGid = variantIdRaw.startsWith("gid://")
    ? variantIdRaw
    : `gid://shopify/ProductVariant/${variantIdRaw}`;
  const productGid = productIdRaw
    ? productIdRaw.startsWith("gid://")
      ? productIdRaw
      : `gid://shopify/Product/${productIdRaw}`
    : null;

  const cacheKey = `${shopDomain}:${productGid ?? ""}:${variantGid}`;
  const cached = getCached(cacheKey);
  if (cached) {
    updateHeartbeat(shopDomain).catch(() => {});
    return jsonRes(cached, { headers: { "Cache-Control": "no-store" } });
  }

  const shopRecord = await prisma.shop.findUnique({
    where: { shop: shopDomain },
    select: { id: true },
  });

  if (!shopRecord) {
    return jsonRes(DISABLED);
  }

  updateHeartbeat(shopDomain).catch(() => {});

  // Variant-specific config first, then product-level fallback.
  // The fallback MUST be scoped to the product — otherwise a product-level
  // config from one product would leak into every other product's widget.
  const variantConfig = await prisma.preorderConfig.findFirst({
    where: {
      shopId: shopRecord.id,
      variantId: variantGid,
      enabled: true,
      ...(productGid ? { productId: productGid } : {}),
    },
  });

  // Without a product_id (old cached widget markup) we cannot safely fall
  // back to a product-level config, so only variant-specific matches apply.
  const config =
    variantConfig ??
    (productGid
      ? await prisma.preorderConfig.findFirst({
          where: {
            shopId: shopRecord.id,
            productId: productGid,
            variantId: "",
            enabled: true,
          },
        })
      : null);

  const state: StateResponse = config
    ? {
        enabled: config.enabled,
        message: config.message,
        ship_date: config.shipDate
          ? config.shipDate.toISOString().split("T")[0]!
          : null,
        selling_plan_id: config.sellingPlanId ?? null,
        discount_percent: config.discountPercent ?? null,
      }
    : DISABLED;

  setCached(cacheKey, state);

  return jsonRes(state, {
    headers: { "Cache-Control": "no-store" },
  });
};

async function updateHeartbeat(shop: string): Promise<void> {
  await prisma.shop.updateMany({
    where: { shop },
    data: { lastSeenAt: new Date() },
  });
}
