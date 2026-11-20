import { expect, test } from "@playwright/test";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { NEUTRAL_BUILDING_IDS } from "../../src/render-common/buildings/neutral-building-recipe";
import { GPU_PROFILE } from "../../tools/bench/chrome";
import { openShowcase, renderFrozenBuilding, type ShowcaseNation } from "./showcase";

/**
 * Committed building menu icons (`assets/building-icons/<nation>-<id>.png`, made by
 * `npm run building-assets`) are re-rendered from the current models and compared with the files
 * themselves (`snapshotPathTemplate` points at `assets/`): a model change without regenerated icons,
 * or an unintended model change, fails here. Baselines were exported on the NVIDIA profile.
 */
const ICON_VIEWPORT = { height: 180, width: 240 };
const NATIONS: [ShowcaseNation, readonly number[]][] = [
  ["roman", BUILDING_CATALOG.map(definition => definition.id)],
  ["viking", BUILDING_CATALOG.map(definition => definition.id)],
  ["nubian", BUILDING_CATALOG.map(definition => definition.id)],
  ["japanese", BUILDING_CATALOG.map(definition => definition.id)],
  ["neutral", NEUTRAL_BUILDING_IDS]
];

test.describe.configure({ mode: "parallel" });
test.skip(GPU_PROFILE !== "gpu", "icon baselines exist for the NVIDIA profile only");

for (const [nation, ids] of NATIONS) {
  test(`${nation} building icons match the committed assets`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(ICON_VIEWPORT);
    await openShowcase(page, nation, "high");
    for (const id of ids) {
      await renderFrozenBuilding(page, id);
      await expect.soft(page, `${nation}-${id}`).toHaveScreenshot(["building-icons", `${nation}-${id}.png`]);
    }
  });
}
