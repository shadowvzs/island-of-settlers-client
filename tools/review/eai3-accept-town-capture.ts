import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import { type LiveWindow, openDecorReviewPage } from "../bench/decor-review-session";
import { openFixturePage } from "../bench/flat-island-fixture";

/**
 * EAI3-accept review: the town a `develop` AI built on the P3 reference maps, at a close and a gameplay view on High
 * and Minimal. The saves come from the acceptance tests (`ECONOMY_SAVE_FIXTURE_OUTPUT=<saves> … --project slow
 * tests/economy-ai-develop-acceptance.slow.test.ts -t functional`; EAI4a's military district:
 * `economy-ai-military-acceptance.slow.test.ts`, save `p4-military`).
 *   npx tsx tools/review/eai3-accept-town-capture.ts <saves folder> <out folder> [save name …]
 */
const AI_FACTION = 2;
const VIEWS = [{ name: "gameplay", zoom: .55 }, { name: "close", zoom: 1.1 }] as const;
const QUALITIES = ["high", "minimal"] as const;
const SETTLE_MS = 2500;

const savesFolder = resolve(process.argv[2] ?? "saves");
const out = resolve(process.argv[3] ?? "eai3-accept-town");
const maps = process.argv.length > 4 ? process.argv.slice(4) : ["p3-flat", "p3-coastal", "p3-hilly"];
mkdirSync(out, { recursive: true });

interface SavedBuilding { militaryFaction?: number; x: number; z: number }

/** The middle of the AI faction's buildings in a saved game. */
const townCentre = (text: string) => {
  const own = (JSON.parse(text).settlement.buildings as SavedBuilding[])
    .filter(building => building.militaryFaction === AI_FACTION);
  const sum = own.reduce((total, { x, z }) => ({ x: total.x + x, z: total.z + z }), { x: 0, z: 0 });
  return { count: own.length, x: sum.x / own.length, z: sum.z / own.length };
};

const writeStartupGame = (page: Page, text: string) => page.evaluate(async save => {
  const imp = (path: string) => import(/* @vite-ignore */ path);
  const { settingsStorage } = await imp("/src/app/settings/graphics-settings.ts");
  const { openLocalSaveStore } = await imp("/src/app/save-store/local-save-store.ts");
  settingsStorage.writeFog(false);
  await (await openLocalSaveStore()).writeStartupGame(save);
}, text);

const focus = (page: Page, centre: { x: number; z: number }, zoom: number) => page.evaluate(view => {
  (window as LiveWindow).__settlement.focusGround(view.x, view.z, view.zoom);
}, { ...centre, zoom });

const errors: string[] = [];
const devServer = await startDevServer();
const browser = await launchBrowser();
const shots: string[] = [];
try {
  for (const map of maps) {
    const text = readFileSync(resolve(savesFolder, `${map}.json`), "utf8");
    const centre = townCentre(text);
    for (const quality of QUALITIES) {
      const prepare = async (page: Page) => {
        await openFixturePage(page, devServer.url);
        await writeStartupGame(page, text);
      };
      const page = await openDecorReviewPage(browser, `${devServer.url}admin.html`, quality, errors,
        "reveal=1&time=day", prepare);
      for (const { name, zoom } of VIEWS) {
        await focus(page, centre, zoom);
        await page.waitForTimeout(SETTLE_MS);
        const path = resolve(out, `${map}-${quality}-${name}.png`);
        await page.screenshot({ path });
        shots.push(path);
      }
      await page.close();
    }
  }
  console.log(JSON.stringify({ errors, shots }, null, 2));
} finally { await browser.close(); await devServer.server.close(); }
