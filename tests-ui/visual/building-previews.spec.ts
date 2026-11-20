import { expect, test } from "@playwright/test";

import { GPU_PROFILE } from "../../tools/bench/chrome";
import { openShowcase, renderFrozenBuilding, type ShowcaseNation } from "./showcase";

/**
 * Isolated building previews on Minimal (the icon comparison already renders every model on High):
 * headquarters (animated flag, frozen by the stopped loop) and the farm, per nation. Baselines live
 * in `__screenshots__/<gpu profile>/`; refresh deliberately with `--update-snapshots=changed`.
 */
const PREVIEW_VIEWPORT = { height: 240, width: 320 };
const NATIONS: ShowcaseNation[] = ["roman", "viking", "nubian", "japanese"];
const BUILDINGS = [0, 20] as const;

test.describe.configure({ mode: "parallel" });

for (const nation of NATIONS) {
  test(`${nation} Minimal building previews`, async ({ page }) => {
    await page.setViewportSize(PREVIEW_VIEWPORT);
    await openShowcase(page, nation, "minimal");
    for (const id of BUILDINGS) {
      await renderFrozenBuilding(page, id);
      await expect.soft(page).toHaveScreenshot([GPU_PROFILE, `${nation}-${id}-minimal.png`]);
    }
  });
}
