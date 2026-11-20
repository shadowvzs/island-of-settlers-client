import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * A busy harbour on High (naval flow, owner 2026-10-21): the debug colony harbour receives six supply visitors
 * at once; two minutes later the harbour and the water around it are shot from above at gameplay zoom, and
 * the ships waiting in sight are counted.
 * Usage: npx tsx tools/bench/harbour-flow-review.ts <name>   (e.g. before / after)
 */
const name = process.argv[2] ?? "busy";
const output = resourcesPath("naval-flow-2026-10-21");
mkdirSync(output, { recursive: true });

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${url}?quality=high&seed=12&size=128&mountains=0&forest=0&cache=0&skipLogin=1&unlockall=1`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 180000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  const report = await page.evaluate(async () => {
    const settlement = (window as any).__settlement, simulation = settlement.simulation;
    const started = simulation.startDebugExpedition("colony");
    if (!started.ok) return started;
    for (let tick = 0; tick < 2400; tick++) simulation.update(.05);
    for (let ship = 0; ship < 6; ship++) simulation.sendVisitorShip({ stone: 600 });
    let mostWaiting = 0;
    for (let tick = 0; tick < 2400; tick++) {
      simulation.update(.05);
      const ships = simulation.saveState().naval.fleet.ships;
      mostWaiting = Math.max(mostWaiting, ships.filter((ship: any) => ship.queuedAt && !ship.waitsAtEdge &&
        ship.phase !== "away").length);
      if (tick % 200 === 0) await new Promise(next => setTimeout(next, 0));
    }
    const harbour = simulation.buildings().find((building: any) => building.typeId === 39);
    settlement.focusGround(harbour.x + 14, harbour.z);
    const ships = simulation.saveState().naval.fleet.ships;
    return { mostWaiting, ok: true, ships: ships.map((ship: any) => `${ship.phase}${ship.queuedAt ? "Q" : ""}`) };
  });
  assert(report.ok, JSON.stringify(report));
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(output, `high-busy-harbour-${name}.png`) });
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
