import { describe, expect, it } from "vitest";

import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { resolvedBuildProgram } from "../src/shared/settlement/economy-ai/build-program";
import {
  fillWantedCounts, goalDeficit, goalPayable, goalStaffable, prerequisitesMet
} from "../src/shared/settlement/economy-ai/develop-goals";
import { createGameSave } from "../src/shared/settlement/game-save";
import { ownerOf } from "../src/shared/settlement/settlement-ownership";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";
import {
  createDevelopReferenceIsland, createReferenceSimulation, DEVELOP_REFERENCE_MAPS, type DevelopReferenceSimulation,
  REFERENCE_AI
} from "./helpers/develop-reference-maps";
import { exportEconomySaveFixture } from "./helpers/economy-save-fixtures";

/**
 * Enemy economy AI P3 acceptance (plan §7 P3): on each reference map the `develop` faction reaches a working plank
 * chain (a woodcutter, a sawmill and a forester finished) and two finished residences within `CHAIN_MINUTES` game
 * minutes, never idles for more than `STALL_SECONDS` while its program wants a building its stock pays, and plays
 * the same at any frame rate and across a save and reload in the middle of construction.
 */
const TICKS_PER_SECOND = 20;
const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;
const CHAIN_MINUTES = 45;
const STALL_SECONDS = 120;
const WOODCUTTER = 17;
const FORESTER = 20;
const SAWMILL = 33;
const RESIDENCES = new Set([57, 58, 59]);
const TEST_TIMEOUT = 600_000;

const ownBuildings = (simulation: DevelopReferenceSimulation) =>
  simulation.buildings().filter(building => ownerOf(building) === REFERENCE_AI);

const finishedOf = (buildings: readonly SettlementBuilding[], typeIds: (typeId: number) => boolean) =>
  buildings.filter(building => typeIds(building.typeId) && building.construction >= 1).length;

/** The plank chain works and two residences stand. */
const reachedGoal = (buildings: readonly SettlementBuilding[]) =>
  [WOODCUTTER, SAWMILL, FORESTER].every(typeId => finishedOf(buildings, type => type === typeId) >= 1) &&
  finishedOf(buildings, typeId => RESIDENCES.has(typeId)) >= 2;

/**
 * Idle (the A16 wait the gate forbids): no own site under construction and no placement under way, while a goal of
 * its program has missing buildings, finished prerequisites, a worker's tool and a cost its stock pays.
 */
const idlesWithWork = (simulation: DevelopReferenceSimulation, buildings: readonly SettlementBuilding[]) => {
  if (buildings.some(building => building.construction < 1)) return false;
  if (simulation.factionAiDiagnostics()[0]?.planner?.pending) return false;
  const depot = buildings.find(building => building.typeId === 0)!;
  const program = resolvedBuildProgram("balanced", simulation.buildingNation(depot) as WorkerNation);
  const { counts, finished, stock } = program.view;
  counts.fill(0);
  finished.fill(0);
  program.view.ownBuildings = buildings.length;
  const pool = simulation.storageSnapshot(depot.uid)?.available ?? {};
  program.wares.forEach((ware, index) => { stock[index] = pool[ware] ?? 0; });
  for (const building of buildings) {
    const goal = program.goalOfType[building.typeId] ?? -1;
    if (goal < 0) continue;
    counts[goal]!++;
    finished[goal]!++;
  }
  fillWantedCounts(program);
  return program.goals.some((goal, index) =>
    goalDeficit(program, index) > 0 && prerequisitesMet(program, goal) && goalPayable(program, goal) &&
    goalStaffable(program, goal));
};

