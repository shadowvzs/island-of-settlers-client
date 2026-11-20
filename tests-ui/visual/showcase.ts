import type { Page } from "@playwright/test";

import { UI_TEST_URL } from "../fixtures/server";

export type ShowcaseNation = "japanese" | "neutral" | "nubian" | "roman" | "viking";

/**
 * `building-showcase.html` in sample mode with its animation loop stopped: every capture is one
 * explicit render of a frozen model, so the same GPU gives the same pixels (strategy §5).
 */
export const openShowcase = async (page: Page, nation: ShowcaseNation, quality: "high" | "minimal") => {
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${UI_TEST_URL}building-showcase.html?nation=${nation}&quality=${quality}&sample=1`);
  await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120_000 });
  await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
};

/** Same pose as the icon exporters: finished, door closed, idle; rendered once and presented. */
export const renderFrozenBuilding = (page: Page, id: number) => page.evaluate(async buildingId => {
  const preview = (window as any).__buildingPreview;
  preview.selectBuilding(buildingId);
  await (window as any).__buildingResidentReady;
  preview.model().update(0, { construction: 1, door: 0, working: false });
  preview.renderer.render(preview.scene, preview.camera);
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}, id);
