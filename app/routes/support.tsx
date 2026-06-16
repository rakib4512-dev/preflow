import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "Support — PreFlow" },
  { name: "description", content: "Get help with the PreFlow pre-order app for Shopify." },
];

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "The pre-order button isn't showing on my product page.",
    a: "Make sure (1) pre-order is enabled for the product in PreFlow → Products, and (2) the Pre-order Button block is added to your product template in the theme editor: Online Store → Themes → Customize → product page → Add block → Pre-order Button. Changes can take up to a minute to appear due to storefront caching.",
  },
  {
    q: "How do customers pay for pre-orders?",
    a: "Customers pay in full at checkout. PreFlow attaches a pre-order selling plan to the cart so the order is clearly marked for deferred fulfillment.",
  },
  {
    q: "Can customers cancel their pre-order?",
    a: "Yes. Every pre-order confirmation email includes a “Manage my pre-order” link. Depending on your settings, cancellations are processed automatically with a refund, or sent to you as a request.",
  },
  {
    q: "What happens when I change a ship date?",
    a: "If the new date is later than the old one, PreFlow asks you to confirm and then emails every customer with an open pre-order for that product.",
  },
  {
    q: "How does billing work?",
    a: "Free: 10 pre-orders/month. Growth ($15/mo): 300 pre-orders/month, overage at $0.05 per extra order capped at $14 per cycle. Pro ($29/mo): unlimited. Pre-orders never stop working when you hit a limit.",
  },
];

export default function Support() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Support — PreFlow</title>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }
          h1, h2, p { margin: 0; padding: 0; }
          a { color: #6366f1; text-decoration: none; }
          a:hover { text-decoration: underline; }
          details > summary { list-style: none; }
          details > summary::-webkit-details-marker { display: none; }
          details[open] .chevron { transform: rotate(180deg); }
          .chevron { transition: transform 0.2s ease; }
        `}</style>
      </head>
      <body style={{ minHeight: "100vh", background: "linear-gradient(145deg, #f0f4ff 0%, #faf5ff 55%, #f0fdf4 100%)", padding: "40px 20px" }}>

        {/* Top nav */}
        <div style={{ maxWidth: 760, margin: "0 auto 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: "8px", textDecoration: "none" }}>
            <div style={{ width: "32px", height: "32px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <span style={{ fontWeight: 800, fontSize: "17px", color: "#111827" }}>PreFlow</span>
          </a>
          <a href="/privacy" style={{ fontSize: "14px", color: "#6366f1", fontWeight: 500 }}>Privacy policy →</a>
        </div>

        {/* Main card */}
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>

          {/* Hero */}
          <div style={{ background: "#fff", borderRadius: "20px", padding: "40px 48px", boxShadow: "0 4px 6px rgba(0,0,0,0.04), 0 10px 40px rgba(99,102,241,0.09)" }}>
            <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#111827", marginBottom: "12px" }}>Support</h1>
            <p style={{ fontSize: "15px", color: "#4b5563", lineHeight: 1.7, marginBottom: "12px" }}>
              Need help with PreFlow? We&rsquo;ll get back to you within one business day.
              Please include your store&rsquo;s myshopify.com domain so we can look into your setup right away.
            </p>
            <p style={{ fontSize: "15px", color: "#4b5563" }}>
              Email us at{" "}
              <a href="mailto:rakibpabna426@gmail.com" style={{ color: "#6366f1", fontWeight: 600 }}>
                rakibpabna426@gmail.com
              </a>
            </p>
          </div>

          {/* FAQ */}
          <div style={{ background: "#fff", borderRadius: "20px", padding: "40px 48px", boxShadow: "0 4px 6px rgba(0,0,0,0.04), 0 10px 40px rgba(99,102,241,0.09)" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "20px" }}>Frequently asked questions</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {FAQS.map((f, i) => (
                <details key={i} style={{ border: "1.5px solid #f3f4f6", borderRadius: "12px", overflow: "hidden" }}>
                  <summary style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px",
                    padding: "16px 20px",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "14px",
                    color: "#111827",
                    listStyle: "none",
                    userSelect: "none",
                  }}>
                    {f.q}
                    <svg className="chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                      <path d="M4 6l4 4 4-4" stroke="#6b7280" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </summary>
                  <p style={{ padding: "0 20px 18px", fontSize: "14px", color: "#4b5563", lineHeight: 1.7 }}>
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>

        </div>

        {/* Footer */}
        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "#9ca3af" }}>
          <a href="/" style={{ color: "#6366f1", fontWeight: 500 }}>← Back to PreFlow</a>
          <span style={{ margin: "0 10px", color: "#d1d5db" }}>·</span>
          <a href="/privacy" style={{ color: "#6366f1", fontWeight: 500 }}>Privacy policy</a>
        </p>

      </body>
    </html>
  );
}
