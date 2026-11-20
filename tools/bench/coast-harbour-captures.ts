import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../../src/app/map-generator/helpers";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { launchBrowser, startDevServer } from "./browser";

/**
 * COAST-NATURAL / HARBOUR-SPOTS iso captures (High + Minimal): the whole island at normal gameplay
 * distance and closer, plus close and normal views of one pre-levelled harbour spot per map.
 * Run through the browser slot from `island-of-settlers-client/`:
 *   OUT_DIR=<dir> SEEDS=1234,42,7 QUERY="size=256&landform=archipelago&islandCount=2&harbourSpots=1"
 *   npx tsx tools/bench/coast-harbour-captures.ts
 */
const outDir = process.env.OUT_DIR ?? "/tmp/coast-harbour-captures";
const seeds = (process.env.SEEDS ?? "1234,42,7").split(",").map(Number);
const query = process.env.QUERY ?? "size=256&landform=archipelago&islandCount=2&harbourSpots=1";
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",").filter(Boolean);
/** Which stored spot of the first island to frame (0: the generation proof harbour). */
const spotIndex = Number(process.env.SPOT ?? 0);
const READY_TIMEOUT = 600_000;
const SHOT_TIMEOUT = 180_000;

const waitReady = async (page: Page) => {
  await page.waitForFunction(() => (window as unknown as { __islandReady?: boolean }).__islandReady === true, null,
    { timeout: READY_TIMEOUT });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
};

/** Island centre and the chosen stored spot (else the proof harbour) of the generated map. */
const findTargets = (seed: number) => {
  const choice = readIslandChoice(new URLSearchParams(query), DEFAULT_ISLAND_CHOICE);
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(choice), seed });
  const site = world.playableIslands!.sites[0]!;
  const spot = site.harbourSpots?.[spotIndex] ?? site.harbour;
  return { island: { x: site.x, z: site.z, zoom: 0.3 }, spot: { x: spot.x, z: spot.z } };
};

/** Game: the subtle spot markers while a harbour (type 39) is being placed. */
const capturePlacementMarkers = async (page: Page, address: string, name: string) => {
  await page.goto(address);
  await waitReady(page);
  await page.evaluate(() => (window as unknown as { __selectPlacement?: (typeId: number) => void })
    .__selectPlacement?.(39));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `${name}-placing-harbour.png`), timeout: SHOT_TIMEOUT });
};

/** Map editor (`editor.html`): the prominent spot markers. */
const captureEditorMarkers = async (page: Page, address: string, name: string) => {
  await page.goto(address);
  await waitReady(page);
  await page.waitForFunction(() => (window as unknown as { __editorReady?: boolean }).__editorReady === true, null,
    { timeout: READY_TIMEOUT });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `${name}-editor.png`), timeout: SHOT_TIMEOUT });
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1600 } });
  await page.addInitScript("window.__name=value=>value;");
  page.on("pageerror", error => console.log("[pageerror]", error.message));
  try {
    for (const seed of seeds) {
      const targets = findTargets(seed);
      for (const quality of qualities) {
        const base = `${url}?seed=${seed}&${query}&quality=${quality}&cache=0&time=day&reveal=1`;
        const views = [["island", targets.island.x, targets.island.z, targets.island.zoom],
          ["spot-normal", targets.spot.x, targets.spot.z, 0.8], ["spot-close", targets.spot.x, targets.spot.z, 1.6]] as const;
        for (const [name, x, z, zoom] of views) {
          await page.goto(`${base}&view=${x},${z},${zoom}`);
          await waitReady(page);
          await page.screenshot({ path: join(outDir, `${seed}-${quality}-${name}.png`), timeout: SHOT_TIMEOUT });
        }
        await capturePlacementMarkers(page, `${base}&view=${targets.spot.x},${targets.spot.z},0.6`,
          `${seed}-${quality}`);
        console.log(`captured ${seed} ${quality}`);
      }
      if (process.env.CAPTURE_EDITOR === "1") await captureEditorMarkers(page,
        `${url}editor.html?seed=${seed}&${query}&quality=high&cache=0&time=day&reveal=1&view=${targets.spot.x},${targets.spot.z},0.6`,
        String(seed));
    }
  } finally {
    await browser.close();
    await server.close();
  }
};

await main();
