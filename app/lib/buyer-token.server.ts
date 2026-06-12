import { createHmac, timingSafeEqual } from "crypto";

// 180 days — ship dates are routinely months out, so a 30-day link would
// expire before many customers ever need it.
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export type BuyerTokenPayload = {
  orderGid: string;
  shop: string;
  exp: number;
};

function secret(): string {
  const s = process.env.SHOPIFY_API_SECRET;
  if (!s) throw new Error("SHOPIFY_API_SECRET not set");
  return s;
}

export function createBuyerToken(orderGid: string, shop: string): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ orderGid, shop, exp })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyBuyerToken(token: string): BuyerTokenPayload | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac("sha256", secret()).update(payload).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as BuyerTokenPayload;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

