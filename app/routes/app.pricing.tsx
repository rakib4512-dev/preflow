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

function jsonRes(data: unknown, init?: number | { status?: number; headers?: Record<string, string> }): Response {
  const status = typeof init === "number" ? init : (init?.status ?? 200);
  const extra = typeof init === "object" ? (init?.headers ?? {}) : {};
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

export const action = async ({ request }: ActionFunctionArgs): Promise<Response> => {
  try {
    try {
      const { admin, session } = await authenticate.admin(request);
      return await handleBilling(admin, session, await request.formData());
    } catch (err) {
      if (err instanceof Response) return err;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[app.pricing] action error:", err instanceof Error ? err.stack : String(err));
      return new Response(JSON.stringify({ error: message }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (outerErr) {
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    console.error("[app.pricing] action OUTER catch:", msg);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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

    return jsonRes({ cancelled: true });
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
    return jsonRes({ error: JSON.stringify(errors) }, { status: 400 });
  }

  const confirmationUrl: string = json.data?.appSubscriptionCreate?.confirmationUrl;
  return jsonRes({ confirmationUrl });
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

  return (
    <Page>
      <TitleBar title="Pricing" />
      <style>{`
        .btn-upgrade-featured {
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          box-shadow: 0 4px 14px rgba(99,102,241,0.40);
          transition: box-shadow 0.2s ease, transform 0.15s ease, opacity 0.15s;
        }
        .btn-upgrade-featured:hover:not(:disabled) {
          box-shadow: 0 6px 20px rgba(99,102,241,0.55);
          transform: translateY(-2px);
        }
        .btn-upgrade-featured:active:not(:disabled) { transform: translateY(0); }

        .btn-upgrade-pro {
          background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
          box-shadow: 0 4px 14px rgba(0,0,0,0.18);
          transition: box-shadow 0.2s ease, transform 0.15s ease, opacity 0.15s;
        }
        .btn-upgrade-pro:hover:not(:disabled) {
          box-shadow: 0 6px 20px rgba(0,0,0,0.28);
          transform: translateY(-2px);
        }
        .btn-upgrade-pro:active:not(:disabled) { transform: translateY(0); }

        .btn-downgrade {
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .btn-downgrade:hover:not(:disabled) {
          background: #f9fafb !important;
          border-color: #d1d5db !important;
          color: #374151 !important;
        }
      `}</style>
      <BlockStack gap="500">
        {billingError && (
          <Banner tone="critical" title="Billing error">
            <p>{billingError}</p>
          </Banner>
        )}

        {/* Page heading */}
        <div style={{ paddingBottom: "4px" }}>
          <Text variant="headingXl" as="h1">Pricing</Text>
          <div style={{ marginTop: "6px", fontSize: "15px", color: "#6b7280", lineHeight: 1.6 }}>
            When you hit your limit, your store keeps selling. Overage at{" "}
            <strong style={{ color: "#374151" }}>${OVERAGE_RATE}/order</strong>, capped at the
            cost to upgrade — you&apos;ll never pay more than switching plans would have cost.
          </div>
        </div>

        {/* Plan cards */}
        <Layout>
          {plans.map((plan) => {
            const isCurrentPlan = plan === currentPlan;
            const config = PLANS[plan];
            const isFeatured = plan === "GROWTH";

            return (
              <Layout.Section key={plan} variant="oneThird">
                <div style={{
                  position: "relative",
                  background: "#fff",
                  borderRadius: "16px",
                  border: isFeatured ? "2px solid #6366f1" : "1.5px solid #e5e7eb",
                  boxShadow: isFeatured
                    ? "0 4px 24px rgba(99,102,241,0.14)"
                    : "0 1px 4px rgba(0,0,0,0.05)",
                  padding: "28px 24px 24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "24px",
                  height: "100%",
                }}>

                  {/* "Most popular" pill */}
                  {isFeatured && (
                    <div style={{
                      position: "absolute",
                      top: "-13px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "#6366f1",
                      color: "#fff",
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      padding: "4px 14px",
                      borderRadius: "999px",
                      whiteSpace: "nowrap",
                    }}>
                      Most popular
                    </div>
                  )}

                  {/* Name + current badge */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{
                      fontSize: "16px",
                      fontWeight: 700,
                      color: isFeatured ? "#6366f1" : "#111827",
                    }}>
                      {config.name}
                    </span>
                    {isCurrentPlan && (
                      <span style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#059669",
                        background: "#ecfdf5",
                        border: "1px solid #a7f3d0",
                        padding: "3px 10px",
                        borderRadius: "999px",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}>
                        Current
                      </span>
                    )}
                  </div>

                  {/* Price */}
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                      <span style={{
                        fontSize: "42px",
                        fontWeight: 800,
                        color: "#111827",
                        letterSpacing: "-2px",
                        lineHeight: 1,
                      }}>
                        {config.price === 0 ? "Free" : `$${config.price}`}
                      </span>
                      {config.price > 0 && (
                        <span style={{ fontSize: "14px", color: "#9ca3af", fontWeight: 500 }}>
                          / month
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "13px", color: "#9ca3af", marginTop: "6px" }}>
                      {config.monthlyLimit === Infinity
                        ? "Unlimited pre-orders"
                        : `${config.monthlyLimit} pre-orders / month`}
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ borderTop: "1px solid #f3f4f6" }} />

                  {/* Features */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                    {PLAN_DESCRIPTIONS[plan].map((desc) => (
                      <div key={desc} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                          <circle cx="8" cy="8" r="8" fill={isFeatured ? "#6366f1" : "#d1fae5"} />
                          <path d="M4.5 8l2.5 2.5 4-4.5" stroke={isFeatured ? "#fff" : "#059669"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span style={{ fontSize: "14px", color: "#374151" }}>{desc}</span>
                      </div>
                    ))}
                  </div>

                  {/* CTA */}
                  <div>
                    {plan !== "FREE" && !isCurrentPlan && (
                      <button
                        className={isFeatured ? "btn-upgrade-featured" : "btn-upgrade-pro"}
                        onClick={() => handleUpgrade(plan)}
                        disabled={loadingPlan === plan && fetcher.state !== "idle"}
                        style={{
                          width: "100%",
                          padding: "13px 16px",
                          borderRadius: "10px",
                          border: "none",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: "15px",
                          letterSpacing: "0.01em",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                          opacity: (loadingPlan === plan && fetcher.state !== "idle") ? 0.65 : 1,
                          fontFamily: "inherit",
                        }}
                      >
                        {(loadingPlan === plan && fetcher.state !== "idle") ? (
                          "Opening checkout…"
                        ) : (
                          <>
                            <span>Upgrade to {config.name}</span>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                              <path d="M3 8h10M8.5 3.5L13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </>
                        )}
                      </button>
                    )}
                    {plan === "FREE" && currentPlan !== "FREE" && (
                      <button
                        className="btn-downgrade"
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
                          opacity: (loadingPlan === "FREE" && fetcher.state !== "idle") ? 0.6 : 1,
                          fontFamily: "inherit",
                        }}
                      >
                        {(loadingPlan === "FREE" && fetcher.state !== "idle") ? "Cancelling…" : "Downgrade to Free"}
                      </button>
                    )}
                    {isCurrentPlan && (
                      <div style={{
                        textAlign: "center",
                        padding: "11px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "#059669",
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        borderRadius: "10px",
                      }}>
                        {plan === "FREE"
                          ? `${usage} / ${config.monthlyLimit} used this cycle`
                          : "✓ Your current plan"}
                      </div>
                    )}
                  </div>
                </div>
              </Layout.Section>
            );
          })}
        </Layout>

        {/* Overage note */}
        <Card>
          <BlockStack gap="100">
            <Text variant="headingMd" as="h3">Overage explained</Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Exceed your monthly limit and pre-orders continue without interruption.
              Each extra order costs <strong>${OVERAGE_RATE}</strong>, capped at the price difference
              to the next plan — so you&apos;ll never pay more than upgrading would have cost.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
