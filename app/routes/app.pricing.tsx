import { useState, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
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
  try {
    return await handleBilling(admin, session, await request.formData());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[app.pricing] action failed:", err);
    return Response.json({ error: message });
  }
};

async function handleBilling(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  session: Awaited<ReturnType<typeof authenticate.admin>>["session"],
  formData: FormData,
) {
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

  // Development stores can never approve REAL charges — Shopify rejects the
  // confirmation. Detect them and always create test charges there, regardless
  // of NODE_ENV. SHOPIFY_BILLING_TEST=true forces test charges everywhere.
  const shopRes = await admin.graphql(`#graphql
    query ShopPlan { shop { plan { partnerDevelopment } } }
  `);
  const shopJson = (await shopRes.json()) as {
    data?: { shop?: { plan?: { partnerDevelopment?: boolean } } };
  };
  const isDevStore = Boolean(shopJson.data?.shop?.plan?.partnerDevelopment);
  const useTestCharge =
    isDevStore ||
    process.env.NODE_ENV !== "production" ||
    process.env.SHOPIFY_BILLING_TEST === "true";

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
        test: useTestCharge,
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
}

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

  const billingError =
    fetcher.data && "error" in fetcher.data
      ? (fetcher.data as { error: string }).error
      : null;

  // Each plan's visual style — middle one highlighted as the recommended tier.
  const planStyle: Record<Plan, { gradient: string; tag: string; iconBg: string }> = {
    FREE: {
      gradient: "linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)",
      tag: "Get started",
      iconBg: "linear-gradient(135deg, #6b7280, #4b5563)",
    },
    GROWTH: {
      gradient: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)",
      tag: "Most popular",
      iconBg: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    },
    PRO: {
      gradient: "linear-gradient(135deg, #111827 0%, #1f2937 100%)",
      tag: "For power sellers",
      iconBg: "linear-gradient(135deg, #111827, #374151)",
    },
  };

  return (
    <Page>
      <TitleBar title="Pricing" />
      <BlockStack gap="500">
        {billingError && (
          <Banner tone="critical" title="Billing error">
            <p>{billingError}</p>
          </Banner>
        )}

        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)",
          borderRadius: "16px",
          padding: "36px 40px",
          color: "#fff",
          boxShadow: "0 4px 20px rgba(99,102,241,0.25)",
          textAlign: "center",
        }}>
          <div style={{
            fontSize: "12px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            opacity: 0.85,
            marginBottom: "10px",
          }}>
            Simple, fair pricing
          </div>
          <h1 style={{
            fontSize: "32px",
            fontWeight: 800,
            letterSpacing: "-0.5px",
            margin: "0 0 12px",
          }}>
            Pre-orders that <em style={{ fontStyle: "normal", color: "#fde68a" }}>never stop</em>
          </h1>
          <p style={{
            fontSize: "15px",
            opacity: 0.9,
            maxWidth: "540px",
            margin: "0 auto",
            lineHeight: 1.6,
          }}>
            When you hit your plan limit, your store keeps selling.
            Overage at <strong>${OVERAGE_RATE}/order</strong>, hard-capped at the cost to upgrade.
            You&apos;ll never pay more than switching tiers would have cost.
          </p>
        </div>

        {/* Plan cards */}
        <Layout>
          {plans.map((plan) => {
            const isCurrentPlan = plan === currentPlan;
            const config = PLANS[plan];
            const style = planStyle[plan];
            const isFeatured = plan === "GROWTH";

            return (
              <Layout.Section key={plan} variant="oneThird">
                <div
                  style={{
                    background: "#fff",
                    borderRadius: "16px",
                    overflow: "hidden",
                    border: isFeatured ? "2px solid #8b5cf6" : "1px solid #f3f4f6",
                    boxShadow: isFeatured
                      ? "0 8px 28px rgba(139,92,246,0.22)"
                      : "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
                    transform: isFeatured ? "scale(1.02)" : "none",
                    transition: "transform 0.2s ease",
                    position: "relative",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {/* Banner */}
                  <div style={{
                    background: style.gradient,
                    color: "#fff",
                    padding: "20px 24px",
                    position: "relative",
                  }}>
                    <div style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      opacity: 0.9,
                      marginBottom: "6px",
                    }}>
                      {style.tag}
                    </div>
                    <div style={{
                      fontSize: "22px",
                      fontWeight: 800,
                      letterSpacing: "-0.4px",
                    }}>
                      {config.name}
                    </div>
                    {isCurrentPlan && (
                      <div style={{
                        position: "absolute",
                        top: "16px",
                        right: "16px",
                        background: "rgba(255,255,255,0.25)",
                        backdropFilter: "blur(8px)",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        border: "1px solid rgba(255,255,255,0.3)",
                      }}>
                        Current
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div style={{
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "20px",
                    flex: 1,
                  }}>
                    {/* Price */}
                    <div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                        <span style={{
                          fontSize: "40px",
                          fontWeight: 800,
                          color: "#111827",
                          letterSpacing: "-1.5px",
                          lineHeight: 1,
                        }}>
                          {config.price === 0 ? "Free" : `$${config.price}`}
                        </span>
                        {config.price > 0 && (
                          <span style={{ fontSize: "14px", color: "#6b7280", fontWeight: 600 }}>
                            / month
                          </span>
                        )}
                      </div>
                      <div style={{
                        fontSize: "13px",
                        color: "#6b7280",
                        marginTop: "6px",
                        fontWeight: 500,
                      }}>
                        {config.monthlyLimit === Infinity
                          ? "♾️  Unlimited pre-orders"
                          : `${config.monthlyLimit} pre-orders / month`}
                      </div>
                    </div>

                    {/* Features */}
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                      paddingTop: "16px",
                      borderTop: "1px solid #f3f4f6",
                    }}>
                      {PLAN_DESCRIPTIONS[plan].map((desc) => (
                        <div key={desc} style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "10px",
                          fontSize: "14px",
                          color: "#374151",
                          lineHeight: 1.5,
                        }}>
                          <span style={{
                            width: "18px",
                            height: "18px",
                            borderRadius: "50%",
                            background: isFeatured ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "#d1fae5",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginTop: "2px",
                          }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                              <path d="M5 12l4 4L19 6" stroke={isFeatured ? "#fff" : "#059669"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                          <span>{desc}</span>
                        </div>
                      ))}
                    </div>

                    {/* CTA */}
                    <div style={{ marginTop: "auto" }}>
                      {plan !== "FREE" && !isCurrentPlan && (
                        <button
                          onClick={() => handleUpgrade(plan)}
                          disabled={loadingPlan === plan && fetcher.state !== "idle"}
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            borderRadius: "10px",
                            border: "none",
                            background: isFeatured
                              ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                              : "#111827",
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: "14px",
                            cursor: "pointer",
                            boxShadow: isFeatured ? "0 4px 14px rgba(99,102,241,0.4)" : "none",
                            transition: "opacity 0.15s",
                            opacity: (loadingPlan === plan && fetcher.state !== "idle") ? 0.6 : 1,
                            fontFamily: "inherit",
                          }}
                        >
                          {(loadingPlan === plan && fetcher.state !== "idle")
                            ? "Opening checkout…"
                            : `Upgrade to ${config.name}`}
                        </button>
                      )}
                      {plan === "FREE" && currentPlan !== "FREE" && (
                        <button
                          onClick={handleCancel}
                          disabled={loadingPlan === "FREE" && fetcher.state !== "idle"}
                          style={{
                            width: "100%",
                            padding: "12px 16px",
                            borderRadius: "10px",
                            border: "1.5px solid #e5e7eb",
                            background: "#fff",
                            color: "#6b7280",
                            fontWeight: 600,
                            fontSize: "14px",
                            cursor: "pointer",
                            transition: "opacity 0.15s",
                            opacity: (loadingPlan === "FREE" && fetcher.state !== "idle") ? 0.6 : 1,
                            fontFamily: "inherit",
                          }}
                        >
                          {(loadingPlan === "FREE" && fetcher.state !== "idle")
                            ? "Cancelling…"
                            : "Downgrade to Free"}
                        </button>
                      )}
                      {isCurrentPlan && (
                        <div style={{
                          textAlign: "center",
                          padding: "12px",
                          fontSize: "13px",
                          color: plan === "FREE" ? "#374151" : "#059669",
                          fontWeight: 600,
                          background: plan === "FREE" ? "#f9fafb" : "#ecfdf5",
                          borderRadius: "10px",
                        }}>
                          {plan === "FREE"
                            ? `${usage} / ${config.monthlyLimit} orders used this cycle`
                            : "✓ Active"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Layout.Section>
            );
          })}
        </Layout>

        {/* Overage explained */}
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
