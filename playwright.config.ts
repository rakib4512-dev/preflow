import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://your-dev-store.myshopify.com",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "iphone-12",
      use: { ...devices["iPhone 12"] },
    },
  ],
});
