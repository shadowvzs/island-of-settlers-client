import { beforeAll, describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import type { OfflineEconomyMetrics } from "../src/app/settlement/offline-economy";
import { prepareOfflineEconomyFastShips } from "../src/app/settlement/offline-economy-fast-ship";
import { prepareOfflineEconomyFlax } from "../src/app/settlement/offline-economy-flax";
import { estimateOfflineEconomyRates } from "../src/app/settlement/offline-economy-rates";
import type { OfflineIslandMetrics } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { buildingUnlockLevel } from "../src/shared/progression/building-unlocks";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { Goods } from "../src/shared/settlement/settlement-types";
import { type FlaxFastIsland,flaxFastIsland, runFlaxFast } from "./helpers/flax-fast-island";

let fixture: FlaxFastIsland;
const own = (goods: Readonly<Goods>, ware: string) => Object.hasOwn(goods, ware) ? goods[ware]! : 0;
const stockOf = (save: GameSaveV1, ware: string) => save.settlement.buildings.reduce((sum, building) =>
  sum + (building.inventory[ware] ?? 0) + (building.input[ware] ?? 0) + (building.output[ware] ?? 0), 0) +
  save.settlement.storagePools.pools.reduce((sum, pool) => sum + (pool.available[ware] ?? 0), 0);
const clearWare = (save: GameSaveV1, ware: string) => {
  for (const pool of save.settlement.storagePools.pools) delete pool.available[ware];
  for (const building of save.settlement.buildings) {
    delete building.inventory[ware];
    delete building.input[ware];
    delete building.output[ware];
  }
};
const buildingOf = (save: GameSaveV1, typeId: number) =>
  save.settlement.buildings.find(building => building.typeId === typeId)!;
const fieldOf = (save: GameSaveV1, uid: number) =>
  save.settlement.fields.filter(field => field.owner === uid && field.kind === "flax");

beforeAll(async () => { fixture = await flaxFastIsland(); }, 30_000);

describe("fast flax farm ownership", () => {
  it("prepares one token per saved plot phase and never pre-harvests a ripe field", () => {
    const save = structuredClone(fixture.save), farm = buildingOf(save, 60);
    const plots = fieldOf(save, farm.uid);
    save.settlement.fields = save.settlement.fields.map(field => field.owner === farm.uid ?
      { ...field, progress: 1, state: "ripe" } : field);
    const prepared = prepareOfflineEconomyFlax(save, fixture.world, "home");
    expect(prepared.farms).toEqual([farm.uid]);
    expect(prepared.stock[`~flax:${farm.uid}:worker`]).toBe(1);
    for (const plot of plots) expect(prepared.stock[`~flax:${farm.uid}:${plot.id}:ripe`]).toBe(1);
    expect(Object.values(prepared.stock).every(value => Number.isSafeInteger(value) && value >= 0)).toBe(true);
    const collect = prepared.jobs.filter(job => job.uid.endsWith(":collect"));
    expect(collect).toHaveLength(plots.length);
    for (const job of collect) expect(job.outputs.flax).toBe(1);
    for (const job of prepared.jobs.filter(job => job.uid.endsWith(":grow")))
      expect(job.outputs).toEqual({ [`~flax:${farm.uid}:${job.uid.split(":")[2]}:ripe`]: 1 });
  });

  it("keeps the farm's own currently targeted saved plot", () => {
    const save = structuredClone(fixture.save), farm = buildingOf(save, 60);
    const field = { ...fieldOf(save, farm.uid)[0]!, state: "ripe" as const, progress: 1 };
    save.settlement.fields = [field];
    const worker = save.settlement.actors.find(actor => actor.uid === farm.worker)!;
    worker.target = { id: field.id, kind: "field", x: field.x, z: field.z };
    const prepared = prepareOfflineEconomyFlax(save, fixture.world, "home");
    expect(prepared.farms).toEqual([farm.uid]);
    expect(prepared.stock[`~flax:${farm.uid}:${field.id}:ripe`]).toBe(1);
    expect(prepared.jobs.some(job => job.uid === `flax:${farm.uid}:${field.id}:collect`)).toBe(true);
  });

  it("advances a partially grown field and keeps its phase at a short horizon", async () => {
    const save = structuredClone(fixture.save), farm = buildingOf(save, 60);
    const plots = fieldOf(save, farm.uid);
    expect(plots.length).toBe(4);
    save.settlement.fields = save.settlement.fields.map(field => field.owner === farm.uid ?
      { ...field, progress: field.id === plots[0]!.id ? .5 : 0,
        state: field.id === plots[0]!.id ? "growing" : field.state } : field);
    const before = fieldOf(save, farm.uid).find(field => field.state === "growing")!;
    const { save: next } = await runFlaxFast(save, 20);
    const after = fieldOf(next, farm.uid).find(field => field.id === before.id)!;
    expect(after.state).toBe("growing");
    expect(after.progress).toBeGreaterThan(.5);
    expect(after.progress).toBeLessThan(1);
    await expect(stageGameSession(next)).resolves.toBeDefined();
  });

  it("keeps a full farm shelf from creating a free harvest", async () => {
    const save = structuredClone(fixture.save), farm = buildingOf(save, 60);
    const hq = save.settlement.buildings.find(building => building.typeId === 0)!;
    hq.accepts.flax = false;
    clearWare(save, "flax");
    farm.output.flax = 6;
    const { metrics, save: next } = await runFlaxFast(save, 3600);
    expect(buildingOf(next, 60).output.flax).toBe(6);
    expect(stockOf(next, "flax")).toBe(6);
    expect(own(metrics.production[0]!.produced, "flax")).toBe(0);
    expect(fieldOf(next, farm.uid).every(field => field.state === "drying" || field.state === "ripe")).toBe(true);
  });

  it("conserves whole flax and cloth through the fast chain", async () => {
    const beforeFlax = stockOf(fixture.save, "flax"), beforeCloth = stockOf(fixture.save, "cloth");
    const { metrics, save } = await runFlaxFast(fixture.save, 3600);
    const ledger = metrics.production.find(island => island.islandId === "home")!;
    const jobIds = metrics.estimates[0]!.rates.jobs.map(job => job.uid);
    expect(jobIds).toContain(`building:${buildingOf(save, 60).uid}`);
    expect(jobIds).toContain(`building:${buildingOf(save, 61).uid}`);
    expect(metrics.estimates[0]!.rates.storageUids).toContain(buildingOf(save, 0).uid);
    expect(ledger.produced.flax).toBeGreaterThan(0);
    expect(ledger.produced.cloth).toBeGreaterThan(0);
    expect(ledger.consumed.flax).toBeGreaterThan(0);
    expect(Number.isSafeInteger(ledger.produced.cloth)).toBe(true);
    expect(stockOf(save, "flax") - beforeFlax).toBe(own(ledger.produced, "flax") - own(ledger.consumed, "flax"));
    expect(stockOf(save, "cloth") - beforeCloth).toBe(own(ledger.produced, "cloth") - own(ledger.consumed, "cloth"));
    expect(Object.keys(ledger.produced).some(ware => ware.startsWith("~"))).toBe(false);
    expect(Object.values(fieldOf(save, buildingOf(save, 60).uid)).every(field =>
      field.progress >= 0 && field.progress <= 1)).toBe(true);
    await expect(stageGameSession(save)).resolves.toBeDefined();
  });
});

describe("fast loom private receipts", () => {
  it("retains paid flax and produces no fractional cloth at the horizon", async () => {
    const save = structuredClone(fixture.save), farm = buildingOf(save, 60), weaver = buildingOf(save, 61);
    farm.productionPaused = true;
    clearWare(save, "flax");
    weaver.input.flax = 2;
    const before = stockOf(save, "cloth");
    const { metrics, save: next } = await runFlaxFast(save, 5);
    expect(buildingOf(next, 61).input.flax).toBe(2);
    expect(stockOf(next, "cloth")).toBe(before);
    expect(metrics.production[0]!.produced.cloth ?? 0).toBe(0);
    await expect(stageGameSession(next)).resolves.toBeDefined();
  });

  it("does not consume flax into a full cloth shelf", async () => {
    const save = structuredClone(fixture.save), weaver = buildingOf(save, 61);
    const hq = save.settlement.buildings.find(building => building.typeId === 0)!;
    hq.accepts.cloth = false;
    clearWare(save, "cloth");
    weaver.output.cloth = 6;
    weaver.input.flax = 2;
    const { save: next } = await runFlaxFast(save, 3600);
    expect(buildingOf(next, 61).output.cloth).toBe(6);
    expect(buildingOf(next, 61).input.flax).toBe(2);
    expect(stockOf(next, "cloth")).toBe(6);
  });
});

describe("fast sea-ship construction", () => {
  it("retains the explicit calibrated shipwright comparison", async () => {
    const source = structuredClone(fixture.raw);
    const prefix = await advanceOfflineGame(source, source.savedAt + 120_000, () => {},
      { exact: true, eventCore: false });
    expect(prefix.settlement.naval.active.length).toBeGreaterThan(0);
    const next = await advanceOfflineGame(source, source.savedAt + 3600_000, () => {},
      { economy: true, economyCalibrationSeconds: 120 });
    expect(next.settlement.naval.fleet.ships.length).toBeGreaterThan(0);
    expect(next.settlement.naval.active).toHaveLength(0);
    expect(buildingOf(next, 36).productionPaused).toBe(buildingOf(source, 36).productionPaused);
    expect(new Set(next.settlement.actors.map(actor => actor.uid)).size).toBe(next.settlement.actors.length);
    await expect(stageGameSession(next)).resolves.toBeDefined();
    expect(source).toEqual(fixture.raw);
  }, 30_000);

  it("default short-gap fast replay retains the original active shipwright and paid site without native ticks", async () => {
    const prefix = await advanceOfflineGame(fixture.raw, fixture.raw.savedAt + 120_000, () => {},
      { exact: true, eventCore: false });
    expect(prefix.settlement.naval.active.length).toBeGreaterThan(0);
    const original = structuredClone(prefix), native: OfflineIslandMetrics[] = [], fast: OfflineEconomyMetrics[] = [];
    const next = await advanceOfflineGame(prefix, prefix.savedAt + 180_000, () => {}, {
      onIslandMetrics: metrics => native.push(metrics), onEconomyMetrics: metrics => fast.push(metrics)
    });
    expect(native).toHaveLength(0);
    expect(fast).toHaveLength(1);
    expect(fast[0]!.calibrationSeconds).toBe(0);
    expect(next.savedAt).toBe(prefix.savedAt + 180_000);
    expect(next.settlement.naval.active).toEqual(original.settlement.naval.active);
    expect(next.settlement.naval.sites).toEqual(original.settlement.naval.sites);
    expect(next.settlement.naval.fleet.ships).toEqual(original.settlement.naval.fleet.ships);
    for (const [uid] of original.settlement.naval.active) {
      expect(original.settlement.actors.find(actor => actor.uid === uid)).toBeDefined();
      expect(next.settlement.actors.find(actor => actor.uid === uid)).toEqual(
        original.settlement.actors.find(actor => actor.uid === uid));
    }
    expect(prefix).toEqual(original);
    await expect(stageGameSession(next)).resolves.toBeDefined();
  }, 30_000);

  it("recruits real saved idle people for busy chain deliveries without changing total population", async () => {
    const source = structuredClone(fixture.raw);
    const people = (save: typeof source) => save.settlement.settlers +
      save.settlement.actors.filter(actor => actor.phase !== "retired" && actor.job !== "Mount").length;
    const beforeCarriers = source.settlement.actors.filter(actor => actor.job === "Carrier").length;
    const { save } = await runFlaxFast(source, 3600);
    const afterCarriers = save.settlement.actors.filter(actor => actor.job === "Carrier").length;
    const hires = afterCarriers - beforeCarriers;
    expect(hires).toBeGreaterThan(0);
    expect(hires).toBeLessThanOrEqual(source.settlement.settlers);
    const births = save.settlement.settlerBirths - source.settlement.settlerBirths;
    expect(people(save)).toBe(people(source) + births);
    expect(source.settlement.settlers).toBe(fixture.raw.settlement.settlers);
    await expect(stageGameSession(save)).resolves.toBeDefined();
  });

  it("builds successive paid hulls at distinct legal sites in a single fast interval", async () => {
    const save = structuredClone(fixture.raw), yard = buildingOf(save, 36);
    save.settlement.naval.sites = [];
    save.settlement.naval.active = [];
    clearWare(save, "planks"); clearWare(save, "cloth");
    for (const building of save.settlement.buildings) if (building.typeId !== 36) building.productionPaused = true;
    yard.input = { planks: 20, cloth: 8 };
    const continuous = await runFlaxFast(save, 3600);
    const ships = continuous.save.settlement.naval.fleet.ships;
    expect(ships).toHaveLength(2);
    expect(new Set(ships.map(ship => ship.id)).size).toBe(2);
    expect(new Set(ships.map(ship => `${ship.x},${ship.z}`)).size).toBe(2);
    expect(continuous.save.settlement.naval.fleet.nextShip).toBe(3);
    expect(continuous.save.settlement.naval.sites).toHaveLength(0);
    expect(buildingOf(continuous.save, 36).input.planks).toBe(0);
    expect(buildingOf(continuous.save, 36).input.cloth).toBe(0);
    await expect(stageGameSession(continuous.save)).resolves.toBeDefined();
    const first = await runFlaxFast(save, 1800);
    const split = await runFlaxFast(first.save, 1800);
    expect(split.save.settlement.naval.fleet.ships).toEqual(ships);
    const resumed = await runFlaxFast(continuous.save, 3600);
    expect(resumed.save.settlement.naval.fleet.ships).toEqual(ships);
  });

  it("retains the installed hull and materials at a short horizon, then launches once", async () => {
    const save = structuredClone(fixture.save), yard = buildingOf(save, 36);
    save.settlement.naval.sites = [];
    save.settlement.naval.active = [];
    clearWare(save, "planks");
    yard.input = { cloth: 4, planks: 10 };
    const first = await runFlaxFast(save, 120);
    const site = first.save.settlement.naval.sites.find(([uid]) => uid === yard.uid)?.[1];
    expect(site).toBeDefined();
    expect(site!.steps).toBeGreaterThanOrEqual(0);
    expect(site!.steps).toBeLessThan(10);
    expect(first.save.settlement.naval.fleet.ships).toHaveLength(0);
    expect(own(buildingOf(first.save, 36).input, "planks") + site!.steps).toBe(10);
    expect(own(buildingOf(first.save, 36).input, "cloth") + site!.cloth).toBe(4);
    const second = await runFlaxFast(first.save, 3600);
    expect(second.save.settlement.naval.sites).toHaveLength(0);
    expect(second.save.settlement.naval.fleet.ships).toHaveLength(1);
    expect(second.save.settlement.naval.fleet.nextShip).toBe(2);
    expect(second.save.settlement.naval.active).toHaveLength(0);
    expect(metricsBoat(second.metrics)).toBe(false);
    await expect(stageGameSession(second.save)).resolves.toBeDefined();
  });

  it("waits for cloth without spending a boat recipe or refunding the hull", async () => {
    const save = structuredClone(fixture.save), yard = buildingOf(save, 36);
    save.settlement.naval.sites = [];
    save.settlement.naval.active = [];
    const weaver = buildingOf(save, 61);
    weaver.productionPaused = true;
    clearWare(save, "cloth");
    yard.input = { planks: 10 };
    const { metrics, save: next } = await runFlaxFast(save, 120);
    expect(next.settlement.naval.fleet.ships).toHaveLength(0);
    expect(next.settlement.naval.sites).toHaveLength(1);
    expect(metricsBoat(metrics)).toBe(false);
    expect(own(buildingOf(next, 36).input, "planks")).toBeGreaterThan(0);
    expect(next.settlement.naval.sites[0]![1].steps).toBeGreaterThan(0);
    expect(next.settlement.naval.sites[0]![1].steps).toBeLessThan(10);
    expect(next.settlement.naval.sites[0]![1].cloth).toBe(0);
  });

  it("keeps one completion identity across a reloaded continuation", async () => {
    const save = structuredClone(fixture.save), yard = buildingOf(save, 36);
    save.settlement.naval.sites = [];
    save.settlement.naval.active = [];
    yard.input = { cloth: 4, planks: 10 };
    const first = await runFlaxFast(save, 3600);
    const ship = first.save.settlement.naval.fleet.ships[0]!;
    const second = await runFlaxFast(first.save, 10);
    expect(second.save.settlement.naval.fleet.ships.filter(entry => entry.id === ship.id)).toHaveLength(1);
    expect(second.save.settlement.naval.fleet.nextShip).toBe(first.save.settlement.naval.fleet.nextShip);
  });

  it("keeps a sea site paused in Boats mode and spends no cloth on it", async () => {
    const save = structuredClone(fixture.save), yard = buildingOf(save, 36);
    save.settlement.naval.sites = [];
    save.settlement.naval.active = [];
    yard.input = { cloth: 4, planks: 10 };
    const first = await runFlaxFast(save, 120);
    const site = first.save.settlement.naval.sites[0]![1];
    const boats = structuredClone(first.save);
    boats.settlement.naval.modes = [[yard.uid, "boats"]];
    const before = { cloth: site.cloth, steps: site.steps,
      inputCloth: buildingOf(boats, 36).input.cloth ?? 0 };
    const second = await runFlaxFast(boats, 120);
    const kept = second.save.settlement.naval.sites[0]![1];
    expect(kept.steps).toBe(before.steps);
    expect(kept.cloth).toBe(before.cloth);
    expect(buildingOf(second.save, 36).input.cloth ?? 0).toBe(before.inputCloth);
    expect(second.save.settlement.naval.fleet.ships).toHaveLength(0);
  });

  it("keeps waiting without a carrier instead of inventing a ship or carrier work", async () => {
    const save = structuredClone(fixture.save), yard = buildingOf(save, 36);
    save.settlement.naval.sites = [];
    save.settlement.naval.active = [];
    save.settlement.actors = save.settlement.actors.filter(actor => actor.job !== "Carrier");
    delete save.settlement.preparedRoadActors;
    delete save.settlement.carrierDetours;
    delete save.settlement.navigationRevisions;
    delete save.settlement.stockTraffic;
    delete save.settlement.storageTraffic;
    save.settlement.settlers = 0;
    for (const building of save.settlement.buildings) {
      if ([0, 29, 39].includes(building.typeId)) building.idleSettlers = 0;
      else delete building.idleSettlers;
    }
    yard.input = { planks: 10 };
    const { save: next } = await runFlaxFast(save, 3600);
    expect(next.settlement.naval.fleet.ships).toHaveLength(0);
    const site = next.settlement.naval.sites[0]![1];
    expect(site.steps).toBeGreaterThan(0);
    expect(site.cloth).toBe(0);
  });

  it("keeps a paused chain from producing or consuming its saved materials", async () => {
    const save = structuredClone(fixture.save), farm = buildingOf(save, 60),
      weaver = buildingOf(save, 61), yard = buildingOf(save, 36);
    farm.productionPaused = true; weaver.productionPaused = true; yard.productionPaused = true;
    yard.input = { cloth: 4, planks: 10 };
    const { metrics, save: next } = await runFlaxFast(save, 600);
    expect(own(metrics.production[0]!.produced, "flax")).toBe(0);
    expect(own(metrics.production[0]!.produced, "cloth")).toBe(0);
    expect(next.settlement.naval.sites).toHaveLength(0);
    expect(next.settlement.naval.fleet.ships).toHaveLength(0);
    expect(buildingOf(next, 36).input).toEqual({ cloth: 4, planks: 10 });
  });

  it("carries continuous, split and native-continuation ownership without a second ship", async () => {
    const save = structuredClone(fixture.save), yard = buildingOf(save, 36);
    save.settlement.naval.sites = [];
    save.settlement.naval.active = [];
    yard.input = { cloth: 4, planks: 10 };
    const continuous = await runFlaxFast(save, 900);
    const first = await runFlaxFast(save, 450);
    const split = await runFlaxFast(first.save, 450);
    expect(split.save.settlement.naval.fleet.ships).toHaveLength(continuous.save.settlement.naval.fleet.ships.length);
    expect(split.save.settlement.naval.fleet.nextShip).toBe(continuous.save.settlement.naval.fleet.nextShip);
    await expect(stageGameSession(split.save)).resolves.toBeDefined();
    const native = await advanceOfflineGame(split.save, split.save.savedAt + 60_000, () => {},
      { exact: true, eventCore: false });
    expect(native.settlement.naval.fleet.ships).toHaveLength(split.save.settlement.naval.fleet.ships.length);
    await expect(stageGameSession(native)).resolves.toBeDefined();
  }, 30_000);
});

describe("fast chain levels and upgrades", () => {
  it("follows the current canonical building unlock gates", () => {
    expect(buildingUnlockLevel(60)).toBe(5);
    expect(buildingUnlockLevel(61)).toBe(6);
    expect(buildingUnlockLevel(36)).toBe(18);
    expect(buildingUnlockLevel(13)).toBe(19);
    expect(buildingUnlockLevel(34)).toBe(21);
    expect(buildingUnlockLevel(4)).toBe(22);
    expect(buildingUnlockLevel(9)).toBe(25);
  });

  it("speeds authored farm and loom work at higher producer levels", () => {
    const base = structuredClone(fixture.save);
    const upgraded = structuredClone(fixture.save);
    const farm = buildingOf(upgraded, 60), weaver = buildingOf(upgraded, 61), yard = buildingOf(upgraded, 36);
    farm.workshopUpgrade = { level: 4 }; weaver.workshopUpgrade = { level: 4 };
    yard.workshopUpgrade = { level: 4 };
    const baseFarm = prepareOfflineEconomyFlax(base, fixture.world, "home");
    const fastFarm = prepareOfflineEconomyFlax(upgraded, fixture.world, "home");
    const sow = (prepared: ReturnType<typeof prepareOfflineEconomyFlax>) =>
      prepared.jobs.find(job => job.uid.endsWith(":sow"))!.cycleTicks;
    expect(sow(fastFarm)).toBeLessThan(sow(baseFarm));
    const baseWeaver = estimateOfflineEconomyRates(base, fixture.world).jobs
      .find(job => job.uid === `building:${weaver.uid}`)!;
    const fastWeaver = estimateOfflineEconomyRates(upgraded, fixture.world).jobs
      .find(job => job.uid === `building:${weaver.uid}`)!;
    expect(fastWeaver.cycleTicks).toBeLessThan(baseWeaver.cycleTicks);
    expect(fastWeaver.outputs).toEqual({ cloth: 1 });
    const shipBase = prepareOfflineEconomyFastShips(base, fixture.world, 3600, "home");
    const shipFast = prepareOfflineEconomyFastShips(upgraded, fixture.world, 3600, "home");
    const visit = (prepared: ReturnType<typeof prepareOfflineEconomyFastShips>) =>
      prepared.jobs.find(job => job.uid.endsWith(":visit:0"))!.cycleTicks;
    expect(visit(shipFast)).toBeLessThan(visit(shipBase));
  });

  it("keeps a detached farm and weaver out of the home economy", () => {
    const save = structuredClone(fixture.save);
    save.settlement.roads = [];
    const rates = estimateOfflineEconomyRates(save, fixture.world);
    const farm = buildingOf(save, 60), weaver = buildingOf(save, 61);
    expect(rates.unsupported.some(row => row.uid === farm.uid)).toBe(true);
    expect(rates.unsupported.some(row => row.uid === weaver.uid)).toBe(true);
    expect(rates.jobs.some(job => job.uid === `building:${farm.uid}`)).toBe(false);
    expect(rates.jobs.some(job => job.uid === `building:${weaver.uid}`)).toBe(false);
  });
});

const metricsBoat = (metrics: { production: { produced: Goods }[] }) =>
  metrics.production.some(island => (island.produced.boat ?? 0) > 0);
