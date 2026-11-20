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
const requestedQuality = process.argv[5];
const requestedNation = process.argv[6];
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
      (window as any).__fisherManualAdvance(.05);
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
    (window as any).__fisherManualAdvance(.05);
  }
  return false;
}, { fishery: uid, wanted: share });

const boatFrame = (page: Page, uid: number) => page.evaluate(fishery =>
  (window as any).__settlement.simulation.fishingBoatFrames().find((frame: { id: number }) => frame.id === fishery),
uid);

const reachPhaseShare = (page: Page, uid: number, phase: string, duration: number, share: number) =>
  page.evaluate(({ fishery, phase, duration, share }) => {
    const sim = (window as any).__settlement.simulation;
    for (let tick = 0; tick < 1000; tick++) {
      const building = sim.buildings().find((row: any) => row.uid === fishery);
      const actor = sim.frames().find((row: any) => row.uid === building?.worker);
      if (actor?.phase !== phase) return false;
      if (1 - actor.timer / duration >= Math.min(.98, share)) return true;
      (window as any).__fisherManualAdvance(.01);
    }
    return false;
  }, { fishery: uid, phase, duration, share });

const shoot = async (page: Page, uid: number, name: string, zooms = [3, 1], useActor = false) => {
  const actor = () => page.evaluate(fishery => {
    const sim = (window as any).__settlement.simulation;
    const building = sim.buildings().find((entry: any) => entry.uid === fishery);
    return sim.frames().find((entry: any) => entry.uid === building?.worker);
  }, uid);
  const frame = useActor ? await actor() : await boatFrame(page, uid) ?? await actor();
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
  if (uid === undefined) return shots;
  await page.evaluate(() => {
    const sim = (window as any).__settlement.simulation;
    (window as any).__fisherManualAdvance = sim.update.bind(sim);
    sim.update = () => {};
  });
  const step = async (seconds: number) => page.evaluate(duration => {
    for (let tick = 0; tick < duration * 20; tick++) (window as any).__fisherManualAdvance(.05);
  }, seconds);
  const prefix = `${quality}-${night ? "night-" : ""}`;
  if (!night) await page.evaluate(() => { (window as any).__fisherCamera.yaw = Math.PI * 5 / 4; });
  if (!night) for (const direction of ["putdown"]) for (const progress of [.05, .4, .8]) {
    const carrier = await page.evaluate(({ fishery, direction, progress }) => {
      const sim = (window as any).__settlement.simulation;
      for (let tick = 0; tick < 30000; tick++) {
        const actor = sim.frames().find((actor: any) => actor.delivery?.destination === fishery && actor.wareTransfer?.ware === "boat" && actor.wareTransfer.direction === direction && actor.wareTransfer.progress >= progress);
        if (actor) return { uid: actor.uid, x: actor.x, y: actor.y, z: actor.z, wareScale: actor.wareScale, transfer: actor.wareTransfer };
        (window as any).__fisherManualAdvance(.02);
      }
      return null;
    }, { fishery: uid, direction, progress });
    if (!carrier) throw new Error(`Missed carrier ${direction} ${progress}`);
    shots[`carrier-${direction}-${progress}`] = carrier;
    await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 4), carrier);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(output, `${prefix}carrier-${direction}-${Math.round(progress * 100)}.png`) });
  }
  for (const [phase, label] of [["fisherBoatLift", "lift"], ["fisherBoatCarry", "carry"],
    ["fisherBoatLaunch", "launch"], ["fisherBoatRowOut", "row"]]) {
    if (!await runUntil(page, uid, phase!, 600)) throw new Error(`Missing ${phase}`);
    if (phase === "fisherBoatLaunch") {
      for (const share of [0, .25, .5, .75, 1]) {
        const reached = share === 1 ? await runUntil(page, uid, "fisherBoatRowOut", 10) :
          await reachPhaseShare(page, uid, phase, 3, share);
        if (!reached) throw new Error(`Missed ${phase} ${share}`);
        await shoot(page, uid, `${prefix}launch-${Math.round(share * 100)}`, [4]);
      }
    } else await step(phase === "fisherBoatLift" ? .5 : .2);
    shots[label!] = await shoot(page, uid, `${prefix}${label}`, [3]);
    if (phase === "fisherBoatCarry") await page.evaluate(() => { (window as any).__fisherCamera.yaw = Math.PI / 4; });
  }
  shots.rowingShallow = await shoot(page, uid, `${prefix}rowing-shallow`);
  if (night) { shots.parked = await shootParked(page, uid, `${prefix}parked`); return shots; }
  await runUntilNet(page, uid, .08);
  shots.netCast = await shoot(page, uid, `${prefix}net-cast`, [3]);
  await runUntilNet(page, uid, .4);
  shots.net = await shoot(page, uid, `${prefix}net`);
  await runUntilNet(page, uid, .86);
  shots.netHaul = await shoot(page, uid, `${prefix}net-haul`, [3]);
  await runUntil(page, uid, "fisherBoatRowBack", 30);
  await step(1);
  shots.rowingBack = await shoot(page, uid, `${prefix}rowing-back-deep`);
  if (!await runUntil(page, uid, "fisherBoatBeach", 300)) throw new Error("Missing beach");
  await page.evaluate(fishery => {
    const sim = (window as any).__settlement.simulation;
    sim.buildings().find((building: any) => building.uid === fishery).output.fish = 5;
  }, uid);
  for (const share of [0, .25, .5]) {
    if (!await reachPhaseShare(page, uid, "fisherBoatBeach", 2.4, share)) throw new Error(`Missed beach ${share}`);
    await shoot(page, uid, `${prefix}beach-${Math.round(share * 100)}`, [4]);
  }
  shots.beach = await shoot(page, uid, `${prefix}beach`, [3]);
  const pickupReached = await page.evaluate(fishery => {
    const sim = (window as any).__settlement.simulation;
    for (let tick = 0; tick < 100; tick++) {
      const building = sim.buildings().find((row: any) => row.uid === fishery);
      const actor = sim.frames().find((row: any) => row.uid === building?.worker);
      if (actor?.phase !== "fisherBoatBeach") return false;
      if (actor.timer < .75) return true;
      (window as any).__fisherManualAdvance(.05);
    }
    return false;
  }, uid);
  if (!pickupReached) throw new Error("Missed basket pickup phase");
  shots.pickup = await shoot(page, uid, `${prefix}basket-pickup`, [3]);
  for (let turn = 0; turn < 2; turn++) {
    await page.evaluate(index => { const camera = (window as any).__fisherCamera;
      camera.yaw = index * Math.PI / 2; camera.zoom = 4; }, turn);
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(output, `${prefix}basket-pickup-close${turn}.png`) });
  }
  await page.evaluate(() => { (window as any).__fisherCamera.yaw = Math.PI / 4; });
  for (const share of [.75, 1]) {
    const reached = share === 1 ? await runUntil(page, uid, "outputWalk", 10) :
      await reachPhaseShare(page, uid, "fisherBoatBeach", 2.4, share);
    if (!reached) throw new Error(`Missed beach ${share}`);
    await shoot(page, uid, `${prefix}beach-${Math.round(share * 100)}`, [4]);
  }
  if (!await runUntil(page, uid, "outputWalk", 60)) throw new Error("Missing basket walk");
  shots.basket = await shoot(page, uid, `${prefix}basket-walk`, [3], true);
  const stock = await page.evaluate(fishery => {
    const sim = (window as any).__settlement.simulation;
    for (let tick = 0; tick < 2400; tick++) {
      (window as any).__fisherManualAdvance(.05);
      const building = sim.buildings().find((row: any) => row.uid === fishery);
      if ((building.output.fish ?? 0) >= 9) return { fish: building.output.fish, x: building.x, z: building.z };
    }
    return null;
  }, uid);
  if (!stock) throw new Error("Basket did not reach 9-fish shelf");
  shots.stock = stock;
  await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 3), stock);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(output, `${prefix}shelf-nine.png`) });
  for (let turn = 0; turn < 4; turn++) {
    await page.evaluate(index => { (window as any).__fisherCamera.yaw = index * Math.PI / 2; }, turn);
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(output, `${prefix}shelf-nine-view${turn}.png`) });
  }
  shots.parked = await shoot(page, uid, `${prefix}parked`, [3]);
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
  for (const nation of requestedNation ? [requestedNation] : quality === "high" ? NATIONS : ["roman", "nubian"]) {
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
  for (const quality of requestedQuality ? [requestedQuality] : ["minimal", "high"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = trackPageErrors(page, () => quality);
    await page.route("**/src/app/island-runtime.ts", async route => {
      const response = await route.fetch(), body = await response.text();
      await route.fulfill({ response, body: body.replace("window.__islandReady = true",
        "window.__fisherCamera = camera; window.__islandReady = true") });
    });
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
  writeFileSync(resolve(output, `${mode}${requestedQuality ? "-" + requestedQuality : ""}-report.json`), JSON.stringify(report, null, 2));
  console.log(`Saved fishing trip review to ${output}`);
} finally {
  await browser.close();
  await server.close();
}
