import { describe, expect, it } from "vitest";

import { STORAGE_BASE_CAPACITY } from "../src/shared/balance/economy";
import { DESTROYED_SITE_SALVAGE_SHARE, DESTROYED_STORAGE_LOSS_SHARE } from "../src/shared/balance/military";
import { HEADQUARTERS_TYPE_ID, STOREHOUSE_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { ruinPathSearches } from "../src/shared/settlement/settlement-ruin-dispatch";
import { RUIN_PLACEMENT_REASON, type SettlementRuin } from "../src/shared/settlement/settlement-ruins";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import type { WorldData } from "../src/shared/world/world-data";
import {
  advanceSeconds, createBalanceSettlement, createBalanceSimulation, placeFinished
} from "../tools/bench/garrison-balance-harness";
import { huntingWorld } from "./helpers/hunting-world";

/**
 * BUILDING-DESTRUCTION phase BD2 (docs/plans/plan-review-2026-11-09.md B6-B9; owner gate todo:161 points 1-6):
 * ruins, the clearing job and its no-stall rules.
 */
type Simulation = ReturnType<typeof createBalanceSimulation>;
const SMALL_RESIDENCE = 57;
const BIG_RESIDENCE = 59;
const ENEMY = 1;
const TIMEOUT = 180_000;
/** The walled-off square (cells 22-36): its border cells cannot be walked, its inside is unreachable. */
const WALL = { from: 22, to: 36 };

/** A flat island, its HQ at (12.5, 12.5) with idle settlers; `world` is the live map (tests reshape it). */
const island = (settlers = 8) => {
  let world: WorldData | undefined;
  const { roads, simulation } = createBalanceSettlement(64, 9, { x: 12.5, z: 12.5 }, shaped => { world = shaped; },
    { initialSettlers: settlers });
  return { roads, simulation, world: world! };
};
/** The island with a finished Small residence that has just fallen to a ruin. */
const ruinIsland = (settlers = 8, x = 30, z = 26) => {
  const { simulation, world } = island(settlers);
  const target = placeFinished(simulation, SMALL_RESIDENCE, x, z);
  expect(simulation.destroyBuilding(target.uid)).toBe(true);
  simulation.update(.05);
  return { simulation, target, world };
};
const wallOff = (world: WorldData, wall = WALL) => {
  for (let z = wall.from; z <= wall.to; z++) for (let x = wall.from; x <= wall.to; x++)
    if ([wall.from, wall.to].includes(x) || [wall.from, wall.to].includes(z)) world.walkCost[z * world.cellsX + x] = 0;
};
const ruinOf = (simulation: Simulation, uid: number) => simulation.ruins().find(ruin => ruin.uid === uid);
const poolOf = (simulation: Simulation, ware: string) =>
  simulation.saveState().storagePools.pools[0]?.available[ware] ?? 0;
const people = (simulation: Simulation) => simulation.snapshot().actors.filter(actor => actor.phase !== "retired");
const salvageOf = (typeId: number) => Object.fromEntries(Object.entries(getConstructionCost(typeId, "roman"))
  .map(([ware, count]) => [ware, Math.floor(count * DESTROYED_SITE_SALVAGE_SHARE)]).filter(([, count]) => count));
/** Runs whole seconds, checking `each` after every one. */
const runSeconds = (simulation: Simulation, seconds: number, each: () => void = () => undefined) => {
  for (let second = 0; second < seconds; second++) {
    advanceSeconds(simulation, 1);
    each();
  }
};

/** Ruins of 1-cell plots at the given cells, loaded into the island through its save. */
const loadRuins = (simulation: Simulation, cells: ReadonlyArray<readonly [number, number]>) => {
  const save = simulation.saveState();
  const ruins: SettlementRuin[] = cells.map(([x, z], index) => ({ access: { x: x + .5, z: z + 1.5 }, depth: 1,
    owner: 0, rotation: 0, salvage: { planks: 1 }, typeId: SMALL_RESIDENCE, uid: save.nextBuilding + index, width: 1,
    x: x + .5, z: z + .5 }));
  const loaded = simulation.loadState({ ...save, nextBuilding: save.nextBuilding + cells.length, ruins });
  expect(loaded).toEqual({ ok: true });
};
/** `count` cells in rows of `columns`, `step` cells apart in a row and `rowStep` between rows. */
const grid = (count: number, left: number, top: number, columns: number, step: number, rowStep: number) =>
  Array.from({ length: count }, (_, index) =>
    [left + index % columns * step, top + Math.floor(index / columns) * rowStep] as const);

describe("ruins (plan review B6, B8e, B8h)", () => {
  it("replace a fallen building, keep the salvage share of its construction cost and block the plot", () => {
    const { simulation, target } = ruinIsland(0);
    expect(simulation.buildings().some(building => building.uid === target.uid)).toBe(false);
    expect(ruinOf(simulation, target.uid)).toMatchObject({ owner: 0, salvage: salvageOf(SMALL_RESIDENCE),
      typeId: SMALL_RESIDENCE, x: target.x, z: target.z });
    expect(simulation.placeBuilding(SMALL_RESIDENCE, target.x, target.z)).toMatchObject({
      ok: false, reason: RUIN_PLACEMENT_REASON });
  });

  it("are cleared by an idle settler who carries the salvage into storage; the plot is free again", () => {
    const { simulation, target } = ruinIsland();
    const salvage = salvageOf(SMALL_RESIDENCE), before = poolOf(simulation, "planks"), searches = ruinPathSearches();
    runSeconds(simulation, 60);
    expect(simulation.ruins()).toEqual([]);
    expect(ruinPathSearches() - searches).toBe(1);
    runSeconds(simulation, 60);
    expect(poolOf(simulation, "planks") - before).toBe(salvage.planks);
    expect(people(simulation)).toEqual([]);
    expect(simulation.placeBuilding(SMALL_RESIDENCE, target.x, target.z)).toMatchObject({ ok: true });
  }, TIMEOUT);

  it("save and load with the ruin and its clearer at work, and resume identically", () => {
    const { simulation } = ruinIsland();
    runSeconds(simulation, 12);
    const saved = JSON.stringify(simulation.saveState());
    expect(JSON.parse(saved).ruins[0].clearer).toBeDefined();
    const resume = () => {
      expect(simulation.loadState(JSON.parse(saved))).toEqual({ ok: true });
      runSeconds(simulation, 20);
      return JSON.stringify(simulation.saveState());
    };
    expect(resume()).toBe(resume());
  }, TIMEOUT);
});

describe("the no-stall gate (owner todo:161 points 1-6, plan review B8a-c)", () => {
  it("recruits nobody and searches nothing without an idle settler, and clears once one is born", () => {
    const { simulation } = ruinIsland(0);
    const searches = ruinPathSearches();
    runSeconds(simulation, 55);
    expect(simulation.saveState().settlerBirths).toBe(0);
    expect(ruinPathSearches()).toBe(searches);
    expect(people(simulation)).toEqual([]);
    runSeconds(simulation, 60);
    expect(ruinPathSearches() - searches).toBe(1);
    expect(simulation.ruins()).toEqual([]);
  }, TIMEOUT);

  it("recruits nobody while the storage has no room for the salvage", () => {
    const { simulation } = ruinIsland();
    const save = simulation.saveState();
    save.storagePools.pools[0]!.available.planks = STORAGE_BASE_CAPACITY[HEADQUARTERS_TYPE_ID]!;
    expect(simulation.loadState(save)).toEqual({ ok: true });
    const searches = ruinPathSearches();
    runSeconds(simulation, 60);
    expect(ruinPathSearches()).toBe(searches);
    expect(people(simulation)).toEqual([]);
  }, TIMEOUT);

  it("sends nobody while raiders the player sees stand near the ruin", () => {
    const { simulation, target } = ruinIsland(8, 22, 18);
    const raiders = Array.from({ length: 4 }, (_, index) => simulation.spawnMilitaryOpponent(
      { x: target.x - 1.5 + index, z: target.z + 3.5 }, "heavy", 2, ENEMY));
    expect(raiders.every(id => id !== null)).toBe(true);
    const searches = ruinPathSearches();
    runSeconds(simulation, 300, () => expect(ruinOf(simulation, target.uid)?.clearer).toBeUndefined());
    expect(ruinPathSearches()).toBe(searches);
  }, TIMEOUT);

  it("backs an unreachable ruin off in saved game ticks, doubling up to the cap, recruiting nobody", () => {
    const { simulation, target, world } = ruinIsland(8, 29, 29);
    wallOff(world);
    const searches = ruinPathSearches(), failures: number[] = [];
    runSeconds(simulation, 300, () => {
      const ruin = ruinOf(simulation, target.uid)!;
      if (ruin.failures !== failures.at(-1)) failures.push(ruin.failures!);
    });
    // Retries after 2, 4, 8, 16, 32, 64, 64, 64 s: nine searches in five minutes.
    expect(failures).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ruinPathSearches() - searches).toBe(9);
    expect(people(simulation)).toEqual([]);
  }, TIMEOUT);

  it("retries at once after a building change (coalesced to one search) and keeps the retry tick over a load", () => {
    const { simulation, target, world } = ruinIsland(8, 29, 29);
    wallOff(world);
    runSeconds(simulation, 40);
    const waiting = ruinOf(simulation, target.uid)!;
    const saved = JSON.stringify(simulation.saveState());
    expect(simulation.loadState(JSON.parse(saved))).toEqual({ ok: true });
    expect(ruinOf(simulation, target.uid)).toEqual(waiting);
    const searches = ruinPathSearches();
    for (let change = 0; change < 6; change++) {
      const placed = simulation.placeBuilding(SMALL_RESIDENCE, 8 + change % 2 * 10, 30 - change % 2 * 6);
      expect(placed.ok).toBe(true);
      simulation.update(.05);
      expect(simulation.demolishBuilding(placed.building!.uid)).toMatchObject({ ok: true });
    }
    runSeconds(simulation, 2);
    expect(ruinPathSearches() - searches).toBe(1);
    expect(ruinOf(simulation, target.uid)!.failures).toBe(waiting.failures! + 1);
  }, TIMEOUT);

  it("bounds the searches of fifty unreachable ruins by ruins x (1 + resets per second) and the run budget", () => {
    const { simulation, world } = island();
    wallOff(world);
    loadRuins(simulation, grid(50, 24, 24, 10, 1, 2));
    const quiet = ruinPathSearches();
    runSeconds(simulation, 300);
    // No navigation change: each ruin retries on its doubling backoff only.
    const quietSearches = ruinPathSearches() - quiet;
    expect(quietSearches).toBeLessThanOrEqual(50 * 9);
    const battle = ruinPathSearches();
    runSeconds(simulation, 20, () => {
      const placed = simulation.placeBuilding(SMALL_RESIDENCE, 8, 30);
      expect(placed.ok).toBe(true);
      simulation.update(.05);
      simulation.demolishBuilding(placed.building!.uid);
    });
    // Resets coalesce to once a second per ruin, and the dispatch spends one search per half-second run at most.
    const battleSearches = ruinPathSearches() - battle;
    expect(battleSearches).toBeGreaterThan(20);
    expect(battleSearches).toBeLessThanOrEqual(Math.min(50 * (1 + 20), 2 * 20 + 1));
    expect(people(simulation)).toEqual([]);
  }, TIMEOUT);

  it("clears fifty reachable ruins at most three at a time without slowing deliveries", () => {
    /** The second a Big residence site has all its materials (13 units), with and without the ruins. */
    const delivered = (ruins: boolean) => {
      const { roads, simulation } = island(20);
      if (ruins) loadRuins(simulation, grid(50, 34, 4, 10, 2, 3));
      const site = simulation.placeBuilding(BIG_RESIDENCE, 20, 24);
      expect(site.ok).toBe(true);
      expect(roads.addRoad(simulation.headquarters.access, site.building!.access)).toBeTruthy();
      const required = Object.values(site.building!.required ?? {}).reduce((sum, count) => sum + count, 0);
      let clearers = 0, done = Infinity, second = 0;
      runSeconds(simulation, 150, () => {
        second++;
        clearers = Math.max(clearers, simulation.ruins().filter(ruin => ruin.clearer !== undefined).length);
        const building = simulation.buildings().find(entry => entry.uid === site.building!.uid);
        const units = [...Object.values(building?.input ?? {}), ...Object.values(building?.constructionConsumed ?? {})]
          .reduce((sum, count) => sum + count, 0);
        if (units >= required) done = Math.min(done, second);
      });
      return { clearers, done, ruins: simulation.ruins().length };
    };
    const base = delivered(false), busy = delivered(true);
    expect(base.done).toBeLessThan(150);
    expect(busy.clearers).toBe(3);
    expect(busy.ruins).toBeLessThan(50);
    // Unchanged throughput: every unit arrives no later than without the ruins (5 % for the interleaving).
    expect(busy.done).toBeLessThanOrEqual(Math.ceil(base.done * 1.05));
  }, TIMEOUT);
});

