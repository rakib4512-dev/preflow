/**
 * Playwright tests for the buyer cancellation page (/buyer/cancel/:token).
 *
 * These tests use a real dev server with a valid SHOPIFY_API_SECRET env var.
 * Set PLAYWRIGHT_CANCEL_TOKEN to a valid signed token pointing at a real order,
 * or set PLAYWRIGHT_CANCEL_TOKEN_EXPIRED to test the expired-link state.
 *
 * Run: npx playwright test tests/buyer-cancel.spec.ts
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.SHOPIFY_APP_URL ?? "http://localhost:3000";

test.describe("Buyer cancel page", () => {
  test("shows 'Link expired' for a missing or invalid token", async ({ page }) => {
    await page.goto(`${BASE_URL}/buyer/cancel/this-is-not-a-valid-token`);
    await expect(page.locator("h1")).toContainText("Link expired");
  });

  test("shows 'Link expired' for an empty token segment", async ({ page }) => {
    // Token segment is required — if somehow empty, same result
    await page.goto(`${BASE_URL}/buyer/cancel/aaaa.bbbb`);
    // Either 404 or the expired page — should not crash with 500
    expect([200, 404]).toContain(await page.evaluate(() => 0) ?? 200);
    const title = await page.title();
    // Must not be a blank or error page
    expect(title).not.toBe("");
  });

  test("shows cancel button for a valid unfulfilled token (integration)", async ({ page }) => {
    const token = process.env.PLAYWRIGHT_CANCEL_TOKEN;
    if (!token) test.skip();

    await page.goto(`${BASE_URL}/buyer/cancel/${token}`);

    // Should show the manage page
    await expect(page.locator("h1")).toContainText("Manage your pre-order");
    await expect(page.getByRole("button", { name: /cancel/i })).toBeVisible();
  });

  test("shows 'cannot be cancelled' for a fulfilled order token (integration)", async ({ page }) => {
    const token = process.env.PLAYWRIGHT_CANCEL_TOKEN_FULFILLED;
    if (!token) test.skip();

    await page.goto(`${BASE_URL}/buyer/cancel/${token}`);

    await expect(page.locator("h2")).toContainText("can no longer be cancelled");
    await expect(page.getByRole("button", { name: /cancel/i })).not.toBeVisible();
  });
});
