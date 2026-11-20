import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { centreOn, type LiveWindow, openDecorReviewPage, settleDecorations } from "../bench/decor-review-session";
import { type FlatIslandPlot, openFixturePage, writeFlatIslandGame } from "../bench/flat-island-fixture";

/**
 * EAI1c c10 review (enemy economy AI plan P1, B6): the same building types of the player (front row) and of a
 * computer economy (back row, faction 2) on one flat Roman island, on High and Minimal at a close and a normal
 * gameplay zoom. The back row must be drawn in the island's computer nation. The island is a map whose `factionAi`
 * gives faction 2 an economy (EAI2a); the back row is handed to faction 2 in the live game.
 *   npx tsx tools/review/eai1c-owner-nation-capture.ts <out folder>
 */
const out = resolve(process.argv[2] ?? "eai1c-owner-nation");
mkdirSync(out, { recursive: true });
const AI = 2;
const TYPES = [17, 33, 20];
const buildings = TYPES.flatMap((typeId, index) => [
  { rotation: 0, typeId, x: 36 + index * 7, z: 58 },
  { rotation: 0, typeId, x: 36 + index * 7, z: 66 }
]);

/** Hands the back row to the computer economy in the running game. */
const giveBackRow = (page: Page, plots: readonly FlatIslandPlot[]) => page.evaluate(({ faction, uids }) => {
  const simulation = (window as LiveWindow).__settlement.simulation;
  for (const building of simulation.buildings()) if (uids.includes(building.uid)) building.militaryFaction = faction;
}, { faction: AI, uids: plots.filter((_, index) => index % 2 === 1).map(plot => plot.uid) });

const errors: string[] = [];
const devServer = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of ["high", "minimal"]) {
    let plots: FlatIslandPlot[] = [];
    const prepare = async (page: Page) => {
      await openFixturePage(page, devServer.url);
      plots = await writeFlatIslandGame(page, { buildings, economyFactions: [AI], grassGround: true,
        name: "EAI1c owner nation", nation: "roman", stockAll: 100 });
    };
    const page = await openDecorReviewPage(browser, devServer.url, quality, errors,
      "reveal=1&time=day", prepare);
    await giveBackRow(page, plots);
    for (const [view, zoom] of [["close", 2.2], ["normal", 1.2]] as const) {
      await centreOn(page, { x: 43, z: 62 }, zoom, 1.5);
      await settleDecorations(page);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(out, `${quality}-${view}.png`) });
    }
    await page.close();
  }
  console.log(JSON.stringify({ errors, out }, null, 2));
} finally { await browser.close(); await devServer.server.close(); }
