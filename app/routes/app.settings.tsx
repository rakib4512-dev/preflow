import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate, registerWebhooks } from "../shopify.server";
import prisma from "../db.server";

type Settings = {
  ownerEmail: string;
  fromEmail: string;
  cancelMode: "auto" | "request";
  notificationIntroText: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shop: session.shop },
    select: { settings: true },
  });

  const settings = (shop?.settings ?? {}) as Partial<Settings>;

  return {
    ownerEmail: settings.ownerEmail ?? "",
    fromEmail: settings.fromEmail ?? "",
    cancelMode: settings.cancelMode ?? "auto",
    notificationIntroText: settings.notificationIntroText ?? "",
  };
};

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;

  if (intent === "reregister") {
    await registerWebhooks({ session });
    return jsonRes({ reregistered: true });
  }

  const settings: Settings = {
    ownerEmail: (formData.get("ownerEmail") as string) || "",
    fromEmail: (formData.get("fromEmail") as string) || "",
    cancelMode: ((formData.get("cancelMode") as string) === "request" ? "request" : "auto") as "auto" | "request",
    notificationIntroText: (formData.get("notificationIntroText") as string) || "",
  };

  const existing = await prisma.shop.findUnique({
    where: { shop: session.shop },
    select: { settings: true },
  });
  const merged = { ...((existing?.settings ?? {}) as Record<string, unknown>), ...settings };

  await prisma.shop.update({
    where: { shop: session.shop },
    data: { settings: merged },
  });

  return jsonRes({ success: true });
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const saved = fetcher.data?.success;
  const isSaving = fetcher.state !== "idle";

  const webhookFetcher = useFetcher<typeof action>();

  const [ownerEmail, setOwnerEmail] = useState(data.ownerEmail);
  const [fromEmail, setFromEmail] = useState(data.fromEmail);
  const [cancelMode, setCancelMode] = useState<"auto" | "request">(data.cancelMode);
  const [notificationIntroText, setNotificationIntroText] = useState(data.notificationIntroText);
  const [toast, setToast] = useState(false);
  const [webhookToast, setWebhookToast] = useState(false);

  const handleReregister = useCallback(() => {
    const fd = new FormData();
    fd.append("intent", "reregister");
    webhookFetcher.submit(fd, { method: "POST" });
    setWebhookToast(true);
    setTimeout(() => setWebhookToast(false), 3500);
  }, [webhookFetcher]);

  const handleSave = useCallback(() => {
    const fd = new FormData();
    fd.append("ownerEmail", ownerEmail);
    fd.append("fromEmail", fromEmail);
    fd.append("cancelMode", cancelMode);
    fd.append("notificationIntroText", notificationIntroText);
    fetcher.submit(fd, { method: "POST" });
    setToast(true);
    setTimeout(() => setToast(false), 3000);
  }, [ownerEmail, fromEmail, cancelMode, notificationIntroText, fetcher]);

  return (
    <Page>
      <TitleBar title="Settings" />
      <style>{`
        .sf-section {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 28px 28px 24px;
          margin-bottom: 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        }
        .sf-section-header {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 20px;
        }
        .sf-icon-tile {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .sf-icon-tile-purple {
          background: linear-gradient(135deg, #7c3aed, #6366f1);
        }
        .sf-icon-tile-blue {
          background: linear-gradient(135deg, #2563eb, #4f46e5);
        }
        .sf-icon-tile-rose {
          background: linear-gradient(135deg, #db2777, #9333ea);
        }
        .sf-icon-tile-green {
          background: linear-gradient(135deg, #059669, #10b981);
        }
        .sf-section-title {
          font-size: 15px;
          font-weight: 650;
          color: #111827;
          margin: 0 0 2px;
          letter-spacing: -0.01em;
        }
        .sf-section-subtitle {
          font-size: 13px;
          color: #6b7280;
          margin: 0;
          line-height: 1.5;
        }
        .sf-divider {
          border: none;
          border-top: 1px solid #f0f0f4;
          margin: 0 0 20px;
        }
        .sf-field {
          margin-bottom: 18px;
        }
        .sf-field:last-child {
          margin-bottom: 0;
        }
        .sf-label {
          display: block;
          font-size: 13px;
          font-weight: 560;
          color: #374151;
          margin-bottom: 6px;
        }
        .sf-input {
          width: 100%;
          padding: 9px 13px;
          border: 1.5px solid #d1d5db;
          border-radius: 8px;
          font-size: 14px;
          color: #111827;
          background: #fafafa;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
          outline: none;
          font-family: inherit;
        }
        .sf-input:focus {
          border-color: #7c3aed;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(124,58,237,0.12);
        }
        .sf-textarea {
          resize: vertical;
          min-height: 80px;
          line-height: 1.5;
        }
        .sf-help {
          font-size: 12px;
          color: #9ca3af;
          margin-top: 5px;
          line-height: 1.5;
        }
        .sf-select-wrapper {
          position: relative;
        }
        .sf-select {
          appearance: none;
          -webkit-appearance: none;
          width: 100%;
          padding: 9px 36px 9px 13px;
          border: 1.5px solid #d1d5db;
          border-radius: 8px;
          font-size: 14px;
          color: #111827;
          background: #fafafa;
          cursor: pointer;
          box-sizing: border-box;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
          outline: none;
          font-family: inherit;
        }
        .sf-select:focus {
          border-color: #7c3aed;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(124,58,237,0.12);
        }
        .sf-select-chevron {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          color: #6b7280;
        }
        .sf-cancel-hint {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          background: #f5f3ff;
          border: 1px solid #ede9fe;
          border-radius: 8px;
          padding: 12px 14px;
          margin-top: 14px;
        }
        .sf-cancel-hint-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #7c3aed;
          flex-shrink: 0;
          margin-top: 4px;
        }
        .sf-cancel-hint-text {
          font-size: 13px;
          color: #5b21b6;
          line-height: 1.5;
          margin: 0;
        }
        .sf-info-box {
          display: flex;
          gap: 12px;
          background: #f8faff;
          border: 1px solid #e0e7ff;
          border-radius: 8px;
          padding: 14px 16px;
          align-items: flex-start;
        }
        .sf-info-icon {
          flex-shrink: 0;
          margin-top: 1px;
        }
        .sf-info-text {
          font-size: 13.5px;
          color: #374151;
          line-height: 1.6;
          margin: 0;
        }
        .sf-info-text strong {
          color: #1e1b4b;
          font-weight: 600;
        }
        .sf-info-text code {
          background: #e0e7ff;
          color: #3730a3;
          padding: 1px 5px;
          border-radius: 4px;
          font-size: 12.5px;
          font-family: ui-monospace, monospace;
        }
        .sf-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 0 8px;
        }
        .sf-toast {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #15803d;
          font-size: 13px;
          font-weight: 500;
          padding: 7px 14px;
          border-radius: 8px;
          transition: opacity 0.3s;
        }
        .sf-toast-hidden {
          opacity: 0;
          pointer-events: none;
        }
        .btn-save {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 11px 28px;
          background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          border: none;
          border-radius: 9px;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(124,58,237,0.35);
          transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
          letter-spacing: 0.01em;
          font-family: inherit;
        }
        .btn-save:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(124,58,237,0.45);
        }
        .btn-save:active:not(:disabled) {
          transform: translateY(0);
          box-shadow: 0 2px 8px rgba(124,58,237,0.3);
        }
        .btn-save:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .btn-secondary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 20px;
          background: #fff;
          color: #374151;
          font-size: 13.5px;
          font-weight: 600;
          border: 1.5px solid #d1d5db;
          border-radius: 8px;
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s, color 0.15s;
          font-family: inherit;
        }
        .btn-secondary:hover:not(:disabled) {
          border-color: #059669;
          color: #059669;
          background: #f0fdf4;
        }
        .btn-secondary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .sf-toast-webhook {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #15803d;
          font-size: 13px;
          font-weight: 500;
          padding: 7px 14px;
          border-radius: 8px;
          transition: opacity 0.3s;
        }
        .btn-save-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,0.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={{ maxWidth: 680, margin: "0 auto", paddingBottom: 40 }}>

        {/* Storefront button section */}
        <div className="sf-section">
          <div className="sf-section-header">
            <div className="sf-icon-tile sf-icon-tile-purple">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 22V12h6v10" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="sf-section-title">Storefront button</p>
              <p className="sf-section-subtitle">Configure appearance in your theme editor</p>
            </div>
          </div>
          <hr className="sf-divider" />
          <div className="sf-info-box">
            <span className="sf-info-icon">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="#4f46e5" strokeWidth="1.5"/>
                <path d="M12 8v4M12 16h.01" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </span>
            <p className="sf-info-text">
              Button text, colors, and subtext are configured in your <strong>theme editor</strong>:<br/>
              Online Store &rarr; Themes &rarr; Customize &rarr; select the <code>Pre-order Button</code> block.<br/>
              Per-product messages are set on the <strong>Products</strong> page.
            </p>
          </div>
        </div>

        {/* Notifications section */}
        <div className="sf-section">
          <div className="sf-section-header">
            <div className="sf-icon-tile sf-icon-tile-blue">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="sf-section-title">Notifications</p>
              <p className="sf-section-subtitle">Email addresses used for sending and receiving alerts</p>
            </div>
          </div>
          <hr className="sf-divider" />

          <div className="sf-field">
            <label className="sf-label" htmlFor="ownerEmail">Owner / billing email</label>
            <input
              id="ownerEmail"
              className="sf-input"
              type="email"
              autoComplete="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <p className="sf-help">Receives usage warning emails at 70% and 100% of your plan limit.</p>
          </div>

          <div className="sf-field">
            <label className="sf-label" htmlFor="fromEmail">From email address</label>
            <input
              id="fromEmail"
              className="sf-input"
              type="email"
              autoComplete="email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="orders@yourdomain.com"
            />
            <p className="sf-help">Emails to customers are sent from this address. Must be a domain verified in your <strong>Resend</strong> account (resend.com &rarr; Domains).</p>
          </div>

          <div className="sf-field">
            <label className="sf-label" htmlFor="introText">Confirmation email intro (optional)</label>
            <textarea
              id="introText"
              className="sf-input sf-textarea"
              autoComplete="off"
              value={notificationIntroText}
              onChange={(e) => setNotificationIntroText(e.target.value)}
              placeholder="e.g. Thank you for your pre-order! We'll notify you as soon as your item ships."
            />
            <p className="sf-help">Shown at the top of every pre-order confirmation and ship-date update email.</p>
          </div>
        </div>

        {/* Buyer cancellation section */}
        <div className="sf-section">
          <div className="sf-section-header">
            <div className="sf-icon-tile sf-icon-tile-rose">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="7" r="4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="sf-section-title">Buyer cancellation</p>
              <p className="sf-section-subtitle">How to handle cancellation requests from customers</p>
            </div>
          </div>
          <hr className="sf-divider" />

          <div className="sf-field">
            <label className="sf-label" htmlFor="cancelMode">Cancellation mode</label>
            <div className="sf-select-wrapper">
              <select
                id="cancelMode"
                className="sf-select"
                value={cancelMode}
                onChange={(e) => setCancelMode(e.target.value as "auto" | "request")}
              >
                <option value="auto">Auto-cancel &amp; refund (recommended)</option>
                <option value="request">Request only -- merchant reviews manually</option>
              </select>
              <span className="sf-select-chevron">
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </div>
          </div>

          <div className="sf-cancel-hint">
            <div className="sf-cancel-hint-dot" />
            <p className="sf-cancel-hint-text">
              {cancelMode === "auto"
                ? "Orders are cancelled and refunded immediately via the original payment method when a buyer requests cancellation."
                : "Buyers see a confirmation that their request was received. You will be notified by email to review and process manually."}
            </p>
          </div>
        </div>

        {/* Webhooks section */}
        <div className="sf-section">
          <div className="sf-section-header">
            <div className="sf-icon-tile sf-icon-tile-green">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 3h6v6M10 14L21 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="sf-section-title">Webhooks</p>
              <p className="sf-section-subtitle">Shopify event listeners that power order tracking</p>
            </div>
          </div>
          <hr className="sf-divider" />
          <div className="sf-info-box" style={{ marginBottom: 16 }}>
            <span className="sf-info-icon">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="#4f46e5" strokeWidth="1.5"/>
                <path d="M12 8v4M12 16h.01" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </span>
            <p className="sf-info-text">
              If the <strong>orders/create</strong> webhook shows an <strong>Invalid URL</strong> error in the Shopify Partner Dashboard,
              click <strong>Re-register</strong> below to re-point it to this app's live URL. You only need to do this once after moving from dev to production.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              className="btn-secondary"
              onClick={handleReregister}
              disabled={webhookFetcher.state !== "idle"}
            >
              {webhookFetcher.state !== "idle" ? (
                <>
                  <span className="btn-save-spinner" style={{ borderColor: "rgba(0,0,0,0.2)", borderTopColor: "#374151" }} />
                  Registering…
                </>
              ) : (
                <>
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Re-register webhooks
                </>
              )}
            </button>
            {webhookToast && webhookFetcher.data && (
              <span className="sf-toast-webhook">
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <path d="M20 6L9 17l-5-5" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Webhooks re-registered
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sf-footer">
          <div className={`sf-toast${saved && toast ? "" : " sf-toast-hidden"}`}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M20 6L9 17l-5-5" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Settings saved
          </div>
          <button
            className="btn-save"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <span className="btn-save-spinner" />
                Saving...
              </>
            ) : (
              <>
                Save settings
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                  <path d="M5 12h14M12 5l7 7-7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </Page>
  );
}
