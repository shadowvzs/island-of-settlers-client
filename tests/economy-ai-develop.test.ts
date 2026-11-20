import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import type { FactionAiMode } from "../src/shared/world/scenario-faction-ai";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld, plantForestEdge } from "./helpers/hunting-world";

/** EAI3a: the develop strategy's goals, placed by the EAI3b build planner. */
const AI = 2;
const WOODCUTTER = 17;
const FORESTER = 20;
const SAWMILL = 33;
const DEPOT = { typeId: 0, x: 47, z: 46 };
/** A forester's worker needs a shovel: without one the program skips the forester (EAI3-accept tool rule). */
const START_KIT = {
  settlers: 6, stock: { axe: 2, hammer: 3, logs: 12, planks: 40, pickaxe: 1, saw: 1, shovel: 1, stone: 30 }
};
const STRATEGIC_PERIOD = 200;

/** The plot centre of `typeId` with its left/top corner at (x, z). */
const plotAt = (typeId: number, x: number, z: number) => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  return { typeId, x: x + width / 2, z: z + depth / 2 };
};

/**
 * Ground that carries a foundation: the player's headquarters plot round its start (10, 10) and the depot's plot,
 * each with a ring too narrow for any other plot.
 */
const BUILDABLE = [{ bottom: 14, left: 6, right: 14, top: 6 }, { bottom: 49, left: 43, right: 50, top: 42 }];

/** Only the depot (and the player's start) can carry a foundation: the planner finds no plot for the faction. */
const depotOnlyGround = (world: WorldData) => {
  world.buildCap.fill(BUILD.none);
  for (const { bottom, left, right, top } of BUILDABLE)
    for (let z = top; z <= bottom; z++) for (let x = left; x <= right; x++)
      world.buildCap[z * world.cellsX + x] = BUILD.large;
};

const island = (mode: FactionAiMode = "develop", shape?: (world: WorldData) => void) => {
  const world = huntingWorld();
  plantForestEdge(world);
  shape?.(world);
  world.scenario = economyCampaignScenario([AI], mode, "colony");
  // Roads route round buildings, as on a live island (`island-settlement.ts`).
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
    roads, world });
  const depot = simulation.aiPlace(AI, DEPOT, START_KIT);
  expect(depot.ok, depot.reason).toBe(true);
  return simulation;
};

type Simulation = ReturnType<typeof island>;

const developOf = (simulation: Simulation) => simulation.saveState().factionAi?.[0]?.develop;
const stateHash = (simulation: Simulation) => hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));
/** The faction's buildings after its depot, in placement (uid) order. */
const placedTypes = (simulation: Simulation) => simulation.buildings()
  .filter(building => building.militaryFaction === AI && building.typeId !== DEPOT.typeId)
  .sort((first, second) => first.uid - second.uid).map(building => building.typeId);

/** What the AI decided: its sites, the roads and its saved state. */
const decisionsOf = (simulation: Simulation) => {
  const { factionAi, roads } = simulation.saveState();
  const sites = simulation.buildings().filter(building => building.militaryFaction === AI)
    .map(({ rotation, typeId, uid, x, z }) => ({ rotation, typeId, uid, x, z }));
  return { factionAi, roads, sites };
};

const run = (simulation: Simulation, frames: readonly number[], ticks: number) => {
  for (let frame = 0; simulation.gameTick() < ticks; frame++)
    simulation.update(Math.min(frames[frame % frames.length]!, (ticks - simulation.gameTick()) * .05));
};

describe("develop: base producers on a colony (EAI2a finding)", () => {
  it("lets a computer economy place a woodcutter on a colony map, never the player", () => {
    const simulation = island("maintain");
    expect(simulation.placeFactionBuilding(AI, plotAt(WOODCUTTER, 55, 46)).ok).toBe(true);
    expect(simulation.placeBuilding(WOODCUTTER, 16, 10).ok).toBe(false);
    expect(simulation.offersBuilding(WOODCUTTER)).toBe(false);
  });
});

describe("develop: strategic goal scoring (EAI3a) placed by the planner (EAI3b)", () => {
  it("commits to the woodcutters at its first strategic decision; maintain keeps no goal", () => {
    const developing = island();
    run(developing, [.05], STRATEGIC_PERIOD + 1);
    expect(developOf(developing)?.goal).toEqual({ id: "woodcutter", target: 2 });
    const maintaining = island("maintain");
    run(maintaining, [.05], STRATEGIC_PERIOD + 1);
    expect(developOf(maintaining)).toBeUndefined();
  });

  it("builds in program order: woodcutters, then the sawmill once one stands, then the forester", () => {
    const simulation = island();
    run(simulation, [.05], 6000);
    expect(placedTypes(simulation).slice(0, 4)).toEqual([WOODCUTTER, WOODCUTTER, SAWMILL, FORESTER]);
    expect(placedTypes(simulation).filter(type => type === WOODCUTTER)).toHaveLength(2);
  });

  it("backs a goal off when the planner finds no plot, then retries it", () => {
    const simulation = island("develop", depotOnlyGround);
    run(simulation, [.05], STRATEGIC_PERIOD + 50);
    expect(developOf(simulation)).toMatchObject({ backoffs: [{ attempts: 1, goal: "woodcutter" }] });
    run(simulation, [.05], 3 * STRATEGIC_PERIOD + 50);
    expect(developOf(simulation)?.backoffs?.[0]).toMatchObject({ attempts: 2, goal: "woodcutter" });
    expect(placedTypes(simulation)).toEqual([]);
  });

  it("decides the same at any frame rate", () => {
    const reference = island();
    run(reference, [.05], 3000);
    for (const frames of [[1 / 60], [.016, .05, .033, .1]]) {
      const other = island();
      run(other, frames, 3000);
      expect(placedTypes(other)).toEqual(placedTypes(reference));
      expect(stateHash(other)).toBe(stateHash(reference));
    }
  });

  /*
   * Compares the AI's decisions (sites, roads, faction AI state), not the whole state hash: a reload of an island
   * with road-joined computer sites drifts in the kernel's idle-carrier animation clock with or without any AI
   * decision (EAI3a receipt finding 1, lane ai-reload-drift).
   */
  it("continues identically after a save and reload one tick before a strategic decision", () => {
    const reference = island();
    run(reference, [.05], 3000);
    for (const at of [3 * STRATEGIC_PERIOD - 1, 5 * STRATEGIC_PERIOD - 1]) {
      const first = island();
      run(first, [.05], at);
      const saved = JSON.parse(JSON.stringify(first.saveState()));
      const reloaded = island();
      expect(reloaded.loadState(saved)).toEqual({ ok: true });
      expect(reloaded.saveState().factionAi).toEqual(saved.factionAi);
      run(reloaded, [.05], 3000);
      expect(decisionsOf(reloaded)).toEqual(decisionsOf(reference));
    }
  });
});
