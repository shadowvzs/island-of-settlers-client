import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { openDevelopmentCategory } from "./development-ui-helpers";
import { trackPageErrors, waitForIsland } from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

/**
 * FISHER-BOAT L6 / FISHER-POLISH review on seed 12, High and Minimal, close (zoom 3) and normal (zoom 1):
 * - `trip` (day): rowing over shallow and deep water, the net cast and haul, rowing back with the catch,
 *   the parked boat; `night`: rowing and parked with the lantern;
 * - `yard`: a delivered boat leaning on the Fishery wall, every nation (High), all four rotations (zoom 3).
 * Usage: npx tsx tools/bench/fisher-boat-trip-review.ts [outputDir] [port] [trip|night|yard]
 */
type Page = import("playwright-core").Page;

const output = process.argv[2] ?? resourcesPath("fisher-boat", "trip");
const port = Number(process.argv[3] ?? 5373);
const mode = process.argv[4] ?? "trip";
const NATIONS = ["roman", "viking", "japanese", "nubian", "indigenous", "chinese", "persian", "maya"];
mkdirSync(output, { recursive: true });

/** Valid completed Fishery plots near the headquarters; `boat` switches each to boat mode (one boat). */
const placeFisheries = (page: Page, count: number, boat: boolean) => page.evaluate(({ boatMode, wanted }) => {
  const simulation = (window as any).__settlement.simulation, hq = simulation.headquarters;
  const placed: number[] = [];
  if (boatMode) hq.inventory.boat = 1;
  for (let radius = 6; radius <= 30 && placed.length < wanted; radius++)
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) for (const offset of [0, .5]) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius || placed.length >= wanted) continue;
      const x = Math.floor(hq.x) + dx + offset, z = Math.floor(hq.z) + dz + offset, rotation = placed.length % 4;
      if (simulation.validatePlacement(18, x, z, rotation) !== null) continue;
      const result = simulation.placeBuilding(18, x, z, rotation);
      if (!result.ok) continue;
      Object.assign(result.building, { construction: 1, required: {} });
      simulation.connectRoads(result.building.access, hq.access);
      simulation.update(.05);
      if (!boatMode) { result.building.input.boat = 1; placed.push(result.building.uid); continue; }
      if (simulation.setFisherMode(result.building.uid, "boat")) placed.push(result.building.uid);
      else simulation.demolishBuilding(result.building.uid);
    }
  return placed;
}, { boatMode: boat, wanted: count });

/** Runs the simulation until the Fishery's fisher reaches `phase` (at most `seconds`). */
const runUntil = (page: Page, uid: number, phase: string, seconds: number) => page.evaluate(
  ({ phase: wanted, seconds: limit, uid: fishery }) => {
    const simulation = (window as any).__settlement.simulation;
    for (let tick = 0; tick < limit * 20; tick++) {
      simulation.update(.05);
      const building = simulation.buildings().find((entry: { uid: number }) => entry.uid === fishery);
      const actor = simulation.frames().find((entry: { uid: number }) => entry.uid === building?.worker);
      if (actor?.phase === wanted) return true;
    }
    return false;
  }, { phase, seconds, uid });

/** Runs the simulation until the skiff's net progress reaches `share` (0..1). */
const runUntilNet = (page: Page, uid: number, share: number) => page.evaluate(({ fishery, wanted }) => {
  const simulation = (window as any).__settlement.simulation;
  for (let tick = 0; tick < 2400; tick++) {
    const frame = simulation.fishingBoatFrames().find((entry: { id: number }) => entry.id === fishery);
    if ((frame?.net ?? -1) >= wanted) return true;
    simulation.update(.05);
  }
  return false;
}, { fishery: uid, wanted: share });

const boatFrame = (page: Page, uid: number) => page.evaluate(fishery =>
  (window as any).__settlement.simulation.fishingBoatFrames().find((frame: { id: number }) => frame.id === fishery),
uid);

const shoot = async (page: Page, uid: number, name: string, zooms = [3, 1]) => {
  const frame = await boatFrame(page, uid);
  if (!frame) return null;
  for (const zoom of zooms) {
    await page.evaluate(({ level, x, z }) => (window as any).__settlement.focusGround(x, z, level),
      { level: zoom, x: frame.x, z: frame.z });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(output, `${name}-zoom${zoom}.png`) });
  }
  return frame;
};

const shootParked = async (page: Page, uid: number, name: string) => {
  await runUntil(page, uid, "outputWalk", 300);
  await runUntil(page, uid, "__never__", 3);
  return shoot(page, uid, name);
};

const tripShots = async (page: Page, quality: string, night: boolean) => {
  const [uid] = await placeFisheries(page, 1, true);
  const shots: Record<string, unknown> = { uid };
  if (uid === undefined || !await runUntil(page, uid, "fisherBoatRowOut", 400)) return shots;
  const prefix = `${quality}-${night ? "night-" : ""}`;
  await runUntil(page, uid, "__never__", 1.5);
  shots.rowingShallow = await shoot(page, uid, `${prefix}rowing-shallow`);
  if (night) { shots.parked = await shootParked(page, uid, `${prefix}parked`); return shots; }
  await runUntilNet(page, uid, .08);
  shots.netCast = await shoot(page, uid, `${prefix}net-cast`, [3]);
  await runUntilNet(page, uid, .4);
  shots.net = await shoot(page, uid, `${prefix}net`);
  await runUntilNet(page, uid, .86);
  shots.netHaul = await shoot(page, uid, `${prefix}net-haul`, [3]);
  await runUntil(page, uid, "fisherBoatRowBack", 30);
  await runUntil(page, uid, "__never__", 1);
  shots.rowingBack = await shoot(page, uid, `${prefix}rowing-back-deep`);
  shots.parked = await shootParked(page, uid, `${prefix}parked`);
  return shots;
};

const switchNation = async (page: Page, nation: string) => {
  const panel = await openDevelopmentCategory(page, "Appearance");
  const current = await page.evaluate(() => (window as any).__settlement.simulation.playerNation());
  if (current !== nation) {
    await panel.getByRole("radiogroup", { exact: true, name: "Nation" }).locator(`[data-nation="${nation}"]`).click();
    await page.waitForFunction(wanted => (window as any).__settlement.simulation.playerNation() === wanted, nation,
      { timeout: 180000 });
  }
  await page.getByRole("button", { name: "Close development tools panel", exact: true }).click();
  await page.waitForTimeout(2500);
};

const yardShots = async (page: Page, quality: string) => {
  const uids = await placeFisheries(page, 4, false);
  const shots: Record<string, unknown> = { uids };
  for (const nation of quality === "high" ? NATIONS : ["roman", "nubian"]) {
    await switchNation(page, nation);
    for (const [rotation, uid] of uids.entries())
      shots[`${nation}-r${rotation}`] = await shoot(page, uid, `${quality}-yard-${nation}-r${rotation}`, [3]);
  }
  return shots;
};

const { server, url } = await startDevServer({ port });
const browser = await launchBrowser();
const report: Record<string, unknown> = { mode };
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = trackPageErrors(page, () => quality);
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    const time = mode === "night" ? "night" : "day";
    const entry = mode === "yard" ? "admin.html" : "";
    await page.goto(`${url}${entry}?quality=${quality}&seed=12&size=128&mountains=0&forest=0&cache=0&skipLogin=1` +
      `&time=${time}`);
    await waitForIsland(page);
    const shots = mode === "yard" ? await yardShots(page, quality) : await tripShots(page, quality, mode === "night");
    report[quality] = { errors, shots };
    await page.close();
  }
  writeFileSync(resolve(output, `${mode}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
