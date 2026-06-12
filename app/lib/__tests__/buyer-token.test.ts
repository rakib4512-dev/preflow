import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  process.env.SHOPIFY_API_SECRET = "test-secret-key-32chars-long-ok!";
});

// Dynamic import so env is set before module loads
async function getTokenFns() {
  vi.resetModules();
  const mod = await import("../buyer-token.server");
  return { createBuyerToken: mod.createBuyerToken, verifyBuyerToken: mod.verifyBuyerToken };
}

describe("createBuyerToken / verifyBuyerToken", () => {
  it("round-trips payload correctly", async () => {
    const { createBuyerToken, verifyBuyerToken } = await getTokenFns();
    const token = createBuyerToken("gid://shopify/Order/123", "test.myshopify.com");
    const payload = verifyBuyerToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.orderGid).toBe("gid://shopify/Order/123");
    expect(payload?.shop).toBe("test.myshopify.com");
  });

  it("returns null for a tampered signature", async () => {
    const { createBuyerToken, verifyBuyerToken } = await getTokenFns();
    const token = createBuyerToken("gid://shopify/Order/456", "test.myshopify.com");
    const tampered = token.slice(0, -4) + "xxxx";
    expect(verifyBuyerToken(tampered)).toBeNull();
  });

  it("returns null for a tampered payload", async () => {
    const { createBuyerToken, verifyBuyerToken } = await getTokenFns();
    const token = createBuyerToken("gid://shopify/Order/789", "test.myshopify.com");
    const parts = token.split(".");
    const fakePayload = Buffer.from(JSON.stringify({ orderGid: "gid://shopify/Order/EVIL", shop: "evil.myshopify.com", exp: Date.now() + 9999 })).toString("base64url");
    const tampered = `${fakePayload}.${parts[parts.length - 1]}`;
    expect(verifyBuyerToken(tampered)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const { createBuyerToken, verifyBuyerToken } = await getTokenFns();
    const token = createBuyerToken("gid://shopify/Order/999", "test.myshopify.com");
    // Parse and re-sign with past exp
    const dot = token.lastIndexOf(".");
    const payloadStr = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
    const parsed = JSON.parse(payloadStr);
    parsed.exp = Date.now() - 1000; // already expired
    const { createHmac } = await import("crypto");
    const newPayload = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    const newSig = createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(newPayload).digest("hex");
    const expiredToken = `${newPayload}.${newSig}`;
    expect(verifyBuyerToken(expiredToken)).toBeNull();
  });

  it("returns null for a malformed token", async () => {
    const { verifyBuyerToken } = await getTokenFns();
    expect(verifyBuyerToken("notavalidtoken")).toBeNull();
    expect(verifyBuyerToken("")).toBeNull();
    expect(verifyBuyerToken("abc.")).toBeNull();
  });
});
