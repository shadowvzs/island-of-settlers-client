import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { TICKS_PER_DAY } from "../../../island-of-settlers-shared/src/time/constants";
import { launchBrowser, startDevServer } from "../bench/browser";

/**
 * Ruin scorch review (GROUND-PALETTE step 7): a fresh island where the settlement's ruin list is replaced by stand-in
 * ruins (render only: `simulation.ruins` is wrapped in the page, no game state changes) of a few ages, shot at the
 * iso close and normal zoom on each preset.
 *   npx tsx tools/review/ruin-scorch-capture.ts <out dir> [x,z] [query]
 */
const [outArg = "ruin-scorch", spot = "30,60", query = "size=128&seed=123&cache=0&skipLogin=1&reveal=1"] =
  process.argv.slice(2);
const output = resolve(outArg);
mkdirSync(output, { recursive: true });
const [x, z] = spot.split(",").map(Number) as [number, number];
/** Stand-in ruins: plot centre offsets (cells), plot size and age in game days. */
const RUINS = [
  { age: 0, depth: 4, dx: -5, dz: 0, width: 4 },
  { age: 1, depth: 3, dx: 1, dz: -1, width: 3 },
  { age: 2.2, depth: 4, dx: 6, dz: 1, width: 5 }
];
const VIEWS = [["close", 2.6], ["normal", 1.46]] as const;

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of ["high", "minimal"]) {
    for (const [view, zoom] of VIEWS) {
      const page = await browser.newPage({ viewport: { height: 800, width: 1280 } });
      page.on("pageerror", error => console.log("[pageerror]", error.message));
      await page.goto(`${url}?${query}&quality=${quality}&view=${x},${z},${zoom}`);
      await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240000 });
      await page.addStyleTag({ content: ".stats-overlay { display: none !important; }" });
      await page.evaluate(({ centreX, centreZ, days, ruins }) => {
        const simulation = (window as any).__settlement.simulation;
        const tick = simulation.gameTick();
        const standIns = ruins.map((ruin, uid) => ({
          depth: ruin.depth, fallTick: tick - Math.round(ruin.age * days), uid: 900_000 + uid,
          width: ruin.width, x: centreX + ruin.dx, z: centreZ + ruin.dz
        }));
        simulation.ruins = () => standIns;
      }, { centreX: x, centreZ: z, days: TICKS_PER_DAY, ruins: RUINS });
      await page.waitForTimeout(2500);
      const file = resolve(output, `scorch-${quality}-${view}.png`);
      await page.screenshot({ path: file });
      console.log(file);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
