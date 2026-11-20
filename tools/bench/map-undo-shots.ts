import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Map editor undo / redo check: five edits (a mountain, a sand stroke, an oak,
 * a deer, a lake), all undone (buttons and Ctrl+Z), all redone (Ctrl+Y); prints the steps, their
 * memory and the deer count at each stage, screenshots the panel's undo / redo buttons.
 * VIEW = x,z,zoom of an open meadow (default island); VERIFY_DIR keeps full views of the stages.
 */
const VIEW = process.env.VIEW ?? "165,206,1.6";
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/map-undo-2026-10-07";
const READY_TIMEOUT = 180_000;
/** Longer than the terrain tool's quiet time: each edit is its own step. */
const STEP_PAUSE = 400;
const REBUILD_PAUSE = 2500;

type WorldPoint = [number, number];

const toScreen = (page: Page, [x, z]: WorldPoint) =>
  page.evaluate(([px, pz]) => window.__worker!.projectGround(px!, pz!), [x, z]);

const press = (page: Page, name: string) =>
  page.locator(".map-editor").getByRole("button", { exact: true, name }).first().click();

const clickGround = async (page: Page, point: WorldPoint) => {
  const screen = await toScreen(page, point);
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(STEP_PAUSE);
};

const dragGround = async (page: Page, from: WorldPoint, to: WorldPoint) => {
  const start = await toScreen(page, from);
  const end = await toScreen(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(STEP_PAUSE);
};

const editIsland = async (page: Page, [x, z]: WorldPoint) => {
  await press(page, "Mountain");
  await clickGround(page, [x - 6, z - 6]);
  await press(page, "Sand");
  await dragGround(page, [x - 4, z + 2], [x + 4, z + 2]);
  await press(page, "Oak");
  await clickGround(page, [x, z + 6]);
  await press(page, "Deer");
  await clickGround(page, [x + 4, z + 6]);
  await press(page, "Lake");
  await clickGround(page, [x + 6, z - 4]);
  await press(page, "Lake");
  await page.waitForTimeout(REBUILD_PAUSE);
};

const describe = (page: Page) =>
  page.evaluate(() => ({ deer: window.__listAnimals!().length, ...window.__mapHistory!() }));

const shoot = async (page: Page, name: string) => {
  if (process.env.VERIFY_DIR) await page.screenshot({ path: join(process.env.VERIFY_DIR, name) });
};

const checkUndoRedo = async (page: Page, url: string) => {
  await page.goto(`${url}?reveal=1&view=${VIEW}`);
  await page.waitForFunction(() => window.__islandReady === true, null, {
    timeout: READY_TIMEOUT
  });
  await page.waitForTimeout(REBUILD_PAUSE);
  await shoot(page, "start.png");
  const start = await describe(page);
  const [x, z] = VIEW.split(",").map(Number) as WorldPoint;
  await editIsland(page, [x, z]);
  await shoot(page, "edited.png");
  const edited = await describe(page);
  await press(page, "Undo (Ctrl+Z)");
  await press(page, "Undo (Ctrl+Z)");
  await page.waitForTimeout(REBUILD_PAUSE);
  const panel = page.locator(".map-editor");
  const bar = await panel.boundingBox();
  if (bar) {
    const clip = { height: 150, width: bar.width, x: bar.x, y: bar.y };
    await page.screenshot({ clip, path: join(outDir, "panel.png") });
  }
  for (let step = 0; step < 3; step += 1) await page.keyboard.press("Control+z");
  await page.waitForTimeout(REBUILD_PAUSE);
  await shoot(page, "undone.png");
  const undone = await describe(page);
  for (let step = 0; step < 5; step += 1) await page.keyboard.press("Control+y");
  await page.waitForTimeout(REBUILD_PAUSE);
  await shoot(page, "redone.png");
  const redone = await describe(page);
  console.log(JSON.stringify({ edited, redone, start, undone }));
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1500 } });
  page.on("pageerror", (error) => console.log("[pageerror]", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("[browser]", message.text().slice(0, 600));
  });
  await checkUndoRedo(page, url);
  await browser.close();
  await server.close();
};

await main();
