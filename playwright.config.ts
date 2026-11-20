import { defineConfig, type Project } from "@playwright/test";

import { UI_TEST_PORT, UI_TEST_URL } from "./tests-ui/fixtures/server";
import { getChromeLaunchOptions } from "./tools/bench/chrome";
import { TEST_BACKEND_ENV } from "./tools/bench/test-backend";

/**
 * TEST-01 browser layers (docs/reference/test-strategy-2026-10-19.md):
 * - `npm run test:ui`: UI smoke, one game page per (quality, viewport) project reused by every case.
 * - `npm run test:visual`: committed icons regenerated and compared, frozen building previews.
 * One Vite dev server serves both; Chrome runs on the real GPU like the bench drivers.
 */
const smoke = (name: string, quality: "high" | "minimal", width: number, height: number): Project => ({
  name: `smoke-${name}`,
  testDir: "tests-ui/smoke",
  use: { gameOptions: { quality, screen: { height, width } } }
});

export default defineConfig({
  expect: {
    // Same GPU, same driver: icons and previews are byte-stable; the tolerance absorbs AA noise only.
    toHaveScreenshot: { maxDiffPixelRatio: 0.005, threshold: 0.15 },
    toMatchSnapshot: { maxDiffPixelRatio: 0.005, threshold: 0.15 }
  },
  fullyParallel: false,
  outputDir: "node_modules/.cache/playwright/results",
  projects: [
    smoke("minimal-desktop", "minimal", 1280, 800),
    smoke("minimal-phone", "minimal", 390, 844),
    smoke("high-desktop", "high", 1280, 800),
    {
      name: "editor-minimal",
      testDir: "tests-ui/editor",
      use: { viewport: { height: 800, width: 1280 } }
    },
    {
      name: "editor-high",
      testDir: "tests-ui/editor",
      use: { viewport: { height: 800, width: 1280 } }
    },
    {
      name: "visual-icons",
      // Baselines are the committed assets themselves (no copies): `assets/<folder>/<name>.png`.
      snapshotPathTemplate: "{testDir}/../../assets/{arg}{ext}",
      testDir: "tests-ui/visual",
      testMatch: "*-icons.spec.ts"
    },
    {
      name: "visual-previews",
      snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
      testDir: "tests-ui/visual",
      testMatch: "*-previews.spec.ts"
    },
    {
      // Focused acceptance run only: the 1 h developed-fixture catch-up is too heavy for smoke/visual.
      name: "offline-catch-up",
      testDir: "tests-ui/offline",
      testMatch: "*.spec.ts"
    }
  ],
  reporter: process.env.CI ? "line" : [["list"]],
  retries: 0,
  timeout: 60_000,
  // A missing baseline fails instead of being written: icon baselines are the committed assets and
  // only their exporters may write them. New preview baselines: `--update-snapshots=missing`.
  updateSnapshots: "none",
  use: {
    baseURL: UI_TEST_URL,
    launchOptions: getChromeLaunchOptions(),
    trace: "off"
  },
  webServer: {
    command: `npx vite --port ${UI_TEST_PORT} --strictPort --logLevel error`,
    // An unanswered backend: pages stay standalone unless a test routes it healthy (account scroll).
    env: TEST_BACKEND_ENV,
    reuseExistingServer: false,
    timeout: 60_000,
    url: UI_TEST_URL
  },
  // One worker per smoke project: each loads the game once and runs its cases in order.
  workers: 3
});