/** Plays the island second by second until the goal is reached; the minute it was and the longest idle time. */
const playUntilGoal = (simulation: DevelopReferenceSimulation) => {
  let idleSince = -1, longestIdle = 0;
  while (simulation.gameTick() < CHAIN_MINUTES * TICKS_PER_MINUTE) {
    const next = simulation.gameTick() + TICKS_PER_SECOND;
    while (simulation.gameTick() < next) simulation.update(.05);
    const buildings = ownBuildings(simulation);
    if (reachedGoal(buildings)) return { longestIdle, minutes: simulation.gameTick() / TICKS_PER_MINUTE };
    if (!idlesWithWork(simulation, buildings)) idleSince = -1;
    else if (idleSince < 0) idleSince = simulation.gameTick();
    if (idleSince >= 0) longestIdle = Math.max(longestIdle, (simulation.gameTick() - idleSince) / TICKS_PER_SECOND);
  }
  return { longestIdle, minutes: Infinity };
};

/**
 * The AI town for the High/Minimal review captures, written only with `ECONOMY_SAVE_FIXTURE_OUTPUT`. The map names
 * its headquarters (where the simulation raised it), so the game opens it as a home island.
 */
const exportReviewSave = async (name: string, simulation: DevelopReferenceSimulation, world: WorldData) => {
  if (!process.env.ECONOMY_SAVE_FIXTURE_OUTPUT) return;
  const { rotation, x, z } = simulation.headquarters;
  const scenario = { ...world.scenario!, headquarters: { rotation, x, z } };
  await exportEconomySaveFixture(`p3-${name}`, await createGameSave({ ...world, scenario }, simulation.saveState(),
    { animals: [], name: `P3 ${name}`, savedAt: 0, source: "generated" }));
};

describe("develop AI on the reference maps (P3 functional and no-stall gates)", () => {
  for (const map of DEVELOP_REFERENCE_MAPS) {
    it(`${map.name}: plank chain and two residences within ${CHAIN_MINUTES} minutes, never idle`, async () => {
      const { simulation, world } = createDevelopReferenceIsland(map);
      const result = playUntilGoal(simulation);
      await exportReviewSave(map.name, simulation, world);
      process.stderr.write(`P3 ${map.name}: goal at ${result.minutes.toFixed(1)} min, ` +
        `longest idle ${result.longestIdle} s\n`);
      expect(result.minutes).toBeLessThanOrEqual(CHAIN_MINUTES);
      expect(result.longestIdle).toBeLessThanOrEqual(STALL_SECONDS);
    }, TEST_TIMEOUT);
  }
});

const DETERMINISM_TICKS = 12 * TICKS_PER_MINUTE;
const RELOAD_TICKS = [5 * TICKS_PER_MINUTE + 7, 8 * TICKS_PER_MINUTE + 131];
const stateHash = (simulation: DevelopReferenceSimulation) =>
  hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));

const run = (simulation: DevelopReferenceSimulation, frames: readonly number[], ticks: number) => {
  for (let frame = 0; simulation.gameTick() < ticks; frame++)
    simulation.update(Math.min(frames[frame % frames.length]!, (ticks - simulation.gameTick()) * .05));
};

describe("develop AI determinism on a reference map (P3 gate)", () => {
  const map = DEVELOP_REFERENCE_MAPS[0];

  it("reaches the same full state hash at any frame rate and after a save and reload mid-build", () => {
    const reference = createDevelopReferenceIsland(map).simulation;
    run(reference, [.05], DETERMINISM_TICKS);
    const expected = stateHash(reference);
    expect(ownBuildings(reference).length).toBeGreaterThan(3);
    const mixed = createDevelopReferenceIsland(map).simulation;
    run(mixed, [.016, .05, .033, .1], DETERMINISM_TICKS);
    expect(stateHash(mixed)).toBe(expected);
    for (const at of RELOAD_TICKS) {
      const { simulation: first, world } = createDevelopReferenceIsland(map);
      run(first, [.05], at);
      expect(ownBuildings(first).some(building => building.construction < 1)).toBe(true);
      // A game save carries the world (levelled ground, felled trees) beside the settlement.
      const reloaded = createReferenceSimulation(structuredClone(world)).simulation;
      expect(reloaded.loadState(JSON.parse(JSON.stringify(first.saveState())))).toEqual({ ok: true });
      run(reloaded, [1 / 60], DETERMINISM_TICKS);
      expect(stateHash(reloaded)).toBe(expected);
    }
  }, TEST_TIMEOUT);
});
