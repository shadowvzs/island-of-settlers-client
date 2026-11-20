import { expect, test } from "@playwright/test";

import { GPU_PROFILE } from "../../tools/bench/chrome";
import {
  renderUiActionIcon,
  setupUiActionIconRenderer
} from "../../tools/bench/ui-action-icon-renderer";
import { UI_TEST_URL } from "../fixtures/server";
import { changedPixelShare, CHANNEL_TOLERANCE, MAX_CHANGED_RATIO } from "./webp-diff";

/**
 * Committed HUD action icons (`assets/ui-icons/actions/<name>.webp`, from
 * `tools/bench/ui-action-icons.ts`) and map-editor Computer faction icons (`assets/ui-icons/ai`,
 * `--set=ai`) re-rendered with the exporter's in-page renderer. Both are WebP, which `toMatchSnapshot` cannot diff, so the page decodes both (`webp-diff.ts`).
 * `people` is a 2D composite of worker renders, not a model, and is not covered here.
 */
test.skip(GPU_PROFILE !== "gpu", "icon baselines exist for the NVIDIA profile only");

test("HUD action icons match the committed assets", async ({ page }) => {
  test.setTimeout(180_000);
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/ui-action-icons.html", route => route.fulfill({
    body: "<!doctype html><html><body></body></html>", contentType: "text/html"
  }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${UI_TEST_URL}ui-action-icons.html`);
  for (const [set, folder, sample] of [["actions", "actions", "market"], ["ai", "ai", "develop"]] as const) {
    const names = await page.evaluate(setupUiActionIconRenderer, set);
    expect(names, `${sample} icon is registered`).toContain(sample);
    for (const name of names) {
      const fresh = await page.evaluate(renderUiActionIcon, name);
      const changed = await page.evaluate(changedPixelShare, {
        fresh: `data:image/webp;base64,${fresh}`, stored: `/assets/ui-icons/${folder}/${name}.webp`,
        tolerance: CHANNEL_TOLERANCE
      });
      expect.soft(changed, `${set} ${name} changed pixel share`).toBeLessThanOrEqual(MAX_CHANGED_RATIO);
    }
  }
});
