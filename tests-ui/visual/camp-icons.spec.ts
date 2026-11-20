import { expect, test } from "@playwright/test";

import { GPU_PROFILE } from "../../tools/bench/chrome";
import { UI_TEST_URL } from "../fixtures/server";

/**
 * Committed themed camp / outpost icons (`assets/building-icons/{camp,outpost}-<theme>-<bandit code>-<layout>.png`,
 * made by `npm run camp-assets`) re-rendered with the same scene and compared with the files.
 */
const THEMES = ["forest", "tropical", "winter", "desert", "swamp", "pirate"] as const;
/** Bandit site code and the military building type whose model slot it is drawn in. */
const SITES = [[0, 2], [1, 4], [2, 9]] as const;
const LAYOUTS = [0, 1, 2] as const;

test.describe.configure({ mode: "parallel" });
test.skip(GPU_PROFILE !== "gpu", "icon baselines exist for the NVIDIA profile only");

for (const family of ["camp", "outpost"] as const) {
  test(`${family} icons match the committed assets`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ height: 180, width: 240 });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/themed-building-review.html", route =>
      route.fulfill({ body: "<body></body>", contentType: "text/html" }));
    await page.goto(`${UI_TEST_URL}themed-building-review.html`);
    await page.evaluate(async () => {
      const { themedNeutralBuildingScene } = await import(
        /* @vite-ignore */ String("/tools/bench/themed-neutral-building-scene.ts"));
      (window as any).__themedBuildings = themedNeutralBuildingScene(true);
    });
    for (const theme of THEMES) for (const layout of LAYOUTS) for (const [code, id] of SITES) {
      const style = {
        bandit: { code, layout },
        ...(family === "outpost" && { enclosure: "building" }),
        theme: theme === "pirate" ? "tropical" : theme,
        variant: theme === "pirate" ? "pirate" : "bandit"
      };
      await page.evaluate(({ id, style }) =>
        (window as any).__themedBuildings.shot(id, style, "threeQuarter"), { id, style });
      const name = `${family}-${theme}-${code}-${layout}`;
      await expect.soft(page, name).toHaveScreenshot(["building-icons", `${name}.png`]);
    }
  });
}
