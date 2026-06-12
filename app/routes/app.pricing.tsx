import { useState, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  List,
  Divider,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS, OVERAGE_RATE } from "../lib/billing.shared";
import type { Plan } from "../lib/billing.shared";

const PLAN_DESCRIPTIONS: Record<Plan, string[]> = {
  FREE: [
    "10 pre-orders per month",
    "Pre-order button on storefront",
    "Custom message & ship date",
    "Never blocks your sales",
  ],
  GROWTH: [
    "300 pre-orders per month",
    "Everything in Free",
    "Usage warning emails",
    "Never blocks your sales",
  ],
  PRO: [
    "Unlimited pre-orders",
    "Everything in Growth",
    "No overage charges ever",
    "Never blocks your sales",
  ],
};

const SUBSCRIPTION_NAME_TO_PLAN: Record<string, Plan> = {
  "Growth Plan": "GROWTH",
  "Pro Plan": "PRO",
  "Free Plan": "FREE",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Always ask Shopify for the live subscription — this page is the returnUrl
  // after billing confirmation, so the webhook may not have fired yet.
  const subRes = await admin.graphql(`#graphql
    query ActiveSubscriptions {
      appInstallation {
        activeSubscriptions {
          name
          status
        }
      }
    }
  `);
  const subJson = await subRes.json() as {
    data?: { appInstallation?: { activeSubscriptions: Array<{ name: string; status: string }> } };
  };
  const activeSubs = subJson.data?.appInstallation?.activeSubscriptions ?? [];
  const activeSub = activeSubs.find((s) => s.status === "ACTIVE");
  const shopifyPlan: Plan = SUBSCRIPTION_NAME_TO_PLAN[activeSub?.name ?? ""] ?? "FREE";

  // Sync DB so the rest of the app (dashboard, webhook handler) stays consistent
  const shop = await prisma.shop.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop, plan: shopifyPlan },
    update: { plan: shopifyPlan },
    select: { plan: true, usageThisCycle: true },
  });

  return { currentPlan: shop.plan as Plan, usage: shop.usageThisCycle };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const plan = formData.get("plan") as Plan;

  // Cancel active subscription → downgrade to Free
  if (intent === "cancel") {
    const subRes = await admin.graphql(`#graphql
      query ActiveSubscriptionIds {
        appInstallation {
          activeSubscriptions { id status }
        }
      }
    `);
    const subJson = await subRes.json() as {
      data?: { appInstallation?: { activeSubscriptions: Array<{ id: string; status: string }> } };
    };
    const activeSub = (subJson.data?.appInstallation?.activeSubscriptions ?? [])
      .find((s) => s.status === "ACTIVE");

    if (activeSub) {
      await admin.graphql(
        `#graphql
        mutation CancelSubscription($id: ID!) {
          appSubscriptionCancel(id: $id) {
            appSubscription { id status }
            userErrors { field message }
          }
        }`,
        { variables: { id: activeSub.id } },
      );
    }

    await prisma.shop.update({
      where: { shop: session.shop },
      data: { plan: "FREE" },
    });

    return Response.json({ cancelled: true });
  }

  const planConfig = PLANS[plan];
  const returnUrl = `${process.env.SHOPIFY_APP_URL}/app/pricing`;

  // GROWTH bills overage at $0.05/order via usage records, capped at the
  // price difference to PRO — so its subscription needs a usage line item.
  // PRO is unlimited (recurring only); FREE never reaches here.
  const lineItems: Array<Record<string, unknown>> = [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: planConfig.price, currencyCode: "USD" },
          interval: "EVERY_30_DAYS",
        },
      },
    },
  ];
  if (plan === "GROWTH") {
    lineItems.push({
      plan: {
        appUsagePricingDetails: {
          terms: `$${OVERAGE_RATE} per pre-order over the ${planConfig.monthlyLimit}/month limit`,
          cappedAmount: {
            amount: PLANS.PRO.price - PLANS.GROWTH.price,
            currencyCode: "USD",
          },
        },
      },
    });
  }

  const res = await admin.graphql(
    `#graphql
    mutation CreateSubscription($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
      appSubscriptionCreate(
        name: $name
        lineItems: $lineItems
        returnUrl: $returnUrl
        test: $test
      ) {
        appSubscription { id status }
        confirmationUrl
        userErrors { field message }
      }
    }`,
    {
      variables: {
        name: planConfig.name,
        lineItems,
        returnUrl,
        test: process.env.NODE_ENV !== "production",
      },
    },
  );

  const json = await res.json();
  const errors = json.data?.appSubscriptionCreate?.userErrors ?? [];
  if (errors.length > 0) {
    return Response.json({ error: JSON.stringify(errors) }, { status: 400 });
  }

  const confirmationUrl: string = json.data?.appSubscriptionCreate?.confirmationUrl;
  return Response.json({ confirmationUrl });
};

