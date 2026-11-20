import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { trackPageErrors, waitForIsland } from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

/**
 * FISHER-BOAT L3 panel review: a real Fishery near the ocean shore with the boat option unavailable
 * (no spare boat), available, and selected, plus an inland Fishery without a boat shore.
 * Usage: npx tsx tools/bench/fisher-boat-panel-review.ts [outputDir] [quality] [port]
 */
type Page = import("playwright-core").Page;
type Plot = { uid: number; x: number; z: number };

const output = process.argv[2] ?? resourcesPath("fisher-boat", "panel");
const quality = process.argv[3] ?? "high";
const port = Number(process.argv[4] ?? 5371);
mkdirSync(output, { recursive: true });

/** Completed fisheries near the headquarters: one with a boat shore, one without. */
const placeFisheries = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation, hq = simulation.headquarters;
  const found: Record<string, Plot> = {}, reasons: Record<string, number> = {};
  for (let radius = 6; radius <= 40 && Object.keys(found).length < 2; radius++)
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++)
      for (const offset of [0, .5]) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius || Object.keys(found).length >= 2) continue;
      const x = Math.floor(hq.x) + dx + offset, z = Math.floor(hq.z) + dz + offset;
      const shore = found.shore;
      if (shore && Math.hypot(x - shore.x, z - shore.z) < 14) continue;
      const reason = simulation.validatePlacement(18, x, z, 0);
      if (reason !== null) { reasons[String(reason)] = (reasons[String(reason)] ?? 0) + 1; continue; }
      const placed = simulation.placeBuilding(18, x, z, 0);
      if (!placed.ok) continue;
      const building = placed.building;
      Object.assign(building, { construction: 1, required: {} });
      const kind = simulation.fisherBoatStatus(building.uid)?.block === "noShore" ? "inland" : "shore";
      if (!found[kind] && simulation.connectRoads(building.access, hq.access)) {
        found[kind] = { uid: building.uid, x: building.x, z: building.z };
        continue;
      }
      simulation.demolishBuilding(building.uid);
    }
  return { found, reasons };
});

const openPanel = async (page: Page, plot: Plot) => {
  await page.keyboard.press("Escape");
  await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z), plot);
  await page.waitForTimeout(900);
  const screen = await page.evaluate(({ x, z }) => (window as any).__settlement.project(x, 2, z), plot);
  await page.mouse.click(screen.x, screen.y);
  const panel = page.locator(".settlement-ui__building-details-window:not([hidden])");
  await panel.waitFor({ state: "visible" });
  await page.waitForTimeout(700);
  return panel;
};

/** The boat button's accessible state and tooltip, as the player's browser would expose them. */
const boatButton = (page: Page) => page.evaluate(() => {
  const button = document.querySelector<HTMLButtonElement>(
    '.settlement-ui__fisher-mode button[aria-label^="Fish with: boat"]');
  const note = document.querySelector(".settlement-ui__fisher-mode [role=note]");
  return button && { ariaDisabled: button.getAttribute("aria-disabled"),
    ariaPressed: button.getAttribute("aria-pressed"), note: note?.textContent, title: button.title };
});

const capture = async (page: Page, plot: Plot, name: string) => {
  const panel = await openPanel(page, plot);
  await page.screenshot({ path: resolve(output, `${quality}-${name}-scene.png`) });
  await panel.screenshot({ path: resolve(output, `${quality}-${name}-panel.png`) });
  return boatButton(page);
};

const { server, url } = await startDevServer({ port });
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = trackPageErrors(page, () => quality);
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${url}?quality=${quality}&seed=12&size=128&mountains=0&forest=0&cache=0&skipLogin=1`);
  await waitForIsland(page);
  const { found: plots, reasons } = await placeFisheries(page);
  report.plots = plots;
  report.placementReasons = reasons;
  const setBoats = (count: number) => page.evaluate(value => {
    (window as any).__settlement.simulation.headquarters.inventory.boat = value;
  }, count);
  if (plots.shore) {
    await setBoats(0);
    report.noBoat = await capture(page, plots.shore, "no-boat");
    await setBoats(1);
    report.available = await capture(page, plots.shore, "available");
    await page.locator('.settlement-ui__fisher-mode button[aria-label^="Fish with: boat"]').click();
    await page.waitForTimeout(700);
    report.selected = await capture(page, plots.shore, "boat-selected");
    report.boatSite = await page.evaluate(uid => (window as any).__settlement.simulation.saveState().buildings
      .find((building: { uid: number }) => building.uid === uid)?.boatSite, plots.shore.uid);
  }
  if (plots.inland) report.noShore = await capture(page, plots.inland, "no-shore");
  report.errors = errors;
  writeFileSync(resolve(output, `${quality}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
