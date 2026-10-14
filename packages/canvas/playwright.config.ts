// SPDX-License-Identifier: Apache-2.0
// Drives the dev harness (a fake ThemeApi, the world frozen with ?tick=0) through
// Chromium on a desktop and a phone. Port 7421 is ours alone; never 7373.
import { defineConfig, devices } from "@playwright/test";

const PORT = 7421;
export const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "test",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 4,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /phone\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      testMatch: /phone\.spec\.ts/,
      use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: `node scripts/dev.mjs --port ${PORT}`,
    url: `${BASE}/harness.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