export default function PricingPage() {
  const { currentPlan, usage } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  // Prevents React strict-mode double-invocation from calling window.open twice,
  // which causes Shopify's billing page to receive two navigations and glitch its buttons.
  const billingRedirected = useRef(false);

  useEffect(() => {
    if (fetcher.state === "idle") setLoadingPlan(null);
  }, [fetcher.state]);

  useEffect(() => {
    const url =
      fetcher.data && "confirmationUrl" in fetcher.data
        ? (fetcher.data as { confirmationUrl: string }).confirmationUrl
        : null;
    if (url && !billingRedirected.current) {
      billingRedirected.current = true;
      window.open(url, "_top");
    }
  }, [fetcher.data]);

  const handleUpgrade = (plan: Plan) => {
    billingRedirected.current = false; // reset so a subsequent upgrade can also navigate
    setLoadingPlan(plan);
    const fd = new FormData();
    fd.append("intent", "upgrade");
    fd.append("plan", plan);
    fetcher.submit(fd, { method: "POST" });
  };

  const handleCancel = () => {
    setLoadingPlan("FREE");
    const fd = new FormData();
    fd.append("intent", "cancel");
    fetcher.submit(fd, { method: "POST" });
  };

  const plans: Plan[] = ["FREE", "GROWTH", "PRO"];

  return (
    <Page>
      <TitleBar title="Pricing" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <Text variant="headingLg" as="h2">
              Pre-orders that <em>never stop</em>
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              When you hit your plan limit, your store keeps selling. Overage is billed at{" "}
              <strong>${OVERAGE_RATE}/order</strong>, capped at the cost to upgrade to the next tier.
              You will never be charged more than an upgrade would have cost.
            </Text>
          </BlockStack>
        </Card>

        <Layout>
          {plans.map((plan) => {
            const isCurrentPlan = plan === currentPlan;
            const config = PLANS[plan];
            return (
              <Layout.Section key={plan} variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="headingMd" as="h3">{config.name}</Text>
                      {isCurrentPlan && <Badge tone="success">Current plan</Badge>}
                    </InlineStack>

                    <Text variant="heading2xl" as="p">
                      {config.price === 0 ? "Free" : `$${config.price}`}
                      {config.price > 0 && (
                        <Text as="span" variant="bodyMd" tone="subdued"> / month</Text>
                      )}
                    </Text>

                    <Text as="p" variant="bodyMd" tone="subdued">
                      {config.monthlyLimit === Infinity
                        ? "Unlimited pre-orders"
                        : `${config.monthlyLimit} pre-orders / month`}
                    </Text>

                    <Divider />

                    <List type="bullet">
                      {PLAN_DESCRIPTIONS[plan].map((desc) => (
                        <List.Item key={desc}>{desc}</List.Item>
                      ))}
                    </List>

                    <Box>
                      {plan !== "FREE" && !isCurrentPlan && (
                        <Button
                          variant="primary"
                          fullWidth
                          loading={loadingPlan === plan && fetcher.state !== "idle"}
                          onClick={() => handleUpgrade(plan)}
                        >
                          Upgrade to {config.name}
                        </Button>
                      )}
                      {plan === "FREE" && currentPlan !== "FREE" && (
                        <Button
                          variant="secondary"
                          fullWidth
                          tone="critical"
                          loading={loadingPlan === "FREE" && fetcher.state !== "idle"}
                          onClick={handleCancel}
                        >
                          Downgrade to Free
                        </Button>
                      )}
                      {isCurrentPlan && (
                        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                          {plan === "FREE"
                            ? `${usage} / ${config.monthlyLimit} orders used this cycle`
                            : "Active"}
                        </Text>
                      )}
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>

        <Card>
          <BlockStack gap="200">
            <Text variant="headingMd" as="h3">Overage explained</Text>
            <Text as="p" variant="bodyMd">
              If you exceed your monthly limit, pre-orders continue without interruption.
              Each order over the limit costs <strong>${OVERAGE_RATE}</strong>.
              The total overage charge in any cycle is hard-capped at the price difference to
              the next tier — so you&apos;ll never pay more than an upgrade would have cost.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

