import { expect, type Page, test } from "@playwright/test";

import { renderArmyIcons } from "../../tools/bench/army-icon-renderer";
import { renderCameraIcons } from "../../tools/bench/camera-icon-renderer";
import { GPU_PROFILE } from "../../tools/bench/chrome";
import { renderGameCursors } from "../../tools/bench/game-cursor-renderer";
import { renderMainBuildingIcon } from "../../tools/bench/main-building-icon-renderer";
import {
  BACKDROP_NATIONS, BACKDROP_SIZE, renderPortraitBackdrops
} from "../../tools/bench/player-portrait-backdrop-renderer";
import { PORTRAIT_SHEET_OPTIONS, renderPortraitSheets } from "../../tools/bench/player-portrait-renderer";
import { renderProgressionIcons } from "../../tools/bench/progression-icon-renderer";
import { renderRaceHelmetIcons } from "../../tools/bench/race-helmet-icon-renderer";
import { renderShipIcon, SHIP_ICONS } from "../../tools/bench/ship-icon-renderer";
import { UI_TEST_URL } from "../fixtures/server";
import { changedPixelShare, CHANNEL_TOLERANCE, MAX_CHANGED_RATIO } from "./webp-diff";

/**
 * Committed HUD/UI art in `assets/ui-icons/` re-rendered with each exporter's own in-page renderer
 * (`tools/bench/*-renderer.ts`) and compared with the files: army troops, the game cursor set, camera panel,
 * progression art, race buttons, ships, the Build launcher HQ, portrait sheets and backdrops.
 * PNGs use `toMatchSnapshot` (baselines are the assets themselves); WebPs are decoded in the page.
 * Not covered: `actions/` (ui-action-icons.spec.ts), hand-drawn SVGs, `dev-test-skirmish.png` (no
 * generator in the repository) and `floppy-disk`/`statistics.webp` (converted from source PNGs
 * outside the repository by `npm run ui-menu-icons`, nothing rendered).
 */

test.skip(GPU_PROFILE !== "gpu", "icon baselines exist for the NVIDIA profile only");
test.describe.configure({ mode: "parallel" });

const openBlankPage = async (page: Page) => {
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/ui-icon-render.html", route => route.fulfill({
    body: "<!doctype html><html><body style='margin:0'></body></html>", contentType: "text/html"
  }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${UI_TEST_URL}ui-icon-render.html`);
};

/** `path` relative to `assets/ui-icons/`; `png` is base64 or a data URL. */
const expectPng = (png: string, path: string) => {
  const bytes = Buffer.from(png.replace(/^data:image\/png;base64,/, ""), "base64");
  expect.soft(bytes, path).toMatchSnapshot(["ui-icons", ...path.split("/")]);
};

const expectWebp = async (page: Page, webp: string, path: string) => {
  const changed = await page.evaluate(changedPixelShare, {
    fresh: `data:image/webp;base64,${webp}`, stored: `/assets/ui-icons/${path}`, tolerance: CHANNEL_TOLERANCE
  });
  expect.soft(changed, `${path} changed pixel share`).toBeLessThanOrEqual(MAX_CHANGED_RATIO);
};

test("army, camera, progression and race icons match the committed assets", async ({ page }) => {
  test.setTimeout(120_000);
  await openBlankPage(page);
  for (const { data, name } of await page.evaluate(renderArmyIcons)) expectPng(data, `${name}.png`);
  for (const [name, png] of Object.entries(await page.evaluate(renderCameraIcons)))
    expectPng(png, `camera/${name}.png`);
  for (const [name, { png }] of Object.entries(await page.evaluate(renderGameCursors, undefined))) {
    expectPng(png["1x"], `cursors/${name}.png`);
    expectPng(png["2x"], `cursors/${name}@2x.png`);
  }
  for (const [name, png] of Object.entries(await page.evaluate(renderProgressionIcons)))
    expectPng(png, `${name}.png`);
  for (const [nation, png] of Object.entries(await page.evaluate(renderRaceHelmetIcons)))
    expectPng(png, `races/${nation}.png`);
});

test("ship icons match the committed assets", async ({ page }) => {
  test.setTimeout(120_000);
  await openBlankPage(page);
  for (const { file, nation } of SHIP_ICONS)
    expectPng(await page.evaluate(renderShipIcon, { nation }), file.replace("assets/ui-icons/", ""));
});

test("the Build launcher icon matches the committed asset", async ({ page }) => {
  test.setTimeout(120_000);
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${UI_TEST_URL}building-showcase.html?building=0&quality=high`);
  await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 100_000 });
  expectPng(await page.evaluate(renderMainBuildingIcon), "roman-buildings.png");
});

test("HUD portrait sheets and backdrops match the committed assets", async ({ page }) => {
  test.setTimeout(180_000);
  await openBlankPage(page);
  const { faces, result: sheets } = await page.evaluate(renderPortraitSheets, PORTRAIT_SHEET_OPTIONS);
  for (const [key, webp] of Object.entries(sheets)) await expectWebp(page, webp, `portraits/${key}.webp`);
  for (const [key, webp] of Object.entries(faces))
    await expectWebp(page, webp, `portraits/faces/${key}.webp`);
  const backdrops = await page.evaluate(renderPortraitBackdrops, { nations: BACKDROP_NATIONS, size: BACKDROP_SIZE });
  for (const [nation, webp] of Object.entries(backdrops))
    await expectWebp(page, webp, `portraits/${nation}-backdrop.webp`);
});
