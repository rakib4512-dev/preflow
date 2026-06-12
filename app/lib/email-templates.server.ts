export type ShipDateDelayParams = {
  storeName: string;
  productTitle: string;
  oldDate: string;
  newDate: string;
  orderStatusUrl: string;
  introText?: string;
};

export type BuyerCancelLinkParams = {
  storeName: string;
  productTitle: string;
  shipDate: string | null;
  manageUrl: string;
  introText?: string;
};

export type MerchantCancelNotifyParams = {
  storeName: string;
  productTitle: string;
  orderGid: string;
  customerEmail: string;
  cancelType: "buyer_cancel" | "buyer_cancel_request";
};

export function shipDateDelayEmail(p: ShipDateDelayParams): { subject: string; html: string; text: string } {
  const subject = `Update on your pre-order from ${p.storeName}`;
  const intro = p.introText
    ? `<p>${escHtml(p.introText)}</p>`
    : `<p>Thank you for your pre-order. We have an update regarding your shipment timeline.</p>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escHtml(subject)}</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#333">
  <h2 style="margin-top:0">${escHtml(storeName(p.storeName))}</h2>
  ${intro}
  <p>Your pre-order for <strong>${escHtml(p.productTitle)}</strong> has a new estimated ship date.</p>
  <table style="border-collapse:collapse;margin:16px 0">
    <tr>
      <td style="padding:8px 16px 8px 0;color:#666">Previous date</td>
      <td style="padding:8px 0"><s>${escHtml(p.oldDate)}</s></td>
    </tr>
    <tr>
      <td style="padding:8px 16px 8px 0;color:#666">New estimated date</td>
      <td style="padding:8px 0;font-weight:bold">${escHtml(p.newDate)}</td>
    </tr>
  </table>
  <p>Your order is still confirmed. If you have questions, you can view your order status below.</p>
  <p><a href="${escHtml(p.orderStatusUrl)}" style="background:#000;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">View order status</a></p>
  <p style="color:#888;font-size:12px">You received this email because you placed a pre-order with ${escHtml(p.storeName)}.</p>
</body>
</html>`;

  const text = `Update on your pre-order from ${p.storeName}\n\n${p.introText ?? "Thank you for your pre-order."}\n\nYour pre-order for "${p.productTitle}" has a new estimated ship date.\n\nPrevious: ${p.oldDate}\nNew date: ${p.newDate}\n\nView your order: ${p.orderStatusUrl}`;

  return { subject, html, text };
}

export function buyerCancelLinkEmail(p: BuyerCancelLinkParams): { subject: string; html: string; text: string } {
  const subject = `Your pre-order from ${p.storeName} is confirmed`;
  const intro = p.introText
    ? `<p>${escHtml(p.introText)}</p>`
    : `<p>Thank you for your pre-order! We will prepare your order for shipment.</p>`;
  const shipLine = p.shipDate
    ? `<p>Estimated ship date: <strong>${escHtml(p.shipDate)}</strong></p>`
    : `<p>We will ship your order as soon as stock is available.</p>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escHtml(subject)}</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#333">
  <h2 style="margin-top:0">${escHtml(storeName(p.storeName))}</h2>
  ${intro}
  <p>You pre-ordered: <strong>${escHtml(p.productTitle)}</strong></p>
  ${shipLine}
  <p>Need to make changes? You can manage your pre-order any time:</p>
  <p><a href="${escHtml(p.manageUrl)}" style="background:#000;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">Manage my pre-order</a></p>
  <p style="color:#888;font-size:12px">You received this email because you placed a pre-order with ${escHtml(p.storeName)}.</p>
</body>
</html>`;

  const text = `Your pre-order from ${p.storeName} is confirmed\n\n${p.introText ?? "Thank you for your pre-order!"}\n\nProduct: ${p.productTitle}\n${p.shipDate ? `Estimated ship date: ${p.shipDate}` : "Ships when available"}\n\nManage your pre-order: ${p.manageUrl}`;

  return { subject, html, text };
}

export function merchantCancelNotifyEmail(p: MerchantCancelNotifyParams): { subject: string; html: string; text: string } {
  const isAuto = p.cancelType === "buyer_cancel";
  const subject = isAuto
    ? `[PreFlow] Pre-order self-cancelled — ${p.storeName}`
    : `[PreFlow] Cancellation request — ${p.storeName}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escHtml(subject)}</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#333">
  <h2 style="margin-top:0">${escHtml(subject)}</h2>
  <p>A pre-order ${isAuto ? "was automatically cancelled" : "cancellation was requested"} by a buyer.</p>
  <table style="border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:4px 16px 4px 0;color:#666">Product</td><td>${escHtml(p.productTitle)}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#666">Customer</td><td>${escHtml(p.customerEmail)}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#666">Order ID</td><td style="font-family:monospace">${escHtml(p.orderGid)}</td></tr>
  </table>
  ${isAuto
    ? "<p>The order has been cancelled and refunded to the original payment method.</p>"
    : "<p>Please review this request in your Shopify admin and process the cancellation manually.</p>"}
</body>
</html>`;

  const text = `${subject}\n\nProduct: ${p.productTitle}\nCustomer: ${p.customerEmail}\nOrder: ${p.orderGid}\n\n${isAuto ? "Order cancelled and refunded." : "Please review in Shopify admin."}`;

  return { subject, html, text };
}

function storeName(name: string) {
  return name;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
