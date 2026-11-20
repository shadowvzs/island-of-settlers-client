import { defineConfig } from "@playwright/test";

import { getChromeLaunchOptions } from "../../tools/bench/chrome";
import { TEST_BACKEND_ENV } from "../../tools/bench/test-backend";
import { UI_TEST_PORT, UI_TEST_URL } from "../fixtures/server";

/**
 * Opt-in EXPLORE-01H browser review. It is deliberately not part of `npm run test:ui` or
 * `npm run test:visual`: until EXPLORE-01G wires `window.__exploration`, every case is skipped
 * with a visible reason instead of booting an invented fixture.
 *
 * Run from `island-of-settlers-client/`:
 *   npx playwright test --config tests-ui/exploration/playwright.config.ts
 */
export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "../../node_modules/.cache/playwright/exploration-results",
  projects: [
    {
      name: "exploration-high-desktop",
      use: { viewport: { height: 800, width: 1280 } }
    },
    {
      name: "exploration-minimal-touch",
      use: { hasTouch: true, isMobile: true, viewport: { height: 844, width: 390 } }
    }
  ],
  reporter: process.env.CI ? "line" : [["list"]],
  retries: 0,
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 180_000,
  use: {
    baseURL: UI_TEST_URL,
    launchOptions: getChromeLaunchOptions(),
    trace: "off"
  },
  webServer: {
    command: `npx vite --port ${UI_TEST_PORT} --strictPort --logLevel error`,
    cwd: "../..",
    env: TEST_BACKEND_ENV,
    reuseExistingServer: false,
    timeout: 60_000,
    url: UI_TEST_URL
  },
  workers: 1
});
