import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { PRODUCTION_SPEED_FACTOR } from "../../src/shared/balance/economy";
import { workshopUpgradeCost } from "../../src/shared/settlement/workshop-upgrades";
import { createFlaxP08Fixture } from "./flax-p08-fixture";
import { measureFlaxPassiveGrowth } from "./flax-p08-growth";
import { runFlaxP08Horizons } from "./flax-p08-horizons";
import { assertFlaxConservation, createFlaxLedger, flaxOwned } from "./flax-p08-ledger";
import { createNaturalProgressionSession } from "./natural-progression-session";
import { resourcesPath } from "./resources-path";

const output = resolve(process.env.OUT ?? resourcesPath("project-reviews", "acceptance-2026-10-28", "flax-p08"));
mkdirSync(output, { recursive: true });
const fixture = await createFlaxP08Fixture(), ledger = createFlaxLedger();
let session = await createNaturalProgressionSession(fixture.save, ledger.observe);
const reports: unknown[] = [], upgrades: unknown[] = [];
let saved = 0;
let observeLoad: (() => void) | undefined;
let partialUpgrade: Awaited<ReturnType<typeof session.save>> | undefined;
const checkpoint = async (label: string) => {
  const state = await session.save();
  writeFileSync(resolve(output, `${String(saved++).padStart(2, "0")}-${label}.json`), JSON.stringify(state));
  return state;
};
const building = (type: number) => session.sim.buildings().find(site => site.typeId === type)!;
const advance = (seconds: number, until?: () => boolean) => {
  for (let tick = 0; tick < seconds * 20; tick++) {
    if (until?.()) break;
    session.sim.update(.05);
    if (tick % 20 === 0) observeLoad?.();
  }
  if (until) assert(until(), `Bounded P08 transition after ${seconds}s: ${JSON.stringify(session.sim.buildings().filter(site => [60, 61].includes(site.typeId)).map(site => ({ type: site.typeId, status: site.status, output: site.output, upgrade: site.workshopUpgrade })))}`);
};
const restore = async (label: string) => {
  const before = await checkpoint(label);
  session = await createNaturalProgressionSession(before, ledger.observe);
  const after = await session.save();
  assert.deepEqual(after.settlement.fields, before.settlement.fields, "Field identities and partial growth survive");
  assert.deepEqual(after.settlement.actors.map(actor => actor.uid), before.settlement.actors.map(actor => actor.uid));
  assert.equal(after.settlement.settlers, before.settlement.settlers);
  for (const ware of ["flax", "cloth", "planks", "hardwoodPlanks", "marble"])
    assert.equal(flaxOwned(after, ware), flaxOwned(before, ware), `Reload ${ware}`);
};
const rate = (type: number) => {
  const uid = building(type).uid;
  advance(1800, () => session.sim.frames().some(actor => actor.building === uid && actor.phase === "work" && actor.timer > 3));
  const actor = session.sim.frames().find(actor => actor.building === uid && actor.phase === "work")!;
  const timer = actor.timer;
  advance(.25);
  assert.equal(actor.phase, "work");
  return (timer - actor.timer) / .25;
};
await checkpoint("authored-finite-baseline");
for (const type of [60, 61]) assert.equal(Math.round(rate(type) * 1000) / 1000, PRODUCTION_SPEED_FACTOR);
// Cancel a partially paid/worked upgrade, retaining live paid loom input and every material.
{
  const loom = building(61), before = await session.save(), cost = workshopUpgradeCost(loom);
  assert(session.sim.requestWorkshopUpgrade(loom.uid));
  advance(900, () => (building(61).workshopUpgrade?.progress ?? 0) > 0);
  partialUpgrade = await checkpoint("partial-upgrade-horizon-source");
  await restore("partial-upgrade-cancel");
  assert(session.sim.cancelWorkshopUpgrade(building(61).uid));
  advance(900, () => !building(61).workshopUpgrade?.cancelling);
  const after = await session.save();
  for (const ware of Object.keys(cost)) assert.equal(flaxOwned(after, ware), flaxOwned(before, ware));
  upgrades.push({ kind: "cancelled-partial", type: 61, cost });
}
for (let level = 1; level <= 4; level++) {
  for (const type of [60, 61]) {
    const site = building(type), before = await session.save(), cost = workshopUpgradeCost(site);
    const footprint = [site.x, site.z, site.width, site.depth, site.rotation];
    assert(session.sim.requestWorkshopUpgrade(site.uid));
    advance(900, () => Object.values(building(type).workshopUpgrade?.reserved ?? {}).some(value => value > 0));
    await restore(`type-${type}-level-${level + 1}-escrow`);
    advance(1200, () => building(type).workshopUpgrade?.level === level);
    const after = await session.save();
    for (const [ware, count] of Object.entries(cost)) assert.equal(flaxOwned(before, ware) - flaxOwned(after, ware), count);
    assert.deepEqual([building(type).x, building(type).z, building(type).width, building(type).depth, building(type).rotation], footprint);
    const measuredRate = rate(type);
    assert(Math.abs(measuredRate - PRODUCTION_SPEED_FACTOR * (1 + .1 * level)) < 1e-6);
    assert(session.sim.fieldFrames().filter(field => field.owner === building(60).uid).length <= 4);
    upgrades.push({ type, displayedLevel: level + 1, cost, measuredRate });
    console.log(`paid type${type} level${level + 1}, actual work rate ${measuredRate.toFixed(3)}`);
  }
}
const upgraded = await checkpoint("both-producers-level-five");
const upgradeConservation = assertFlaxConservation(fixture.save, upgraded, ledger);
const pairs = new Map<string, { ships: number[]; owned: Record<string, number>; people: number }>();
for (const load of [{ name: "light", units: 2 }, { name: "normal", units: 16 }, { name: "heavy", units: 64 }]) {
  for (const reload of [false, true]) {
    const counts = createFlaxLedger();
    session = await createNaturalProgressionSession(structuredClone(upgraded), counts.observe);
    session.sim.setProductionPaused(building(36).uid, false);
    assert(session.sim.transferWare(session.sim.headquarters.uid, fixture.harbour, "ironOre", load.units));
    const before = await session.save();
    const queue = { peakCarriers: 0, peakHiddenDepartures: 0, peakWaiting: 0, peakBlocked: 0 };
    observeLoad = () => {
      const actors = session.sim.frames().filter(actor => actor.job === "Carrier" && actor.phase !== "inside");
      queue.peakCarriers = Math.max(queue.peakCarriers, actors.length);
      queue.peakHiddenDepartures = Math.max(queue.peakHiddenDepartures, actors.filter(actor => !actor.visible).length);
      queue.peakWaiting = Math.max(queue.peakWaiting, actors.filter(actor => actor.queueTarget || (actor.queueWait ?? 0) > 0).length);
      queue.peakBlocked = Math.max(queue.peakBlocked, actors.filter(actor => actor.phase.includes("Blocked")).length);
    };
    const cpu = process.cpuUsage(), started = performance.now();
    advance(900);
    if (reload) {
      const middle = await checkpoint(`${load.name}-partial-road-hull`);
      session = await createNaturalProgressionSession(middle, counts.observe);
    }
    advance(900);
    const after = await session.save();
    observeLoad = undefined;
    const cpuUsed = process.cpuUsage(cpu);
    const owned = assertFlaxConservation(before, after, counts);
    const delivered = after.settlement.buildings.find(site => site.uid === fixture.harbour)!.inventory.ironOre ?? 0;
    assert(delivered > 0, "Finite harbour traffic physically delivers");
    const ships = after.settlement.naval.fleet.ships.map(ship => ship.id);
    assert(ships.length > upgraded.settlement.naval.fleet.ships.length, "Loaded upgraded chain launches another real hull");
    if (!reload) pairs.set(load.name, { ships, owned, people: after.settlement.settlers });
    else assert.deepEqual({ ships, owned, people: after.settlement.settlers }, pairs.get(load.name), "Continuous/split finite endpoints");
    reports.push({ load: load.name, requested: load.units, delivered, reload, seconds: 1800,
      wallMs: Math.round(performance.now() - started), cpuMs: (cpuUsed.user + cpuUsed.system) / 1000, queue, owned, produced: counts.produced, consumed: counts.consumed,
      ships, partialSites: after.settlement.naval.sites, idleSettlers: after.settlement.settlers,
      people: after.settlement.settlers + after.settlement.actors.filter(actor => actor.phase !== "retired" && actor.job !== "Mount").length });
    console.log(`${load.name} reload${reload}: delivered${delivered}, ships${ships.length}`);
    writeFileSync(resolve(output, `${load.name}-${reload ? "reloaded" : "continuous"}.json`), JSON.stringify(after));
  }
}
const passiveGrowth = await measureFlaxPassiveGrowth(upgraded);
const horizons = await runFlaxP08Horizons(partialUpgrade!, output);
writeFileSync(resolve(output, "report.json"), JSON.stringify({ authored: fixture.authored, fixtureStock: fixture.stock,
  harbour: fixture.harbour, upgradeConservation, upgrades, reports, horizons, passiveGrowth, note: "Functional CPU observations, not isolated frame/performance budgets" }, null, 2));
