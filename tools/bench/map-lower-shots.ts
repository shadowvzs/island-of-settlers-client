import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { LOWER_TOGGLE } from "../../src/app/map-editor/editor-catalog";
import { launchBrowser, startDevServer } from "./browser";

/**
 * Map editor Lower toggle, outline snap and saved stamps: a level 4 mountain,
 * a click a hair above its tip (raises it, not a new one behind), the same click with Lower on
 * (lowers it), then a browser slot save, its load and a Ctrl + click on the loaded mountain
 * (lowers it again). Prints the tip's screen height after each step; screenshots the Relief
 * section with Lower on. VIEW = x,z,zoom of an open meadow (default island).
 */
const VIEW = process.env.VIEW ?? "165,206,1.6";
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/map-editor-2026-10-07";
const READY_TIMEOUT = 180_000;
/** Longer than the terrain tool's quiet time plus the main thread preview. */
const STEP_PAUSE = 700;

type WorldPoint = [number, number];

const toScreen = (page: Page, [x, z]: WorldPoint) =>
  page.evaluate(([px, pz]) => window.__worker!.projectGround(px!, pz!), [x, z]);

const press = (page: Page, name: string) =>
  page.locator(".map-editor").getByRole("button", { exact: true, name }).first().click();

const waitReady = (page: Page) =>
  page.waitForFunction(() => window.__islandReady === true, null, { timeout: READY_TIMEOUT });

/** A click a few pixels above the point's ground on screen (with Ctrl or not). */
const clickAbove = async (page: Page, point: WorldPoint, lift: number, ctrl = false) => {
  const screen = await toScreen(page, point);
  if (ctrl) await page.keyboard.down("Control");
  await page.mouse.click(screen.x, screen.y - lift);
  if (ctrl) await page.keyboard.up("Control");
  await page.waitForTimeout(STEP_PAUSE);
};

/** Screen height of the tip (smaller: higher ground). */
const tipY = async (page: Page, point: WorldPoint) => Math.round((await toScreen(page, point)).y);

const loadSavedSlot = async (page: Page) => {
  await page.locator(".map-editor__name input").fill("Lower check");
  await press(page, "Save in the browser (new slot)");
  await page.locator(".map-editor__slot").first().waitFor();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".map-editor__slot").first().getByRole("button").first().click();
  await page.waitForURL(/map=/);
  await page.goto(`${page.url()}&view=${VIEW}`);
  await waitReady(page);
  await page.waitForTimeout(STEP_PAUSE);
};

const checkLowerToggle = async (page: Page, url: string) => {
  await page.goto(`${url}?reveal=1&view=${VIEW}`);
  await waitReady(page);
  const ground = await page.evaluate(() => window.__worker!.pickGround(750, 560));
  const peak: WorldPoint = [Math.round(ground!.x) + 0.5, Math.round(ground!.z) + 0.5];
  await press(page, "Mountain");
  for (let level = 0; level < 4; level += 1) await clickAbove(page, peak, 0);
  const steps: Record<string, number> = { level4: await tipY(page, peak) };
  await clickAbove(page, peak, 8);
  steps.aboveTipRaises = await tipY(page, peak);
  await press(page, LOWER_TOGGLE.label);
  await clickAbove(page, peak, 8);
  steps.lowerToggleLowers = await tipY(page, peak);
  const tip = await toScreen(page, peak);
  await page.mouse.move(tip.x, tip.y - 3);
  await page.waitForTimeout(STEP_PAUSE);
  const relief = page.locator(".map-editor .settings-panel__section").first();
  await relief.screenshot({ path: join(outDir, "lower-toggle.png") });
  if (process.env.VERIFY_DIR) {
    await page.screenshot({ path: join(process.env.VERIFY_DIR, "lower.png") });
  }
  await loadSavedSlot(page);
  steps.loaded = await tipY(page, peak);
  await press(page, "Mountain");
  await clickAbove(page, peak, 0, true);
  steps.loadedCtrlLowers = await tipY(page, peak);
  console.log(JSON.stringify(steps));
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
  await checkLowerToggle(page, url);
  await browser.close();
  await server.close();
};

await main();
