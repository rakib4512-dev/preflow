import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      {/* Background blobs */}
      <div className={styles.blob1} aria-hidden />
      <div className={styles.blob2} aria-hidden />

      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logoRow}>
          <div className={styles.logoIcon}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M12 5l7 7-7 7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className={styles.logoText}>PreFlow</span>
        </div>

        {/* Headline */}
        <h1 className={styles.heading}>Pre-orders that<br /><em>never block a sale</em></h1>
        <p className={styles.subtext}>
          Sell out-of-stock and unreleased products with a pre-order button,
          automatic emails, and self-service cancellations.
        </p>

        {/* Form */}
        {showForm && (
          <Form method="post" action="/auth/login" className={styles.form}>
            <div className={styles.inputGroup}>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="yourstore.myshopify.com"
                autoComplete="off"
                spellCheck={false}
              />
              <button className={styles.button} type="submit">
                Install free
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M8.5 3.5L13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <p className={styles.hint}>e.g. my-shop.myshopify.com · No credit card required</p>
          </Form>
        )}

        {/* Features */}
        <div className={styles.features}>
          {[
            { icon: "🛍️", title: "One-click pre-orders", desc: "Enable on any product; PreFlow handles the selling plan and storefront button." },
            { icon: "📧", title: "Customer notifications", desc: "Confirmation emails with a manage link and ship-date update alerts." },
            { icon: "💳", title: "Fair billing", desc: "Generous free tier. Pre-orders never stop — even past your plan limit." },
          ].map(({ icon, title, desc }) => (
            <div key={title} className={styles.featureCard}>
              <span className={styles.featureIcon}>{icon}</span>
              <strong className={styles.featureTitle}>{title}</strong>
              <p className={styles.featureDesc}>{desc}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <p className={styles.footer}>
          <a href="/privacy" className={styles.footerLink}>Privacy policy</a>
          <span className={styles.footerDot}>·</span>
          <a href="/support" className={styles.footerLink}>Support</a>
        </p>
      </div>
    </div>
  );
}
