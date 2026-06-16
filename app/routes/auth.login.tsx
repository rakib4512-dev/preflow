import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { LoginErrorType } from "@shopify/shopify-app-remix/server";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = await login(request);
  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = await login(request);
  return { errors };
};

export default function LoginPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = actionData?.errors ?? loaderData?.errors ?? {};

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>PreFlow — Shopify Pre-order App</title>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; }
          input:focus { outline: none; border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
          button:hover { opacity: 0.92; transform: translateY(-1px); }
          button:active { transform: translateY(0); }
          button { transition: opacity 0.15s ease, transform 0.15s ease; }
          @keyframes fadeUp {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .card { animation: fadeUp 0.4s ease both; }
        `}</style>
      </head>
      <body style={{ minHeight: "100vh", background: "linear-gradient(145deg, #f0f4ff 0%, #faf5ff 50%, #f0fdf4 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px" }}>

        {/* Card */}
        <div className="card" style={{ background: "#fff", borderRadius: "20px", padding: "48px 44px", maxWidth: "460px", width: "100%", boxShadow: "0 8px 40px rgba(99,102,241,0.12), 0 1px 4px rgba(0,0,0,0.06)" }}>

          {/* Logo + brand */}
          <div style={{ textAlign: "center", marginBottom: "36px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
              <div style={{ width: "46px", height: "46px", background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", borderRadius: "13px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(99,102,241,0.35)" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 12h14M12 5l7 7-7 7" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span style={{ fontSize: "26px", fontWeight: "800", color: "#111827", letterSpacing: "-0.5px" }}>PreFlow</span>
            </div>
            <p style={{ margin: 0, color: "#6b7280", fontSize: "15px", lineHeight: 1.5 }}>
              Pre-order management for Shopify stores
            </p>
          </div>

          {/* Form */}
          <Form method="post">
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "7px", letterSpacing: "0.01em" }}>
                Your store domain
              </label>
              <input
                name="shop"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="yourstore.myshopify.com"
                style={{
                  display: "block",
                  width: "100%",
                  padding: "11px 14px",
                  fontSize: "15px",
                  color: "#111827",
                  background: "#f9fafb",
                  border: `2px solid ${errors.shop ? "#f87171" : "#e5e7eb"}`,
                  borderRadius: "10px",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
              />
              {errors.shop && (
                <p style={{ margin: "7px 0 0", fontSize: "13px", color: "#dc2626", display: "flex", alignItems: "center", gap: "5px" }}>
                  <span>⚠</span>
                  {errors.shop === LoginErrorType.InvalidShop
                    ? "Enter a valid Shopify domain, e.g. yourstore.myshopify.com"
                    : "Please enter your store domain to continue"}
                </p>
              )}
            </div>

            <button
              type="submit"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                width: "100%",
                padding: "13px",
                fontSize: "15px",
                fontWeight: "700",
                color: "#fff",
                background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                border: "none",
                borderRadius: "10px",
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(99,102,241,0.4)",
                letterSpacing: "0.01em",
              }}
            >
              Install PreFlow
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 8h10M8.5 3.5L13 8l-4.5 4.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </Form>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "28px 0 24px" }}>
            <div style={{ flex: 1, height: "1px", background: "#f3f4f6" }} />
            <span style={{ fontSize: "12px", color: "#d1d5db", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.08em" }}>Features</span>
            <div style={{ flex: 1, height: "1px", background: "#f3f4f6" }} />
          </div>

          {/* Feature list */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {[
              { icon: "🛍️", text: "Pre-order button" },
              { icon: "📧", text: "Confirmation emails" },
              { icon: "🔄", text: "Buyer cancellations" },
              { icon: "📊", text: "Usage dashboard" },
              { icon: "⚡", text: "Never blocks sales" },
              { icon: "💳", text: "Usage-based billing" },
            ].map(({ icon, text }) => (
              <div key={text} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", background: "#f9fafb", borderRadius: "8px" }}>
                <span style={{ fontSize: "16px", lineHeight: 1 }}>{icon}</span>
                <span style={{ fontSize: "13px", color: "#4b5563", fontWeight: "500" }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p style={{ marginTop: "20px", fontSize: "12px", color: "#9ca3af", textAlign: "center" }}>
          By installing PreFlow, you agree to our{" "}
          <a href="/privacy" style={{ color: "#6366f1", textDecoration: "none" }}>Privacy Policy</a>
        </p>

      </body>
    </html>
  );
}
