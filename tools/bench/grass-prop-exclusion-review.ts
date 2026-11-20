import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { freezeIso, openFrozenPage, pinScene, stageFrozenSave } from "./frozen-frame-review";
import { assertRendererActive, HIDE_UI, OWNER_SAVE, type ParityRenderer } from "./parity-helpers";

/**
 * Grass/prop exclusion review: the owner save's loaded storehouse yard in a frozen iso close view.
 * `MODE=before` disables registering saved buildings' physical cover, which is the pre-fix load
 * behaviour; `MODE=after` keeps it. Run both through captures/browser-slot.sh:
 *
 *   MODE=after RENDERER=webgl OUTPUT_DIR=<captures>/grass-prop-exclusion/after npx tsx tools/bench/grass-prop-exclusion-review.ts
 *   MODE=after RENDERER=webgpu-gl HEADED=1 WEBGPU=1 WEBGPU_ANGLE=gl ... (same)
 */
const mode = process.env.MODE === "before" ? "before" : "after";
const renderer = (process.env.RENDERER ?? "webgl") as ParityRenderer;
const output = resolve(process.env.OUTPUT_DIR ?? `/tmp/grass-prop-exclusion-${mode}`);
const saveText = readFileSync(OWNER_SAVE, "utf8");
mkdirSync(output, { recursive: true });

const disableRestoredCover = async (page: import("playwright-core").Page) => {
  await page.route("**/island-building-clearance.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    assert(source.includes("if (!entries.length) return;"));
    await route.fulfill({ body: source.replace("if (!entries.length) return;", "if (true) return;"), response });
  });
};

const views = [
  { centerX: 164.5, centerZ: 83.5, name: "storehouse-yard", yaw: 0, zoom: 3.4 },
  { centerX: 165.7, centerZ: 83.4, name: "storehouse-close", yaw: 0, zoom: 5.5 },
  { centerX: 172.2, centerZ: 76.7, name: "woodcutter-logs", yaw: 0, zoom: 5.5 }
];

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const { errors, page } = await openFrozenPage(browser, url, {
    extraRoutes: mode === "before" ? disableRestoredCover : undefined,
    quality: "high",
    query: `&renderer=${renderer}`,
    stagedSave: stageFrozenSave(saveText),
    viewport: { height: 1000, width: 1400 }
  });
  assert.equal(errors.length, 0, errors.join(" | "));
  await assertRendererActive(page, renderer);
  await pinScene(page, "day", true);
  await freezeIso(page);
  await page.addStyleTag({ content: HIDE_UI });
  for (const view of views) {
    await page.evaluate(target => {
      const debug = (globalThis as any).__atmosphereLiveDebug;
      const frame = debug.isoFrame;
      Object.assign(frame.camera, { centerX: target.centerX, centerZ: target.centerZ, tilt: 0,
        yaw: target.yaw, zoom: target.zoom });
      frame.time = 12;
      debug.frozenFrame = frame;
      debug.draw();
    }, view);
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(output, `${view.name}-${mode}-${renderer}.png`) });
    console.log(`${view.name}: ${view.name}-${mode}-${renderer}.png`);
  }
} finally {
  await browser.close();
  await server.close();
}
