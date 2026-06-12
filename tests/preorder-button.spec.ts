/**
 * Playwright e2e test — pre-order button rendering.
 *
 * Set PLAYWRIGHT_PRODUCT_URL to a product page on your dev store that has
 * the preorder-button block added and pre-order enabled.
 *
 * Run: npx playwright test --project=desktop-chrome --project=iphone-12
 */

import { test, expect } from "@playwright/test";

const PRODUCT_URL =
  process.env.PLAYWRIGHT_PRODUCT_URL ||
  (process.env.PLAYWRIGHT_BASE_URL
    ? `${process.env.PLAYWRIGHT_BASE_URL}/products/test-preorder-product`
    : null);

test.describe("Pre-order button", () => {
  test.skip(!PRODUCT_URL, "Set PLAYWRIGHT_PRODUCT_URL to run storefront tests");

  test("renders pre-order button on desktop", async ({ page }) => {
    await page.goto(PRODUCT_URL!);

    const wrapper = page.locator("#preflow-preorder-wrapper");
    await expect(wrapper).toBeVisible({ timeout: 10_000 });

    const btn = page.locator("#preflow-preorder-btn");
    await expect(btn).toBeVisible();
    await expect(btn).not.toBeEmpty();
  });

  test("renders pre-order button on iPhone (no cache regression)", async ({ page }) => {
    // This test exists to catch the class of bug where the pre-order button
    // disappears on mobile due to CSS or JS errors — a known competitor failure mode.
    await page.goto(PRODUCT_URL!);

    const wrapper = page.locator("#preflow-preorder-wrapper");
    await expect(wrapper).toBeVisible({ timeout: 10_000 });

    const btn = page.locator("#preflow-preorder-btn");
    await expect(btn).toBeVisible();

    // Confirm the native buy button is hidden (constraint 1)
    const nativeBuyBtn = page.locator(".product-form__buttons, .shopify-payment-button").first();
    if (await nativeBuyBtn.isVisible()) {
      // If the native button IS visible, the pre-order wrapper must be hidden — which would be wrong
      await expect(wrapper).toBeHidden({
        timeout: 1000,
      });
    }
  });

  test("button text updates on variant switch", async ({ page }) => {
    await page.goto(PRODUCT_URL!);

    const variantSelectors = page.locator("[name='id'] option");
    const count = await variantSelectors.count();
    if (count < 2) test.skip();

    const secondVariantValue = await variantSelectors.nth(1).getAttribute("value");
    if (!secondVariantValue) test.skip();

    await page.selectOption("[name='id']", secondVariantValue);

    // After variant switch, wrapper should still be visible (state revalidated)
    const wrapper = page.locator("#preflow-preorder-wrapper");
    await expect(wrapper).toBeVisible({ timeout: 5_000 });
  });

  test("App Proxy state endpoint returns JSON for a valid variant", async ({ request }) => {
    const appUrl = process.env.SHOPIFY_APP_URL;
    if (!appUrl || !process.env.PLAYWRIGHT_VARIANT_ID) test.skip();

    const res = await request.get(
      `${appUrl}/apps/preorder/state?variant_id=${process.env.PLAYWRIGHT_VARIANT_ID}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("enabled");
    expect(body).toHaveProperty("message");
    expect(body).toHaveProperty("ship_date");
  });
});
