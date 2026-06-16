import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — PreFlow" },
  { name: "description", content: "How PreFlow collects, uses, and protects merchant and customer data." },
];

export default function PrivacyPolicy() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Privacy Policy — PreFlow</title>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }
          h1, h2, h3, p, ul, li { margin: 0; padding: 0; }
          a { color: #6366f1; text-decoration: none; }
          a:hover { text-decoration: underline; }
          code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; color: #374151; }
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
          <a href="/support" style={{ fontSize: "14px", color: "#6366f1", fontWeight: 500 }}>Support →</a>
        </div>

        {/* Card */}
        <article style={{ maxWidth: 760, margin: "0 auto", background: "#fff", borderRadius: "20px", padding: "48px 52px", boxShadow: "0 4px 6px rgba(0,0,0,0.04), 0 10px 40px rgba(99,102,241,0.09)", lineHeight: 1.7, color: "#374151" }}>

          <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#111827", marginBottom: "4px" }}>Privacy Policy</h1>
          <p style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "32px" }}>Last updated: June 12, 2026</p>

          <p style={{ fontSize: "15px", marginBottom: "28px" }}>
            PreFlow (&ldquo;the App&rdquo;) provides pre-order functionality for Shopify stores
            (&ldquo;the Service&rdquo;) to merchants who use Shopify to power their stores. This
            policy describes how personal information is collected, used, and shared when you
            install or use the App in connection with your Shopify-supported store.
          </p>

          <Section title="Information the App collects">
            <p style={{ fontSize: "15px", marginBottom: "12px" }}>When you install the App, we access certain information from your Shopify account via Shopify&rsquo;s APIs:</p>
            <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }}>
              <li><strong>Store information:</strong> your store&rsquo;s myshopify.com domain and plan/subscription status with PreFlow.</li>
              <li><strong>Product information:</strong> product and variant IDs, titles, inventory policies, and tags for products you enable pre-orders on.</li>
              <li><strong>Order information:</strong> order IDs, line items (product, variant, quantity, price), and fulfillment status for orders containing pre-order items.</li>
              <li><strong>Customer information:</strong> the email address attached to a pre-order, used solely to send transactional pre-order notifications.</li>
              <li><strong>Information you provide directly:</strong> settings you enter in the App, such as your notification email address, custom email text, and cancellation preferences.</li>
            </ul>
            <p style={{ fontSize: "15px", marginTop: "12px" }}>The App does not collect payment card details, browsing behavior, or any data from your storefront visitors beyond what is described above.</p>
          </Section>

          <Section title="How we use the information">
            <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }}>
              <li>To operate the Service: showing pre-order buttons, applying selling plans, tracking pre-orders, and managing inventory policies.</li>
              <li>To send transactional emails to your customers about their pre-orders (confirmation and ship-date updates). We never send marketing email to your customers.</li>
              <li>To send you usage and billing notifications about your PreFlow plan.</li>
              <li>To comply with applicable laws and Shopify&rsquo;s API terms.</li>
            </ul>
            <p style={{ fontSize: "15px", marginTop: "12px" }}>We do not sell, rent, or share personal information with third parties for advertising.</p>
          </Section>

          <Section title="Service providers">
            <p style={{ fontSize: "15px", marginBottom: "12px" }}>We share data only with the providers needed to run the Service:</p>
            <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }}>
              <li><strong>Shopify</strong> — platform APIs and billing.</li>
              <li><strong>Resend</strong> — delivery of transactional email (recipient email address and message content only).</li>
              <li><strong>Our hosting and database providers</strong> — store the data described above on encrypted infrastructure.</li>
            </ul>
          </Section>

          <Section title="Data retention and deletion">
            <ul style={{ paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px" }}>
              <li>When you uninstall the App, Shopify notifies us and your store&rsquo;s data is scheduled for deletion; on receipt of Shopify&rsquo;s <code>shop/redact</code> request (sent ~48 hours after uninstall) all stored data for your store is permanently deleted.</li>
              <li>When Shopify sends a customer redaction request (<code>customers/redact</code>), we delete stored records associated with that customer&rsquo;s orders.</li>
              <li>Customer data requests (<code>customers/data_request</code>) are honored within 30 days via our support email.</li>
            </ul>
          </Section>

          <Section title="GDPR & CCPA">
            <p style={{ fontSize: "15px" }}>
              If you are a European resident, you have the right to access the personal information
              we hold about you and to ask that it be corrected, updated, or deleted. If you are a
              California resident, you have equivalent rights under the CCPA. To exercise these
              rights, contact us at the email below. Note that for customer data on a merchant&rsquo;s
              store, the merchant is the data controller and PreFlow acts as a processor.
            </p>
          </Section>

          <Section title="Changes">
            <p style={{ fontSize: "15px" }}>
              We may update this policy to reflect changes to our practices or for legal reasons.
              Material changes will be announced inside the App.
            </p>
          </Section>

          <Section title="Contact us">
            <p style={{ fontSize: "15px" }}>
              For questions about this policy or our data practices, email{" "}
              <a href="mailto:rakibpabna426@gmail.com">rakibpabna426@gmail.com</a>.
            </p>
          </Section>
        </article>

        {/* Footer */}
        <p style={{ textAlign: "center", marginTop: "24px", fontSize: "13px", color: "#9ca3af" }}>
          <a href="/" style={{ color: "#6366f1", fontWeight: 500 }}>← Back to PreFlow</a>
          <span style={{ margin: "0 10px", color: "#d1d5db" }}>·</span>
          <a href="/support" style={{ color: "#6366f1", fontWeight: 500 }}>Support</a>
        </p>

      </body>
    </html>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "28px", paddingTop: "28px", borderTop: "1px solid #f3f4f6" }}>
      <h2 style={{ fontSize: "17px", fontWeight: 700, color: "#111827", marginBottom: "12px" }}>{title}</h2>
      {children}
    </div>
  );
}
