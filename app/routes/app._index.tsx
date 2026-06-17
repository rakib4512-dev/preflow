import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  ProgressBar,
  Banner,
  DataTable,
  Badge,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS, usagePercent } from "../lib/billing.shared";
import { resetCycleIfNeeded } from "../lib/billing.server";
import { reconcileRecentOrders } from "../lib/reconcile-orders.server";

type AdminClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

// Module-level cache: product GID → { title, expiresAt }
const titleCache = new Map<string, { title: string; expiresAt: number }>();
const TITLE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchProductTitles(
  admin: AdminClient,
  productIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (productIds.length === 0) return result;

  const now = Date.now();
  const missing: string[] = [];

  for (const id of productIds) {
    const cached = titleCache.get(id);
    if (cached && cached.expiresAt > now) {
      result.set(id, cached.title);
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) return result;

  const aliasFields = missing
    .map((gid, i) => `p${i}: product(id: "${gid}") { id title }`)
    .join("\n    ");

  try {
    const res = await admin.graphql(`#graphql
      query BatchProductTitles {
        ${aliasFields}
      }
    `);
    const json = (await res.json()) as {
      data?: Record<string, { id: string; title: string } | null>;
    };
    for (const product of Object.values(json.data ?? {})) {
      if (product) {
        result.set(product.id, product.title);
        titleCache.set(product.id, { title: product.title, expiresAt: now + TITLE_TTL });
      }
    }
  } catch {
    // non-fatal — falls back to numeric ID
  }

  return result;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Roll the 30-day usage cycle on dashboard visits as well as on orders
  const shopForCycle = await prisma.shop.findUnique({
    where: { shop: session.shop },
    select: { id: true },
  });
  if (shopForCycle) await resetCycleIfNeeded(shopForCycle.id);

  // Fire-and-forget — don't block the page waiting for order reconciliation
  reconcileRecentOrders(admin, session.shop).catch((err) =>
    console.error("[dashboard] reconcile failed:", err),
  );

  const shop = await prisma.shop.findUnique({
    where: { shop: session.shop },
    include: {
      preorderConfigs: {
        where: { enabled: true },
        orderBy: { updatedAt: "desc" },
        take: 10,
      },
    },
  });

  const configs = shop?.preorderConfigs ?? [];
  const uniqueProductIds = [...new Set(configs.map((c) => c.productId))];

  // Run both DB counts and the product title fetch in parallel
  const [activeCount, ordersThisCycle, titleMap] = await Promise.all([
    // Count separately — including the rows would cap at the table's take:10
    shop
      ? prisma.preorderConfig.count({ where: { shopId: shop.id, enabled: true } })
      : Promise.resolve(0),
    // Count from rolling billing cycleStart, not the calendar month
    shop
      ? prisma.preorderOrder.count({
          where: { shopId: shop.id, createdAt: { gte: shop.cycleStart } },
        })
      : Promise.resolve(0),
    fetchProductTitles(admin, uniqueProductIds),
  ]);

  const plan = shop?.plan ?? "FREE";
  const usage = shop?.usageThisCycle ?? 0;
  const limit = PLANS[plan].monthlyLimit;
  const pct = usagePercent(usage, plan);
  const atLimit = limit !== Infinity && usage >= limit;

  return {
    shop: session.shop,
    plan,
    usage,
    limit: limit === Infinity ? null : limit,
    pct,
    atLimit,
    activeCount,
    ordersThisCycle,
    activeConfigs: configs.map((c) => ({
      id: c.id,
      productId: c.productId,
      title: titleMap.get(c.productId) ?? c.productId.replace("gid://shopify/Product/", ""),
      variantId: c.variantId,
      message: c.message,
      shipDate: c.shipDate?.toISOString() ?? null,
    })),
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  const formattedShipDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const days = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86400000));
    const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    if (days === 0) return { date, suffix: "Shipping today" };
    if (days === 1) return { date, suffix: "Ships tomorrow" };
    if (days < 30) return { date, suffix: `In ${days} days` };
    return { date, suffix: `In ${Math.ceil(days / 30)} months` };
  };

  const usageTone = data.pct >= 100 ? "critical" : data.pct >= 70 ? "highlight" : "success";
  const usageColor = data.pct >= 100 ? "#dc2626" : data.pct >= 70 ? "#d97706" : "#22a460";
  const initial = data.productInitial ?? (data.shop ? data.shop[0]?.toUpperCase() : "P");
  const storeName = data.shop?.replace(".myshopify.com", "") ?? "";

  return (
    <Page title="Dashboard">
      <TitleBar title="Dashboard" />

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)",
        borderRadius: "16px",
        padding: "28px 32px",
        marginBottom: "20px",
        color: "#fff",
        boxShadow: "0 4px 20px rgba(99,102,241,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{
            width: "56px",
            height: "56px",
            borderRadius: "14px",
            background: "rgba(255,255,255,0.18)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "26px",
            fontWeight: 800,
            letterSpacing: "-1px",
            border: "1.5px solid rgba(255,255,255,0.25)",
          }}>
            {initial}
          </div>
          <div>
            <div style={{ fontSize: "13px", opacity: 0.85, fontWeight: 500, letterSpacing: "0.02em", marginBottom: "2px" }}>
              Welcome back to PreFlow
            </div>
            <div style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-0.4px" }}>
              {storeName}
            </div>
          </div>
        </div>
      </div>

      <BlockStack gap="500">
        {data.atLimit && (
          <Banner
            title="Usage limit reached"
            tone="warning"
            action={{ content: "Upgrade plan", url: "/app/pricing" }}
          >
            <p>
              You&apos;ve hit your {data.limit} pre-order limit.{" "}
              <strong>Pre-orders are still live</strong> — overage is billed at $0.05/order,
              capped at the cost to upgrade.
            </p>
          </Banner>
        )}

        {/* Stat cards */}
        <Layout>
          {/* Active pre-orders */}
          <Layout.Section variant="oneThird">
            <div style={statCard}>
              <div style={{ ...statIconWrap, background: "linear-gradient(135deg, #dbeafe, #bfdbfe)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4H6zM3 6h18M16 10a4 4 0 01-8 0" stroke="#1d4ed8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={statLabel}>Active pre-orders</div>
              <div style={statValue}>{data.activeCount}</div>
              <div style={statSub}>Products selling on pre-order</div>
            </div>
          </Layout.Section>

          {/* Orders this cycle */}
          <Layout.Section variant="oneThird">
            <div style={statCard}>
              <div style={{ ...statIconWrap, background: "linear-gradient(135deg, #ede9fe, #ddd6fe)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="#6d28d9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={statLabel}>Orders this cycle</div>
              <div style={statValue}>{data.ordersThisCycle}</div>
              <div style={statSub}>{ordersThisCycleCount(data.ordersThisCycle)}</div>
            </div>
          </Layout.Section>

          {/* Usage */}
          <Layout.Section variant="oneThird">
            <div style={statCard}>
              <div style={{ ...statIconWrap, background: usageBg(data.pct) }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke={usageColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={statLabel}>Usage</div>
                <Badge tone={data.atLimit ? "warning" : "success"}>{data.plan}</Badge>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span style={statValue}>{data.usage}</span>
                <span style={{ fontSize: "16px", color: "#6b7280", fontWeight: 600 }}>
                  / {data.limit ?? "∞"}
                </span>
              </div>
              {data.limit !== null && (
                <div style={{ marginTop: "10px" }}>
                  <div style={{
                    height: "6px",
                    background: "#f3f4f6",
                    borderRadius: "999px",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(data.pct, 100)}%`,
                      background: usageColor,
                      borderRadius: "999px",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <div style={{ ...statSub, marginTop: "6px", color: usageColor, fontWeight: 600 }}>
                    {data.pct}% used this cycle
                  </div>
                </div>
              )}
              {data.limit === null && (
                <div style={statSub}>Unlimited — Pro plan</div>
              )}
            </div>
          </Layout.Section>
        </Layout>

        {/* Active pre-order products */}
        {data.activeConfigs.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <div>
                  <Text variant="headingMd" as="h2">Active pre-order products</Text>
                  <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "2px" }}>
                    Showing {data.activeConfigs.length} of {data.activeCount} products
                  </div>
                </div>
                {data.activeCount > 10 && (
                  <Button variant="plain" url="/app/products">
                    {`View all ${data.activeCount} →`}
                  </Button>
                )}
              </InlineStack>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {data.activeConfigs.map((c) => {
                  const ship = c.shipDate ? formattedShipDate(c.shipDate) : null;
                  return (
                    <div
                      key={c.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "16px",
                        padding: "16px",
                        background: "#fafbfc",
                        border: "1px solid #f3f4f6",
                        borderRadius: "12px",
                        transition: "background 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#fafbfc")}
                    >
                      <div style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "10px",
                        background: "linear-gradient(135deg, #f3e8ff, #e9d5ff)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "18px",
                        fontWeight: 700,
                        color: "#7c3aed",
                        flexShrink: 0,
                      }}>
                        {c.title?.[0]?.toUpperCase() ?? "P"}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: "14px",
                          fontWeight: 600,
                          color: "#111827",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}>
                          {c.title}
                        </div>
                        <div style={{
                          fontSize: "13px",
                          color: "#6b7280",
                          marginTop: "2px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}>
                          {c.message}
                        </div>
                      </div>

                      {ship ? (
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>
                            {ship.date}
                          </div>
                          <div style={{
                            fontSize: "11px",
                            color: usageColor,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            marginTop: "2px",
                          }}>
                            {ship.suffix}
                          </div>
                        </div>
                      ) : (
                        <span style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#9ca3af",
                          background: "#f3f4f6",
                          padding: "4px 10px",
                          borderRadius: "999px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          flexShrink: 0,
                        }}>
                          No ship date
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}

// Inline styles (no CSS file — Remix/Polaris embed-friendly)
const statCard: React.CSSProperties = {
  background: "#fff",
  borderRadius: "14px",
  padding: "20px 22px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
  border: "1px solid #f3f4f6",
  display: "flex",
  flexDirection: "column" as const,
  minHeight: "140px",
};
const statIconWrap: React.CSSProperties = {
  width: "40px",
  height: "40px",
  borderRadius: "10px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: "12px",
};
const statLabel: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  marginBottom: "6px",
};
const statValue: React.CSSProperties = {
  fontSize: "32px",
  fontWeight: 800,
  color: "#111827",
  letterSpacing: "-1px",
  lineHeight: 1.1,
};
const statSub: React.CSSProperties = {
  fontSize: "12px",
  color: "#9ca3af",
  marginTop: "6px",
};

function ordersThisCycleCount(n: number) {
  if (n === 0) return "No orders yet this cycle";
  if (n === 1) return "1 pre-order received";
  return `${n} pre-orders received`;
}

function usageBg(pct: number) {
  if (pct >= 100) return "linear-gradient(135deg, #fee2e2, #fecaca)";
  if (pct >= 70) return "linear-gradient(135deg, #fef3c7, #fde68a)";
  return "linear-gradient(135deg, #d1fae5, #a7f3d0)";
}
