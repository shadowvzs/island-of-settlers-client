import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Map save / load check: a few edits (mountain, lake, tree, deer), saved in a browser slot
 * and as a file, then loaded again (the page reloads with ?map=). Prints the file
 * size and the load times (generated vs loaded), screenshots the panel's Map section.
 * VIEW = x,z,zoom of an open meadow (default island); OUT_DIR as in shots.
 */
const VIEW = process.env.VIEW ?? "165,206,1.6";
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/map-save-2026-10-07";
const READY_TIMEOUT = 180_000;

type WorldPoint = [number, number];

const toScreen = (page: Page, [x, z]: WorldPoint) =>
  page.evaluate(([px, pz]) => window.__worker!.projectGround(px!, pz!), [x, z]);

const press = (page: Page, name: string) =>
  page.locator(".map-editor").getByRole("button", { exact: true, name }).first().click();

const clickGround = async (page: Page, point: WorldPoint) => {
  const screen = await toScreen(page, point);
  await page.mouse.click(screen.x, screen.y);
};

/** Milliseconds from the navigation to the island on screen. */
const waitReady = async (page: Page) => {
  await page.waitForFunction(() => window.__islandReady === true, null, {
    timeout: READY_TIMEOUT
  });
  return page.evaluate(() => Math.round(performance.now()));
};

const editIsland = async (page: Page, [x, z]: WorldPoint) => {
  await press(page, "Mountain");
  for (let level = 0; level < 3; level += 1) await clickGround(page, [x - 6, z - 6]);
  await press(page, "Lake");
  for (let level = 0; level < 2; level += 1) await clickGround(page, [x + 6, z - 4]);
  await press(page, "Oak");
  await clickGround(page, [x, z + 4]);
  await press(page, "Deer");
  await clickGround(page, [x + 4, z + 6]);
  await press(page, "Deer");
  await page.waitForTimeout(2500);
};

const saveSlot = async (page: Page, name: string) => {
  await page.locator(".map-editor__name input").fill(name);
  await press(page, "Save in the browser (new slot)");
  await page.locator(".map-editor__slot").first().waitFor();
};

const saveFile = async (page: Page) => {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    press(page, "Save map file")
  ]);
  return statSync(await download.path()).size;
};

const checkSaveLoad = async (page: Page, url: string) => {
  await page.goto(`${url}?reveal=1&view=${VIEW}`);
  const generatedMs = await waitReady(page);
  const [x, z] = VIEW.split(",").map(Number) as WorldPoint;
  await editIsland(page, [x, z]);
  await saveSlot(page, "Check");
  const bytes = await saveFile(page);
  if (process.env.VERIFY_DIR) {
    await page.screenshot({ path: join(process.env.VERIFY_DIR, "edited.png") });
  }
  const section = page.locator(".map-editor .settings-panel__section").last();
  await section.screenshot({ path: join(outDir, "panel.png") });
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".map-editor__slot").first().getByRole("button").first().click();
  await page.waitForURL(/map=/);
  const loadedMs = await waitReady(page);
  if (process.env.VERIFY_DIR) {
    await page.goto(`${page.url()}&view=${VIEW}`);
    await waitReady(page);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(process.env.VERIFY_DIR, "loaded.png") });
  }
  const deer = await page.evaluate(() => window.__listAnimals!().length);
  const hint = await page.locator(".map-editor__status").textContent();
  console.log(JSON.stringify({ bytes, deer, generatedMs, hint, loadedMs, url: page.url() }));
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({
    acceptDownloads: true,
    viewport: { height: 900, width: 1500 }
  });
  page.on("pageerror", (error) => console.log("[pageerror]", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("[browser]", message.text().slice(0, 600));
  });
  await checkSaveLoad(page, url);
  await browser.close();
  await server.close();
};

await main();
