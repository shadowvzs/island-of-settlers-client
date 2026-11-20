import { describe, expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { movementResumeProblem } from "../src/shared/settlement/settlement-movement-resume";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld } from "./helpers/hunting-world";
import { AI, hashOf, plotAt, type Simulation } from "./helpers/maintain-island";

/**
 * AI-RELOAD-DRIFT (2026-11-16): road-joined construction sites reloaded mid-game must continue exactly like the
 * uninterrupted island. Each reload tick below once diverged on a movement memory the save left out: a road edit
 * a carrier missed indoors (153), the route repair grant window (398, 1227), a carrier's straight-leg start (1336)
 * and, for the player's sites, a walker's proactive sidestep budget (549).
 */
const WOODCUTTER = 17;
const END_TICK = 2000;
const FRAME_PATTERNS: readonly (readonly number[])[] = [[.05], [1 / 60], [.05, 1 / 60, .1, .03]];
const START_KIT = { settlers: 6, stock: { axe: 2, hammer: 3, logs: 12, planks: 40, pickaxe: 1, saw: 1, stone: 30 } };

interface Owner {
  /** Places a woodcutter site with its plot corner at (x, z) and joins it to the owner's home by road. */
  placeSite: (simulation: Simulation, x: number, z: number) => void;
  /** Site plot corners by the tick they are placed at. */
  sites: ReadonlyMap<number, readonly [number, number]>;
  start: (simulation: Simulation) => void;
}

const computer: Owner = {
  placeSite: (simulation, x, z) => {
    const placed = simulation.placeFactionBuilding(AI, plotAt(WOODCUTTER, x, z));
    expect(placed.ok, placed.reason).toBe(true);
    const depot = simulation.buildings().find(building => building.militaryFaction === AI && building.typeId === 0)!;
    expect(simulation.connectFactionRoads(AI, depot.access, placed.building!.access)).toBeTruthy();
  },
  sites: new Map([[100, [56, 46]], [140, [40, 38]]]),
  start: simulation => {
    const depot = simulation.aiPlace(AI, { typeId: 0, x: 47, z: 46 }, START_KIT);
    expect(depot.ok, depot.reason).toBe(true);
  }
};

const player: Owner = {
  placeSite: (simulation, x, z) => {
    const plot = plotAt(WOODCUTTER, x, z);
    const placed = simulation.placeBuilding(WOODCUTTER, plot.x, plot.z);
    expect(placed.ok, placed.reason).toBe(true);
    const site = simulation.buildings().find(building => building.x === plot.x && building.z === plot.z)!;
    expect(simulation.connectRoads(simulation.headquarters.access, site.access)).toBeTruthy();
  },
  sites: new Map([[100, [19, 10]], [140, [3, 2]]]),
  start: () => undefined
};

const island = (owner: Owner) => {
  const world = huntingWorld();
  world.scenario = economyCampaignScenario([AI]);
  const simulation = createSettlementSimulation({
    canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8, roads: createRoadNetwork(world), world
  });
  owner.start(simulation);
  return { simulation, world };
};

/** Whole ticks at a frame pattern until the island's saved game tick reaches `tick`. */
const runTo = (simulation: Simulation, tick: number, frames: readonly number[]) => {
  for (let frame = 0; simulation.gameTick() < tick; frame++)
    simulation.update(Math.min(frames[frame % frames.length]!, (tick - simulation.gameTick()) * .05));
};

/** The island's state hash at `END_TICK`, saved and loaded into a fresh island at `reloadTick` when given. */
const play = (owner: Owner, frames: readonly number[], reloadTick?: number) => {
  let { simulation, world } = island(owner);
  const stops = [...owner.sites.keys(), ...reloadTick === undefined ? [] : [reloadTick], END_TICK]
    .sort((a, b) => a - b);
  for (const stop of stops) {
    runTo(simulation, stop, frames);
    const site = owner.sites.get(stop);
    if (site) owner.placeSite(simulation, ...site);
    if (stop !== reloadTick) continue;
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    const reloaded = island(owner);
    expect(reloaded.simulation.loadState(saved)).toEqual({ ok: true });
    ({ simulation, world } = reloaded);
  }
  return hashOf(simulation, world);
};

describe("reload of road-joined construction sites (AI-RELOAD-DRIFT)", () => {
  it.each(FRAME_PATTERNS.map(frames => [frames.join(" / "), frames] as const))(
    "a computer economy's sites continue hash-identically at frames %s", (_name, frames) => {
      const reference = play(computer, [.05]);
      expect(play(computer, frames)).toBe(reference);
      for (const reloadTick of [153, 398, 1227, 1336]) expect(play(computer, frames, reloadTick)).toBe(reference);
    }, 120_000);

  it("the player's sites continue hash-identically", () => {
    const reference = play(player, [.05]);
    for (const reloadTick of [398, 549]) expect(play(player, [.05], reloadTick)).toBe(reference);
  }, 120_000);

  it("refuses a malformed movement resume block", () => {
    const actors = new Set([1, 2]);
    const budget = { clock: 2, elapsed: .1, remaining: 2, reserved: [1], serial: 3, waiting: [[2, 2, 1.5]] };
    expect(movementResumeProblem(undefined, actors)).toBeNull();
    expect(movementResumeProblem({ budget, detourWaits: [[1, .5]], roadChecks: [{ actor: 2, stale: true }],
      yieldBudgets: [[1, 2, 4, 0, 3.5]] }, actors)).toBeNull();
    expect(movementResumeProblem({ budget: { ...budget, waiting: [[2, 2]] } }, actors)).not.toBeNull();
    expect(movementResumeProblem({ detourWaits: [[1, 0]] }, actors)).not.toBeNull();
    expect(movementResumeProblem({ roadChecks: [{ actor: 2, stale: false }] }, actors)).not.toBeNull();
    expect(movementResumeProblem({ yieldBudgets: [[3, 0, 0, 0, 1]] }, actors)).not.toBeNull();
    expect(movementResumeProblem([], actors)).not.toBeNull();
  });
});

/** Player reserves called straight out of storage: they march to the field without a road journey (EAI-CLOSE). */
const CALL_OUT_TICK = 20;
const RESERVE_RELOAD_TICK = 40;
const ROAD_EDIT_TICK = 60;
const RESERVE_END_TICK = 400;

const playReserves = (reloadTick?: number) => {
  let { simulation, world } = island(player);
  simulation.receiveTroops([{ hp: 100, rank: 0, type: "shield" }, { hp: 100, rank: 0, type: "archer" }]);
  for (const stop of [CALL_OUT_TICK, RESERVE_RELOAD_TICK, ROAD_EDIT_TICK, RESERVE_END_TICK]) {
    runTo(simulation, stop, [.05]);
    if (stop === CALL_OUT_TICK) expect(simulation.callOutMilitary(["shield", "archer"], { x: 24, z: 24 })).toBe(2);
    if (stop === ROAD_EDIT_TICK)
      expect(simulation.connectRoads(simulation.headquarters.access, { x: 20, z: 4 })).toBeTruthy();
    if (stop !== reloadTick) continue;
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    const reloaded = island(player);
    expect(reloaded.simulation.loadState(saved)).toEqual({ ok: true });
    ({ simulation, world } = reloaded);
  }
  return hashOf(simulation, world);
};

describe("reload of player reserves called out of storage (EAI-CLOSE)", () => {
  it("continues hash-identically after a road edit", () => {
    expect(playReserves(RESERVE_RELOAD_TICK)).toBe(playReserves());
  }, 60_000);
});
