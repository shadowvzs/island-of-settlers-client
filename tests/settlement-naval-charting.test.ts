import { describe, expect, it } from "vitest";

import { LEGACY_SIM_RULES, type SimRules } from "../../island-of-settlers-shared/src/game-settings/sim-rules";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {
  type ExplorationMode, validChartedSitesSave
} from "../src/shared/settlement/settlement-charted-sites";
import { landmassAt, landmassCount } from "../src/shared/settlement/settlement-landmass-index";
import { createNavalCharting } from "../src/shared/settlement/settlement-naval-charting";
import type { NavalExpedition } from "../src/shared/settlement/settlement-naval-fleet";
import type {
  SettlementBuilding, SettlementContext
} from "../src/shared/settlement/settlement-types";
import { markFogChanged } from "../src/shared/world/fog-revision";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { BLOCKING, BUILD, FOG, type WorldData } from "../src/shared/world/world-data";

type Island = { x: number; z: number; width: number; height: number };
const ONE: Island[] = [{ height: 20, width: 20, x: 10, z: 10 }];
const TWO: Island[] = [{ height: 20, width: 20, x: 10, z: 10 }, { height: 20, width: 20, x: 55, z: 10 }];
const NINE: Island[] = Array.from({ length: 9 }, (_, index) => ({
  height: 20, width: 20, x: 10 + (index % 3) * 45, z: 10 + Math.floor(index / 3) * 45
}));

const createWorld = (islands: readonly Island[], size = 160) => {
  const heights = new Float32Array((size + 1) * (size + 1)).fill(-2);
  const blocking = new Uint8Array(size * size).fill(BLOCKING.water);
  const walkCost = new Uint8Array(size * size);
  const buildClass = new Uint8Array(size * size);
  for (const island of islands)
    for (let z = island.z; z < island.z + island.height; z++)
      for (let x = island.x; x < island.x + island.width; x++) {
        const cell = z * size + x;
        blocking[cell] = BLOCKING.free;
        walkCost[cell] = 10;
        buildClass[cell] = BUILD.large;
        heights[z * (size + 1) + x] = .5;
      }
  return {
    blocking, buildClass, cellsX: size, cellsZ: size, fog: new Uint8Array(size * size), fogRevision: 0,
    heights, props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() },
    seaLevel: -1, seed: 1, start: { x: 12.5, z: 12.5 }, terraceCount: 0, walkCost
  } as unknown as WorldData;
};

const seaFor = (world: WorldData) => Uint8Array.from(world.blocking, value => value === BLOCKING.water ? 1 : 0);
const building = (uid: number, typeId: number, x: number, z: number,
  patch: Partial<SettlementBuilding> = {}): SettlementBuilding => ({
  access: { x, z }, construction: 1, depth: 6, door: 0, doorThreshold: { x, z }, hasDoor: true, height: 1,
  input: {}, inventory: {}, militaryFaction: 0, output: {}, required: {}, rotation: 0, selected: false,
  status: "", typeId, uid, width: 6, workerApproach: { x, z }, working: false, x, y: 0, z, ...patch
} as unknown as SettlementBuilding);

interface FixtureState {
  active: boolean;
  claimed: boolean;
  idleShips: { phase: string; reservedFor?: number; visitor?: boolean; x: number; z: number }[];
  mode: ExplorationMode;
  pending: number;
  routeFromSource: boolean;
  settlers: number;
  shipReachable: boolean;
  spyglasses: number;
  validRotations: number[];
}

const fixture = (islands: readonly Island[] = TWO) => {
  const world = createWorld(islands);
  const context = {
    buildings: [building(1, 0, 20, 20), building(2, 39, 14, 14)],
    occupied: new Uint8Array(world.cellsX * world.cellsZ),
    options: { roads: { revision: 0 }, world }
  } as unknown as SettlementContext;
  const state: FixtureState = {
    active: false, claimed: false, idleShips: [{ phase: "idle", x: 5, z: 3 }], mode: "fog", pending: 0,
    routeFromSource: true, settlers: 1, shipReachable: true, spyglasses: 1, validRotations: [0, 1, 2, 3]
  };
  let siteCalls = 0;
  const site = (point: { x: number; z: number; rotation: number }) => {
    siteCalls++;
    if (!state.validRotations.includes(point.rotation)) return null;
    const definition = getBuildingDefinition(39);
    const width = point.rotation % 2 ? definition.gridFootprint[1] : definition.gridFootprint[0];
    const depth = point.rotation % 2 ? definition.gridFootprint[0] : definition.gridFootprint[1];
    const left = point.x - width / 2, top = point.z - depth / 2;
    for (let z = top; z < top + depth; z++)
      for (let x = left; x < left + width; x++) {
        if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return null;
        const cell = z * world.cellsX + x;
        if (world.blocking[cell] === BLOCKING.water || context.occupied[cell]) return null;
      }
    return { ...point, water: { x: point.x, z: point.z - 7 } } as NavalExpedition;
  };
  const charting = createNavalCharting(context, seaFor(world), {
    active: () => state.active,
    claimed: () => state.claimed,
    idleShips: () => state.idleShips,
    mode: state.mode,
    pendingOrders: () => state.pending,
    route: (from, to) => {
      if (!state.routeFromSource) return null;
      if (!state.shipReachable && Math.abs(from.x - 5) < .1 && Math.abs(from.z - 3) < .1) return null;
      return [to];
    },
    scoutSupply: () => ({ settlers: state.settlers, spyglasses: state.spyglasses }),
    site,
    sourceWater: () => ({ x: 5, z: 5 })
  });
  const revealAll = () => {
    world.fog!.fill(FOG.visible);
    markFogChanged(world, true);
  };
  return { charting, context, revealAll, siteCalls: () => siteCalls, state, world };
};

