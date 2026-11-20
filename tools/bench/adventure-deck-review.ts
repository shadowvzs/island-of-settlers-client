import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import {
  openFreshIsland, runDevelopmentTool, sailUntilLanded, trackPageErrors, visitIsland
} from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

/**
 * Adventure landing on High and Minimal (owner, 2026-10-15): the foot soldiers stand on the anchored
 * ship's deck, then walk off two at a time; riders' horses stand on deck where there is room, held by
 * their riders, who mount at their turn, ride down the gangway and on over the beach.
 * Development menu "Test adventure" (HORSES=1: four foot soldiers and two riders, so both horses stand
 * on deck), the voyage, the visit; frames at the given game seconds from the land side and close up.
 * Usage: [HORSES=1] [SECONDS=0,3,6] npx tsx tools/bench/adventure-deck-review.ts
 */
const horses = process.env.HORSES === "1";
const output = resourcesPath("ship-motion", horses ? "adventure-horses" : "adventure-deck");
const seconds = (process.env.SECONDS ?? (horses ? "0,4,7,10,13,16" : "0,2.5,5")).split(",").map(Number);
mkdirSync(output, { recursive: true });
type Page = import("playwright-core").Page;

/** Camera on the landing ship from the land side (`close`: on its deck); the soldiers' phases. */
const frame = (page: Page, close: boolean) => page.evaluate(nearShip => {
  const settlement = (window as any).__settlement, simulation = settlement.simulation;
  const site = simulation.shipSites().find((entry: any) => entry.kind === "dock");
  const { contact, shore } = site.workPier;
  const camera = (window as any).__deckCamera;
  const focus = nearShip ? { x: (site.x + contact.x) / 2, z: (site.z + contact.z) / 2 }
    : { x: (contact.x + shore.x) / 2, z: (contact.z + shore.z) / 2 };
  settlement.focusGround(focus.x, focus.z);
  camera.yaw = Math.atan2(shore.x - contact.x, shore.z - contact.z) - Math.PI / 4 + .6;
  if (nearShip) camera.zoom = Math.max(camera.zoom, 2.2);
  const own = new Set(simulation.militarySoldiers().filter((soldier: any) => !soldier.combat?.faction)
    .map((soldier: any) => soldier.actor));
  const phases = simulation.frames().filter((actor: any) => own.has(actor.uid))
    .reduce((counts: Record<string, number>, actor: any) => {
      const key = `${actor.phase}${actor.mounted ? " mounted" : ""}${actor.visible ? "" : " (hidden)"}`;
      return { ...counts, [key]: (counts[key] ?? 0) + 1 };
    }, {});
  const shownHorses = simulation.horseFrames().filter((horse: any) => horse.visible !== false).length;
  return { horses: shownHorses, phases };
}, close);

/** Four foot soldiers and two riders instead of the development menu's usual party. */
const smallParty = async (page: Page) => page.route("**/settlement-debug-expeditions.ts*", async route => {
  const response = await route.fetch();
  const body = (await response.text()).replace(/(DEBUG_EXPEDITION_TROOPS[^=]*=\s*Object\.freeze\()\{[^}]*\}/,
    "$1{ archer: 1, cavalry: 2, heavy: 2, shield: 1 }");
  await route.fulfill({ body, response });
});

const exposeCamera = (page: Page) => page.route("**/src/app/main.ts", async route => {
  const response = await route.fetch();
  const body = (await response.text()).replace("window.__islandReady = true",
    "window.__deckCamera = camera; window.__islandReady = true");
  await route.fulfill({ body, response });
});

const advance = (page: Page, gameSeconds: number) => page.evaluate(async ticks => {
  const simulation = (window as any).__settlement.simulation;
  for (let tick = 0; tick < ticks; tick++) {
    simulation.update(.05);
    if (tick % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
}, Math.round(gameSeconds / .05));

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = trackPageErrors(page, () => quality);
    await exposeCamera(page);
    if (horses) await smallParty(page);
    await openFreshIsland(page, url, quality);
    await runDevelopmentTool(page, "Test adventure", async () => undefined);
    assert.equal((await sailUntilLanded(page)).status, "arrived");
    await visitIsland(page, "[data-adventure-visit]");
    const frames: unknown[] = [];
    let at = 0;
    for (const [index, second] of seconds.entries()) {
      await advance(page, second - at);
      at = second;
      for (const close of [false, true]) {
        frames.push({ close, second, ...await frame(page, close) });
        await page.waitForTimeout(700);
        await page.screenshot({ path: resolve(output, `${quality}-${close ? "close" : "deck"}-${index + 1}.png`) });
      }
    }
    report[quality] = { errors, frames };
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
