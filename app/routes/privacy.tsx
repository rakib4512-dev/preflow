import type { MetaFunction } from "@remix-run/node";

// Public privacy policy — linked from the Shopify App Store listing
// (required field) and from the app's landing page footer.

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — PreFlow" },
  { name: "description", content: "How PreFlow collects, uses, and protects merchant and customer data." },
];

export default function PrivacyPolicy() {
  return (
    <main style={page}>
      <h1 style={h1}>PreFlow Privacy Policy</h1>
      <p style={muted}>Last updated: June 12, 2026</p>

      <p>
        PreFlow (&ldquo;the App&rdquo;) provides pre-order functionality for Shopify stores
        (&ldquo;the Service&rdquo;) to merchants who use Shopify to power their stores. This
        policy describes how personal information is collected, used, and shared when you
        install or use the App in connection with your Shopify-supported store.
      </p>

      <h2 style={h2}>Information the App collects</h2>
      <p>When you install the App, we access certain information from your Shopify account via Shopify&rsquo;s APIs:</p>
      <ul style={list}>
        <li><strong>Store information:</strong> your store&rsquo;s myshopify.com domain and plan/subscription status with PreFlow.</li>
        <li><strong>Product information:</strong> product and variant IDs, titles, inventory policies, and tags for products you enable pre-orders on.</li>
        <li><strong>Order information:</strong> order IDs, line items (product, variant, quantity, price), and fulfillment status for orders containing pre-order items.</li>
        <li><strong>Customer information:</strong> the email address attached to a pre-order, used solely to send transactional pre-order notifications (order confirmation with a self-service management link, and ship-date change notices).</li>
        <li><strong>Information you provide directly:</strong> settings you enter in the App, such as your notification email address, custom email text, and cancellation preferences.</li>
      </ul>
      <p>
        The App does not collect payment card details, browsing behavior, or any data from
        your storefront visitors beyond what is described above.
      </p>

      <h2 style={h2}>How we use the information</h2>
      <ul style={list}>
        <li>To operate the Service: showing pre-order buttons, applying selling plans, tracking pre-orders, and managing inventory policies.</li>
        <li>To send transactional emails to your customers about their pre-orders (confirmation and ship-date updates). We never send marketing email to your customers.</li>
        <li>To send you usage and billing notifications about your PreFlow plan.</li>
        <li>To comply with applicable laws and Shopify&rsquo;s API terms.</li>
      </ul>
      <p>We do not sell, rent, or share personal information with third parties for advertising.</p>

      <h2 style={h2}>Service providers</h2>
      <p>We share data only with the providers needed to run the Service:</p>
      <ul style={list}>
        <li><strong>Shopify</strong> — platform APIs and billing.</li>
        <li><strong>Resend</strong> — delivery of transactional email (recipient email address and message content only).</li>
        <li><strong>Our hosting and database providers</strong> — store the data described above on encrypted infrastructure.</li>
      </ul>

      <h2 style={h2}>Data retention and deletion</h2>
      <ul style={list}>
        <li>When you uninstall the App, Shopify notifies us and your store&rsquo;s data is scheduled for deletion; on receipt of Shopify&rsquo;s <code>shop/redact</code> request (sent ~48 hours after uninstall) all stored data for your store is permanently deleted.</li>
        <li>When Shopify sends a customer redaction request (<code>customers/redact</code>), we delete stored records associated with that customer&rsquo;s orders.</li>
        <li>Customer data requests (<code>customers/data_request</code>) are honored within 30 days via our support email.</li>
      </ul>

      <h2 style={h2}>GDPR &amp; CCPA</h2>
      <p>
        If you are a European resident, you have the right to access the personal information
        we hold about you and to ask that it be corrected, updated, or deleted. If you are a
        California resident, you have equivalent rights under the CCPA. To exercise these
        rights, contact us at the email below. Note that for customer data on a merchant&rsquo;s
        store, the merchant is the data controller and PreFlow acts as a processor.
      </p>

      <h2 style={h2}>Changes</h2>
      <p>
        We may update this policy to reflect changes to our practices or for legal reasons.
        Material changes will be announced inside the App.
      </p>

      <h2 style={h2}>Contact us</h2>
      <p>
        For questions about this policy or our data practices, email{" "}
        <a href="mailto:rakibpabna426@gmail.com">rakibpabna426@gmail.com</a>.
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
const h1: React.CSSProperties = { fontSize: 32, marginBottom: 4 };
const h2: React.CSSProperties = { fontSize: 20, marginTop: 32 };
const muted: React.CSSProperties = { color: "#6d7175", marginTop: 0 };
const list: React.CSSProperties = { paddingLeft: 22 };