const statusFor = (charting: ReturnType<typeof createNavalCharting>, sourceUid = 2) =>
  charting.statuses(sourceUid);

describe("persistent charted harbour sites", () => {
  it("counts one, two and nine landmasses and hides scouting on a single landmass", () => {
    expect(landmassCount(createWorld(ONE))).toBe(1);
    expect(landmassCount(createWorld(TWO))).toBe(2);
    expect(landmassCount(createWorld(NINE))).toBe(9);
    expect(fixture(ONE).charting.availability(2)).toMatchObject({ hidden: true, reason: "landmasses" });
    expect(fixture(TWO).charting.availability(2)).toMatchObject({ hidden: false, ready: true });
    expect(fixture(NINE).charting.availability(2)).toMatchObject({ hidden: false, ready: true });
    const bypass = fixture(TWO);
    bypass.charting.restore({ mode: "revealed", sites: [] });
    expect(bypass.charting.sites()).toEqual([]);
    expect(bypass.charting.knownTargets(2).length).toBeGreaterThan(0);
    expect(bypass.charting.availability(2)).toMatchObject({ hidden: true, reason: "noFog" });
    const noHome = fixture(TWO);
    noHome.context.buildings = noHome.context.buildings.filter(building => building.typeId !== 0);
    expect(noHome.charting.availability(2)).toMatchObject({ hidden: true, reason: "notHomeMap" });
    expect(fixture(TWO).charting.availability(999)).toMatchObject({ hidden: true, reason: "harbour" });
  });

  it("requires one reachable idle ship, one settler and one spyglass without sharing the ship", () => {
    const { charting, state } = fixture();
    state.settlers = 0;
    expect(charting.availability(2)).toMatchObject({ hidden: false, ready: false, reason: "scout" });
    state.settlers = 1; state.spyglasses = 0;
    expect(charting.availability(2)).toMatchObject({ hidden: false, ready: false, reason: "spyglass" });
    state.spyglasses = 1; state.idleShips = [];
    expect(charting.availability(2)).toMatchObject({ hidden: false, ready: false, reason: "ship" });
    state.idleShips = [{ phase: "idle", reservedFor: 3, x: 5, z: 3 }];
    expect(charting.availability(2)).toMatchObject({ hidden: false, ready: false, reason: "ship" });
    state.idleShips = [{ phase: "idle", x: 5, z: 3 }];
    state.shipReachable = false;
    expect(charting.availability(2)).toMatchObject({ hidden: false, ready: false, reason: "ship" });
    state.shipReachable = true; state.pending = 1;
    expect(charting.availability(2)).toMatchObject({ hidden: false, ready: false, reason: "ship" });
    state.pending = 0;
    expect(charting.availability(2)).toMatchObject({ hidden: false, ready: true });
    state.active = true;
    expect(charting.availability(2)).toMatchObject({ hidden: false, ready: false, reason: "active" });
  });

  it("derives knowledge only from real fog or scout observation and keeps presentation fog out", () => {
    const { charting, revealAll, world } = fixture();
    world.fogDisplayDisabled = true;
    expect(charting.sites()).toEqual([]);
    expect(charting.availability(2)).toMatchObject({ ready: true });
    expect(charting.sites()).toEqual([]);
    world.fogDisplayDisabled = false;
    charting.refreshSight();
    expect(charting.sites()).toEqual([]);
    revealAll();
    charting.refreshSight();
    expect(charting.sites().length).toBeGreaterThan(0);
    expect(charting.availability(2)).toMatchObject({ hidden: true, reason: "noSites" });
    // The presentation flag never changes the authoritative fog bytes or records.
    world.fogDisplayDisabled = true;
    expect(charting.sites().length).toBeGreaterThan(0);
    charting.restore({ ...charting.saveState(), mode: "revealed" });
    expect(charting.availability(2)).toMatchObject({ hidden: true, reason: "noFog" });
    expect(charting.knownTargets(2).length).toBeGreaterThan(0);
  });

  it("offers every valid rotation once and deduplicates the same location", () => {
    const { charting, revealAll, state, world } = fixture();
    revealAll();
    charting.refreshSight();
    const all = charting.sites();
    expect(new Set(all.map(site => `${site.x}:${site.z}`)).size).toBe(all.length);
    const four = all.find(site => site.rotations.length === 4);
    expect(four).toMatchObject({ rotation: 0, rotations: [0, 1, 2, 3] });
    state.validRotations = [2];
    charting.restore(undefined);
    charting.refreshSight();
    const onlyTwo = charting.sites().find(site => landmassAt(world, site) >= 0 && site.rotations.length === 1);
    expect(onlyTwo).toMatchObject({ rotation: 2, rotations: [2] });
  });

  it("does not rebuild harbour candidates when only buildings, roads or ground leveling change", () => {
    const { charting, context, revealAll, siteCalls, world } = fixture();
    revealAll();
    charting.refreshSight();
    const settled = siteCalls();
    expect(settled).toBeGreaterThan(0);
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    context.navigationRevision = (context.navigationRevision ?? 0) + 1;
    (context.options.roads as { revision: number }).revision =
      (context.options.roads.revision ?? 0) + 1;
    world.terrainRevision = (world.terrainRevision ?? 0) + 1;
    charting.refreshSight();
    expect(siteCalls()).toBe(settled);
  });

  it("keeps candidate proofs on an in-place reload but clears them for a fresh load", () => {
    const { charting, revealAll, siteCalls } = fixture();
    revealAll();
    charting.refreshSight();
    const settled = siteCalls();
    expect(settled).toBeGreaterThan(0);
    charting.restore(charting.saveState(), true);
    charting.refreshSight();
    expect(siteCalls()).toBe(settled);
    charting.restore(charting.saveState());
    charting.refreshSight();
    expect(siteCalls()).toBeGreaterThan(settled);
  });

  it("offers one discovered settlement target per island and keeps it across a reload", () => {
    const { charting, revealAll, world } = fixture(TWO);
    revealAll();
    charting.refreshSight();
    const known = charting.knownTargets(2);
    expect(known.length).toBeGreaterThan(1);
    const targets = charting.settlementTargets(2);
    expect(targets).toHaveLength(1);
    expect(landmassAt(world, targets[0]!)).toBe(landmassAt(world, known[0]!));
    charting.restore(charting.saveState());
    expect(charting.settlementTargets(2)).toHaveLength(1);
  });

  it("discovers every unowned landmass across repeated bounded expeditions", () => {
    const { charting, world } = fixture(NINE);
    const chart = (points: { x: number; z: number }[]) => {
      for (const point of points) {
        for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++)
          if (Math.hypot(x + .5 - point.x, z + .5 - point.z) <= 26)
            world.fog![z * world.cellsX + x] = FOG.discovered;
        markFogChanged(world, true);
        charting.chartObserved(point.x, point.z, 26);
      }
    };
    const home = new Set(charting.sites().map(site => landmassAt(world, site)).filter(id => id >= 0));
    expect(home.size).toBe(0);
    let expeditions = 0;
    for (; expeditions < 8; expeditions++) {
      const points = charting.unknownObservationPoints(2);
      if (!points.length) break;
      chart(points);
    }
    expect(expeditions).toBeGreaterThan(0);
    expect(expeditions).toBeLessThanOrEqual(6);
    expect(charting.unknownObservationPoints(2)).toEqual([]);
    const charted = new Set(charting.sites().map(site => landmassAt(world, site)).filter(id => id >= 0));
    const unowned = Array.from({ length: landmassCount(world) }, (_, id) => id).filter(id => id !== 0);
    expect([...charted].sort()).toEqual(unowned);
  });

  it("keeps a charted site through ownership and territory changes and revalidates its use", () => {
    const { charting, context, revealAll, state, world } = fixture();
    revealAll();
    charting.refreshSight();
    const available = charting.statuses(2).find(entry => entry.available)!;
    expect(available.target).toBeDefined();
    const site = available.site;
    // Another player's presence elsewhere on the island does not exclude this site.
    context.buildings.push(building(90, 39, 70, 120, { militaryFaction: 1 }));
    expect(statusFor(charting).find(entry => entry.site.x === site.x)?.available).toBe(true);
    context.buildings.splice(-1, 1);
    // Current-player ownership of the landmass invalidates use, not knowledge.
    context.buildings.push(building(91, 17, site.x, site.z));
    expect(statusFor(charting).find(entry => entry.site.x === site.x)).toMatchObject({ available: false, reason: "owned" });
    context.buildings.splice(-1, 1);
    expect(statusFor(charting).find(entry => entry.site.x === site.x)?.available).toBe(true);
    // Foreign territory covering the site.
    context.buildings.push(building(92, 9, site.x, site.z, { militaryFaction: 1 }));
    expect(statusFor(charting).find(entry => entry.site.x === site.x)).toMatchObject({ available: false, reason: "foreign" });
    context.buildings.splice(-1, 1);
    // Occupancy without a current-player building still blocks the footprint.
    const cell = Math.floor(site.z) * world.cellsX + Math.floor(site.x);
    context.occupied[cell] = 1;
    expect(statusFor(charting).find(entry => entry.site.x === site.x)).toMatchObject({ available: false, reason: "occupied" });
    context.occupied[cell] = 0;
    state.routeFromSource = false;
    expect(statusFor(charting).find(entry => entry.site.x === site.x)).toMatchObject({ available: false, reason: "unreachable" });
    state.routeFromSource = true;
    state.claimed = true;
    expect(statusFor(charting).find(entry => entry.site.x === site.x)).toMatchObject({ available: false, reason: "claimed" });
    state.claimed = false;
    // Records survive save/reload; availability is revalidated from the live world.
    charting.restore(charting.saveState());
    expect(statusFor(charting).find(entry => entry.site.x === site.x)?.available).toBe(true);
  });

  it("keeps remembered knowledge but invalidates a stale geometry proof after terrain changes", () => {
    const { charting, revealAll, world } = fixture();
    revealAll();
    charting.refreshSight();
    const entry = charting.statuses(2).find(candidate => candidate.available)!;
    const record = entry.site;
    const footprintCell = Math.floor(record.z) * world.cellsX + Math.floor(record.x);
    world.terrainRevision = 1;
    world.fog![footprintCell] = FOG.hidden;
    markFogChanged(world, true);
    expect(charting.statuses(2).find(candidate => candidate.site.x === record.x))
      .toMatchObject({ available: false, reason: "unobserved" });
    world.fog![footprintCell] = FOG.visible;
    markFogChanged(world, true);
    charting.refreshSight();
    expect(charting.statuses(2).find(candidate => candidate.site.x === record.x)?.available).toBe(true);
    expect(charting.sites().find(candidate => candidate.x === record.x)?.geometryRevision).toBe(1);
  });

  it("validates the saved charted-site shape and map identity", () => {
    const { charting, revealAll, world } = fixture();
    revealAll();
    charting.refreshSight();
    const saved = charting.saveState();
    expect(validChartedSitesSave(saved, world)).toBeNull();
    const site = saved.sites[0]!;
    expect(validChartedSitesSave({ ...saved, mode: "legacy" }, world)).toBe("Invalid charted site records");
    expect(validChartedSitesSave({ ...saved, sites: [{ ...site, map: { ...site.map, seed: 2 } }] }, world))
      .toBe("Invalid charted site records");
    expect(validChartedSitesSave({ ...saved, sites: [{ ...site, rotations: [4] }] }, world))
      .toBe("Invalid charted site records");
    expect(validChartedSitesSave({ ...saved, sites: [site, site] }, world)).toBe("Duplicate charted site records");
    expect(validChartedSitesSave(undefined, world)).toBeNull();
  });

  it("GS4a: the rules decide the mode; fog off offers one target per free island, exploring hides or disables", () => {
    const { charting, context, state } = fixture(NINE);
    const rules = (change: Partial<SimRules>) => { context.gameRules = { ...LEGACY_SIM_RULES, ...change, revision: "r" }; };
    rules({ fogOfWar: false });
    expect(charting.mode()).toBe("revealed");
    expect(charting.saveState().mode).toBe(state.mode);
    expect(charting.availability(2)).toMatchObject({ hidden: true, reason: "noFog" });
    const targets = charting.settlementTargets(2);
    const islands = targets.map(target => landmassAt(context.options.world, target));
    expect(new Set(islands).size).toBe(targets.length);
    expect(targets.length).toBe(8);
    expect(charting.sites()).toEqual([]);
    rules({ explorationExpeditions: false });
    expect(charting.mode()).toBe("fog");
    expect(charting.settlementTargets(2)).toEqual([]);
    expect(charting.availability(2)).toMatchObject({ hidden: true, reason: "featureOff" });
    rules({});
    context.options.world.scenario = { ...createMapScenario(), rules: { features: { explorationExpeditions: "off" } } };
    expect(charting.availability(2)).toMatchObject({ hidden: false, ready: false, reason: "featureOff" });
  });
});