describe("destroyed storage (plan review B8f)", () => {
  it("loses half its capacity share of every free ware of the pool, rounded down", () => {
    const { simulation } = island();
    const store = placeFinished(simulation, STOREHOUSE_TYPE_ID, 24, 24);
    simulation.update(.05);
    const before = { planks: poolOf(simulation, "planks"), stone: poolOf(simulation, "stone") };
    const own = STORAGE_BASE_CAPACITY[STOREHOUSE_TYPE_ID]!;
    const total = own + STORAGE_BASE_CAPACITY[HEADQUARTERS_TYPE_ID]!;
    expect(simulation.destroyBuilding(store.uid)).toBe(true);
    simulation.update(.05);
    for (const ware of ["planks", "stone"] as const)
      expect(before[ware] - poolOf(simulation, ware)).toBe(
        Math.floor(before[ware] * own * DESTROYED_STORAGE_LOSS_SHARE / total));
  });
});

describe("quiet skip (plan review B8g)", () => {
  /** A paused island (HQ at the population cap, no roads) whose only other plot is an unreachable ruin. */
  const quietRuinIsland = () => {
    const world = huntingWorld();
    const roads = createRoadNetwork(world, { isBlocked: () => false });
    const simulation = createSettlementSimulation({ initialSettlers: 100, roads, world });
    const placed = simulation.placeBuilding(SMALL_RESIDENCE, 28, 24);
    expect(placed.ok).toBe(true);
    Object.assign(placed.building!, { construction: 1, foundationProgress: 1, incoming: {}, input: {}, output: {},
      required: {} });
    wallOff(world, { from: 20, to: 32 });
    expect(simulation.destroyBuilding(placed.building!.uid)).toBe(true);
    for (let tick = 0; tick < 40; tick++) simulation.update(.05);
    return { simulation, world };
  };

  it("keeps skipping with an unreachable ruin and ends on the exact ticks' state, retries included", () => {
    const { simulation, world } = quietRuinIsland();
    expect(simulation.ruins()[0]?.failures).toBe(1);
    expect(simulation.quietSkipStatus()).toEqual({ quiet: true });
    const start = JSON.stringify(simulation.saveState()), ticks = 20 * 200;
    for (let tick = 0; tick < ticks; tick++) simulation.update(.05);
    const exact = simulation.saveState();
    expect(simulation.loadState(JSON.parse(start))).toEqual({ ok: true });
    expect(simulation.advanceQuietTicks(ticks)).toBe(ticks);
    const quiet = simulation.saveState();
    expect(quiet.ruins![0]!.failures).toBeGreaterThan(5);
    expect(quiet.ruins).toEqual(exact.ruins);
    expect(hashSettlementState({ settlement: quiet, world })).toBe(hashSettlementState({ settlement: exact, world }));
  }, TIMEOUT);
});
