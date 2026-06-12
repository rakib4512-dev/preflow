import type { MetaFunction } from "@remix-run/node";

// Public support page — linked from the App Store listing and landing page.

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
    <main style={page}>
      <h1 style={h1}>PreFlow Support</h1>
      <p>
        Need help with PreFlow? Email us at{" "}
        <a href="mailto:rakibpabna426@gmail.com" style={link}>rakibpabna426@gmail.com</a>{" "}
        and we&rsquo;ll get back to you within one business day.
      </p>
      <p style={muted}>
        Please include your store&rsquo;s myshopify.com domain so we can look into your setup right away.
      </p>

      <h2 style={h2}>Frequently asked questions</h2>
      {FAQS.map((f, i) => (
        <details key={i} style={details}>
          <summary style={summary}>{f.q}</summary>
          <p style={{ marginTop: 8 }}>{f.a}</p>
        </details>
      ))}

      <p style={{ ...muted, marginTop: 40 }}>
        <a href="/privacy" style={link}>Privacy policy</a>
      </p>
    </main>
  );
}

const page: React.CSSProperties = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  maxWidth: 720,
  margin: "0 auto",
  padding: "48px 24px",
  color: "#202223",
  lineHeight: 1.6,
};
const h1: React.CSSProperties = { fontSize: 32, marginBottom: 8 };
const h2: React.CSSProperties = { fontSize: 20, marginTop: 32 };
const muted: React.CSSProperties = { color: "#6d7175" };
const link: React.CSSProperties = { color: "#2c6ecb" };
const details: React.CSSProperties = {
  border: "1px solid #e1e3e5",
  borderRadius: 8,
  padding: "12px 16px",
  marginBottom: 8,
};
const summary: React.CSSProperties = { cursor: "pointer", fontWeight: 600 };
