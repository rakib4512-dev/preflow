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

  return (
    <Page>
      <TitleBar title="Dashboard" />
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

        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2">Active pre-orders</Text>
                <Text variant="heading2xl" as="p">{data.activeCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2">Orders this cycle</Text>
                <Text variant="heading2xl" as="p">{data.ordersThisCycle}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">Usage</Text>
                  <Badge tone={data.atLimit ? "warning" : "success"}>{data.plan}</Badge>
                </InlineStack>
                <Text as="p" variant="bodyMd">
                  {data.usage} / {data.limit ?? "∞"} pre-orders
                </Text>
                {data.limit !== null && (
                  <ProgressBar
                    progress={Math.min(data.pct, 100)}
                    tone={data.pct >= 100 ? "critical" : data.pct >= 70 ? "highlight" : "success"}
                    size="small"
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {data.activeConfigs.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">Active pre-order products</Text>
                {data.activeCount > 10 && (
                  <Button variant="plain" url="/app/products">
                    {`View all ${data.activeCount}`}
                  </Button>
                )}
              </InlineStack>
              <DataTable
                columnContentTypes={["text", "text", "text"]}
                headings={["Product", "Message", "Ships by"]}
                rows={data.activeConfigs.map((c) => [
                  c.title,
                  c.message,
                  c.shipDate ? new Date(c.shipDate).toLocaleDateString() : "—",
                ])}
              />
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
