import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Map editor terrain check, one screenshot per scene plus the timings:
 * "mountains" (a big peak by six clicks and a ridge by a drag) and "lake" (a lake by five
 * clicks, its lilies and reeds). SCENES, OUT_DIR as in shots.
 */
const SCENES = (process.env.SCENES ?? "mountains,lake").split(",");
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/map-editor-2026-10-06";

type WorldPoint = [number, number];

const toScreen = (page: Page, [x, z]: WorldPoint) =>
  page.evaluate(([px, pz]) => window.__worker!.projectGround(px!, pz!), [x, z]);

/** World point `across` cells to the screen right and `down` cells down from the centre. */
const onScreen = ([cx, cz]: WorldPoint, across: number, down: number): WorldPoint => [
  cx + (across + down) / 2,
  cz + (down - across) / 2
];

const press = async (page: Page, from: WorldPoint, to: WorldPoint = from) => {
  const start = await toScreen(page, from);
  const end = await toScreen(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
};

/**
 * Waits until the terrain edits are applied and rebuilt (and the animal homes after the
 * navigation); returns the timings.
 */
const waitForRebuilds = async (page: Page) => {
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => window.__terrainStats?.busy === false, null, {
    timeout: 60_000
  });
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(() => ({
    homes: window.__homesStats,
    terrain: window.__terrainStats
  }));
  return JSON.stringify(stats);
};

const pickTool = async (page: Page, name: string) => {
  await page.getByRole("tab", { name: "Relief and water", exact: true }).click();
  await page.getByRole("tabpanel", { name: "Relief and water", exact: true })
    .getByRole("button", { exact: true, name }).click();
};

const editMountains = async (page: Page, centre: WorldPoint) => {
  await pickTool(page, "Mountain");
  // Six clicks on one screen point, as a player grows a peak: the stamp centre itself turns into
  // the mountain's outline (its tip), so aiming at that ground point again would graze past it.
  const peak = await toScreen(page, onScreen(centre, -8, 0));
  for (let click = 0; click < 6; click += 1) {
    await page.mouse.click(peak.x, peak.y);
    await page.waitForTimeout(150);
  }
  console.log("peak", await waitForRebuilds(page));
  await press(page, onScreen(centre, 6, -10), onScreen(centre, 16, 4));
  console.log("ridge", await waitForRebuilds(page));
  const hover = await toScreen(page, onScreen(centre, 16, 12));
  await page.mouse.move(hover.x, hover.y);
};

const editLake = async (page: Page, centre: WorldPoint) => {
  await pickTool(page, "Lake");
  for (let click = 0; click < 5; click += 1) {
    await press(page, centre);
    await page.waitForTimeout(150);
  }
  console.log("lake", await waitForRebuilds(page));
  const hover = await toScreen(page, onScreen(centre, 14, 10));
  await page.mouse.move(hover.x, hover.y);
};

const SCENE_SETUPS: Record<string, { edit: typeof editLake; view: string }> = {
  lake: { edit: editLake, view: "158,203,1.9" },
  mountains: { edit: editMountains, view: "165,206,1.1" }
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1500 } });
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.log("pageerror", error.message); });
  page.on("console", (message) => {
    if (message.type() === "error") console.log("[browser]", message.text().slice(0, 600));
  });
  await page.addInitScript("window.__name = value => value;");
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  try {
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) for (const scene of SCENES) {
    const { edit, view } = SCENE_SETUPS[scene]!;
    const [x, z] = view.split(",").map(Number) as [number, number];
    await page.goto(`${url}?quality=${quality}&reveal=1&view=${view}`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
    await page.evaluate(() => (window as any).__settlement.mapEditor.setEnabled(true));
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      const overlay = document.querySelector<HTMLElement>(".stats-overlay");
      if (overlay) overlay.hidden = true;
    });
    await edit(page, [x, z]);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(outDir, `${quality}-${scene}.png`) });
  }
  assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
};

await main();
