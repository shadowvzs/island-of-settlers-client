import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { type LiveWindow, openDecorReviewPage } from "../bench/decor-review-session";
import { openDevelopmentAction } from "../bench/development-ui-helpers";
import { type FlatIslandAiDepot, openFixturePage, writeFlatIslandGame } from "../bench/flat-island-fixture";

/**
 * EAI3d review: the economy AI "why" window (Development tools > Economy > Economy AI) on a flat island with two
 * `develop` factions: faction 2 builds freely, faction 3 has no ground for a plot (goal backoff, "no plot").
 *   npx tsx tools/review/eai3d-why-panel-capture.ts <out folder>
 */
const out = resolve(process.argv[2] ?? "eai3d-why-panel");
mkdirSync(out, { recursive: true });
const KIT = { settlers: 8, stock: { axe: 2, hammer: 3, logs: 12, pickaxe: 1, planks: 40, saw: 1, stone: 30 } };
const FREE: FlatIslandAiDepot = { faction: 2, kit: KIT, mode: "develop", x: 22, z: 24 };
const WALLED: FlatIslandAiDepot = { buildableRadius: 4, faction: 3, kit: KIT, mode: "develop", x: 76, z: 20 };
/** Real seconds the factions decide before a shot (strategic layer: every 10 s of game time). */
const DECIDING_MS = 45_000;

const focus = (page: Page, { x, z }: { x: number; z: number }, zoom: number) => page.evaluate(view => {
  (window as LiveWindow).__settlement.focusGround(view.x, view.z, view.zoom);
}, { x, z, zoom });

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
};

/** Whether the economy AI probe holds a goal recorder (the window installs one only while it is open). */
const goalProbeInstalled = (page: Page) => page.evaluate(async () => {
  const probe = await import(/* @vite-ignore */ String("/src/shared/settlement/economy-ai/faction-ai-probe.ts"));
  return probe.factionAiGoalProbe() !== undefined;
});

const errors: string[] = [];
const devServer = await startDevServer();
const browser = await launchBrowser();
try {
  const prepare = async (page: Page) => {
    await openFixturePage(page, devServer.url);
    await writeFlatIslandGame(page, { aiDepots: [FREE, WALLED], buildings: [], grassGround: true,
      name: "EAI3d why panel", nation: "roman", stockAll: 100 });
  };
  const page = await openDecorReviewPage(browser, `${devServer.url}admin.html`, process.env.QUALITY ?? "minimal",
    errors, "reveal=1&time=day", prepare);
  await focus(page, FREE, 1.1);
  await (await openDevelopmentAction(page, "Economy AI")).click();
  await shot(page, "01-opened-before-first-decision");
  await page.waitForTimeout(DECIDING_MS);
  const probeOn = await goalProbeInstalled(page);
  await shot(page, "02-faction-2-develop");
  await page.getByRole("group", { name: "AI faction" }).getByRole("button", { name: "3", exact: true }).click();
  await focus(page, WALLED, 1.1);
  await shot(page, "03-faction-3-no-plot-backoff");
  await page.getByRole("button", { name: "Close economy ai window", exact: true }).click();
  const probeOff = !await goalProbeInstalled(page);
  await shot(page, "04-closed");
  console.log(JSON.stringify({ errors, out, probeOffAfterClose: probeOff, probeOnWhileOpen: probeOn }, null, 2));
} finally { await browser.close(); await devServer.server.close(); }
