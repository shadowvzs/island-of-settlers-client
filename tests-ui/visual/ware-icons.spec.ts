import { expect, test } from "@playwright/test";

import { HANDCART_OUTPUT } from "../../src/render-common/logistics/handcart-rules";
import { WARE_IDS } from "../../src/render-common/wares/ware-catalog";
import { GPU_PROFILE } from "../../tools/bench/chrome";
import { AUTHORED_WARE_ICONS, renderWareIcon, setupWareIconRenderer } from "../../tools/bench/ware-icon-renderer";
import { UI_TEST_URL } from "../fixtures/server";

/**
 * Committed ware icons (`assets/ware-icons/<id>.png`, from `tools/bench/ware-icons.ts`) re-rendered
 * with the exporter's own in-page renderer and compared with the files.
 */
const ICON_IDS: readonly string[] = [...WARE_IDS.filter(id => !AUTHORED_WARE_ICONS.has(id)), HANDCART_OUTPUT];

test.skip(GPU_PROFILE !== "gpu", "icon baselines exist for the NVIDIA profile only");

test("ware icons match the committed assets", async ({ page }) => {
  test.setTimeout(180_000);
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/ware-icon-render.html", route => route.fulfill({
    body: "<!doctype html><html><body></body></html>", contentType: "text/html"
  }));
  await page.goto(`${UI_TEST_URL}ware-icon-render.html`);
  await page.evaluate(setupWareIconRenderer);
  for (const id of ICON_IDS) {
    const { png } = await page.evaluate(renderWareIcon, id);
    expect.soft(Buffer.from(png, "base64"), id).toMatchSnapshot(["ware-icons", `${id}.png`]);
  }
});
