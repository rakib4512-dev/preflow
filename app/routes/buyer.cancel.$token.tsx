import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { verifyBuyerToken } from "../lib/buyer-token.server";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { Resend } from "resend";
import { merchantCancelNotifyEmail } from "../lib/email-templates.server";
import type { Prisma } from "@prisma/client";

const resend = new Resend(process.env.RESEND_API_KEY);

type LoaderData =
  | { valid: false }
  | {
      valid: true;
      orderGid: string;
      shop: string;
      fulfilled: boolean;
      customerEmail: string | null;
      productLines: Array<{ title: string; quantity: number }>;
      shipDate: string | null;
      storeName: string;
      token: string;
    };

type ActionData =
  | { done: true; mode: "auto" | "request" }
  | { error: string };

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const loader = async ({ params }: LoaderFunctionArgs): Promise<Response> => {
  const token = params.token ?? "";
  const payload = verifyBuyerToken(token);

  if (!payload) {
    return jsonRes({ valid: false } satisfies LoaderData);
  }

  const { orderGid, shop } = payload;

  let orderData: {
    email: string | null;
    fulfilled: boolean;
    productLines: Array<{ title: string; quantity: number }>;
    shipDate: string | null;
  } | null = null;

  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(
      `#graphql
      query BuyerOrderDetails($id: ID!) {
        order(id: $id) {
          email
          displayFulfillmentStatus
          lineItems(first: 10) {
            nodes {
              title
              quantity
              variant {
                metafield(namespace: "$app:preorder", key: "ship_date") { value }
              }
            }
          }
        }
      }`,
      { variables: { id: orderGid } },
    );
    const json = (await res.json()) as {
      data?: {
        order?: {
          email?: string;
          displayFulfillmentStatus: string;
          lineItems: { nodes: Array<{ title: string; quantity: number; variant?: { metafield?: { value: string } | null } }> };
        } | null;
      };
    };
    const order = json.data?.order;
    if (order) {
      const fulfilled = ["FULFILLED", "RESTOCKED"].includes(order.displayFulfillmentStatus);
      // Grab ship date from first line item's variant metafield
      const firstShipDate = order.lineItems.nodes[0]?.variant?.metafield?.value ?? null;
      orderData = {
        email: order.email ?? null,
        fulfilled,
        productLines: order.lineItems.nodes.map((n) => ({ title: n.title, quantity: n.quantity })),
        shipDate: firstShipDate,
      };
    }
  } catch {
    // If Admin API fails, show a generic page
  }

  if (!orderData) {
    return jsonRes({ valid: false } satisfies LoaderData);
  }

  return jsonRes({
    valid: true,
    orderGid,
    shop,
    fulfilled: orderData.fulfilled,
    customerEmail: orderData.email,
    productLines: orderData.productLines,
    shipDate: orderData.shipDate,
    storeName: shop.replace(".myshopify.com", ""),
    token,
  } satisfies LoaderData);
};

export const action = async ({ request, params }: ActionFunctionArgs): Promise<Response> => {
  const token = params.token ?? "";
  const payload = verifyBuyerToken(token);
  if (!payload) return jsonRes({ error: "Invalid or expired link." } satisfies ActionData);

  const { orderGid, shop } = payload;

  const shopRecord = await prisma.shop.findUnique({
    where: { shop },
    select: { id: true, settings: true },
  });
  if (!shopRecord) return jsonRes({ error: "Shop not found." } satisfies ActionData);

  const settings = (shopRecord.settings ?? {}) as Record<string, unknown>;
  const cancelMode = (settings.cancelMode as string | undefined) === "request" ? "request" : "auto";
  const ownerEmail = (settings.ownerEmail as string | undefined) ?? "";

  // Check not already fulfilled. May throw if the app was uninstalled and the
  // offline session is gone — return a friendly error instead of a 500.
  let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch {
    return jsonRes({
      error: "We couldn't process your request automatically. Please contact the store directly.",
    } satisfies ActionData);
  }
  const checkRes = await admin.graphql(
    `#graphql
    query CheckFulfillment($id: ID!) { order(id: $id) { displayFulfillmentStatus email lineItems(first: 1) { nodes { title } } } }`,
    { variables: { id: orderGid } },
  );
  const checkJson = (await checkRes.json()) as {
    data?: { order?: { displayFulfillmentStatus: string; email?: string; lineItems: { nodes: Array<{ title: string }> } } | null };
  };
  const orderCheck = checkJson.data?.order;
  if (!orderCheck) return jsonRes({ error: "Order not found." } satisfies ActionData);
  if (["FULFILLED", "RESTOCKED"].includes(orderCheck.displayFulfillmentStatus)) {
    return jsonRes({ error: "This order has already been fulfilled and cannot be cancelled." } satisfies ActionData);
  }

  const productTitle = orderCheck.lineItems.nodes[0]?.title ?? orderGid;
  const customerEmail = orderCheck.email ?? "";

  const dedupeKey = `${orderGid}:buyer_cancel`;

  if (cancelMode === "auto") {
    // Issue cancel mutation
    const cancelRes = await admin.graphql(
      `#graphql
      mutation CancelOrder($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!, $notifyCustomer: Boolean) {
        orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock, notifyCustomer: $notifyCustomer) {
          orderCancelUserErrors { field message }
          job { id }
        }
      }`,
      { variables: { orderId: orderGid, reason: "CUSTOMER", refund: true, restock: false, notifyCustomer: true } },
    );
    const cancelJson = (await cancelRes.json()) as {
      data?: { orderCancel?: { orderCancelUserErrors: Array<{ field: string; message: string }>; job?: { id: string } | null } };
    };
    const cancelErrors = cancelJson.data?.orderCancel?.orderCancelUserErrors ?? [];
    if (cancelErrors.length > 0) {
      return jsonRes({ error: cancelErrors[0].message } satisfies ActionData);
    }

    await prisma.customerNotification.upsert({
      where: { dedupeKey },
      create: {
        shopId: shopRecord.id,
        orderGid,
        type: "buyer_cancel",
        payload: { productTitle, cancelMode: "auto" } as unknown as Prisma.InputJsonValue,
        dedupeKey,
      },
      update: {},
    });

    // Notify merchant
    if (ownerEmail) {
      const { subject, html, text } = merchantCancelNotifyEmail({
        storeName: shop.replace(".myshopify.com", ""),
        productTitle,
        orderGid,
        customerEmail,
        cancelType: "buyer_cancel",
      });
      await resend.emails.send({ from: "PreFlow <onboarding@resend.dev>", to: ownerEmail, subject, html, text }).catch(() => {});
    }

    return jsonRes({ done: true, mode: "auto" } satisfies ActionData);
  } else {
    // Request mode — log and notify merchant
    await prisma.customerNotification.upsert({
      where: { dedupeKey },
      create: {
        shopId: shopRecord.id,
        orderGid,
        type: "buyer_cancel_request",
        payload: { productTitle, cancelMode: "request" } as unknown as Prisma.InputJsonValue,
        dedupeKey,
      },
      update: {},
    });

    if (ownerEmail) {
      const { subject, html, text } = merchantCancelNotifyEmail({
        storeName: shop.replace(".myshopify.com", ""),
        productTitle,
        orderGid,
        customerEmail,
        cancelType: "buyer_cancel_request",
      });
      await resend.emails.send({ from: "PreFlow <onboarding@resend.dev>", to: ownerEmail, subject, html, text }).catch(() => {});
    }

    return jsonRes({ done: true, mode: "request" } satisfies ActionData);
  }
};

export default function BuyerCancelPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const fetcher = useFetcher<typeof action>();
  const [submitted, setSubmitted] = useState(false);

  if (!data.valid) {
    return (
      <CenteredLayout>
        <h1>Link expired</h1>
        <p>This pre-order management link is no longer valid. Please contact the store for assistance.</p>
      </CenteredLayout>
    );
  }

  const actionResult = fetcher.data as ActionData | undefined;
  const loading = fetcher.state !== "idle";

  if (actionResult && "done" in actionResult) {
    return (
      <CenteredLayout storeName={data.storeName}>
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <h2 style={{ color: "#22a460" }}>
            {actionResult.mode === "auto" ? "Your order has been cancelled." : "Cancellation request received."}
          </h2>
          <p>
            {actionResult.mode === "auto"
              ? "Your refund has been initiated and will appear within a few business days."
              : "We've notified the store and will get back to you shortly."}
          </p>
        </div>
      </CenteredLayout>
    );
  }

  if (data.fulfilled) {
    return (
      <CenteredLayout storeName={data.storeName}>
        <div style={{ padding: "24px 0" }}>
          <h2>This order can no longer be cancelled</h2>
          <p>Your pre-order has already been fulfilled and shipped. Please contact the store if you need further assistance.</p>
        </div>
      </CenteredLayout>
    );
  }

  const handleCancel = () => {
    setSubmitted(true);
    const fd = new FormData();
    fd.append("_action", "cancel");
    fetcher.submit(fd, { method: "POST" });
  };

  return (
    <CenteredLayout storeName={data.storeName}>
      <h1 style={{ marginTop: 0 }}>Manage your pre-order</h1>

      <section style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 8px" }}>Items</h3>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          {data.productLines.map((line, i) => (
            <li key={i}>{line.title} × {line.quantity}</li>
          ))}
        </ul>
      </section>

      {data.shipDate && (
        <p><strong>Estimated ship date:</strong> {formatDate(data.shipDate)}</p>
      )}

      <hr style={{ margin: "24px 0", border: "none", borderTop: "1px solid #e1e3e5" }} />

      {actionResult && "error" in actionResult && (
        <p style={{ color: "#d82c0d", marginBottom: 16 }}>{actionResult.error}</p>
      )}

      <p style={{ color: "#6d7175" }}>
        Want to cancel your pre-order? Click below and we&apos;ll process your request immediately.
        Refunds are returned to your original payment method.
      </p>

      <button
        onClick={handleCancel}
        disabled={loading || submitted}
        style={{
          background: "#d82c0d",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "12px 24px",
          fontSize: 16,
          cursor: loading || submitted ? "not-allowed" : "pointer",
          opacity: loading || submitted ? 0.6 : 1,
        }}
      >
        {loading ? "Processing…" : "Request cancellation"}
      </button>
    </CenteredLayout>
  );
}

function CenteredLayout({ children, storeName }: { children: React.ReactNode; storeName?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{storeName ? `${storeName} — Manage pre-order` : "Manage pre-order"}</title>
        <style>{`
          * { box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #202223; margin: 0; background: #f6f6f7; }
        `}</style>
      </head>
      <body>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 20px" }}>
          {storeName && <p style={{ color: "#6d7175", marginBottom: 24 }}>{storeName}</p>}
          {children}
        </div>
      </body>
    </html>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso;
  }
}
