import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { MARBLE_DEPOSIT_QUANTITY, STONE_SOURCE_REST_SECONDS } from "../src/shared/balance/resources";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { populateColonyHardwood } from "../src/shared/world/generation/colony-hardwood";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";
import { huntingWorld } from "./helpers/hunting-world";

const MARBLE_QUARRY = 43;
const LIMESTONE_QUARRY = 47;
const FORESTER = 20;
const DEPOSIT_SPOT = { x: 30.5, z: 26.5 };

/** A plain home island; `marble`: an editor placed marble deposit (map field colonyStoneDeposits). */
const homeIsland = (marble: boolean, remaining = MARBLE_DEPOSIT_QUANTITY) => {
  const world = huntingWorld();
  if (marble) world.colonyStoneDeposits = [{ id: 0, material: "marble", remaining, ...DEPOSIT_SPOT }];
  const simulation = createSettlementSimulation({
    canWorkerEnterPlot: () => true, initialSettlers: 12, initialStock: { ...STARTER_STOCK },
    roads: createRoadNetwork(world), world
  });
  return { simulation, world };
};

const totalMarble = (simulation: ReturnType<typeof createSettlementSimulation>) =>
  simulation.buildings().reduce((sum, building) => sum + (building.inventory.marble ?? 0) +
    (building.output.marble ?? 0), 0) +
  simulation.frames().filter(actor => actor.ware === "marble").length;

describe("specialist quarries follow their deposits", () => {
  it("refuses the marble quarry on a home island without a marble deposit", () => {
    const { simulation } = homeIsland(false);
    expect(simulation.allowsBuilding(MARBLE_QUARRY)).toBe(false);
    const placed = simulation.placeBuilding(MARBLE_QUARRY, 22, 17);
    expect(placed.ok).toBe(false);
    expect(placed.reason).toContain("marble deposit");
  });

  it("builds and runs the marble quarry at an editor placed deposit on a home island", () => {
    const { simulation } = homeIsland(true);
    expect(simulation.allowsBuilding(MARBLE_QUARRY)).toBe(true);
    // The deposit's stone decides: no limestone deposit, no limestone quarry.
    expect(simulation.allowsBuilding(LIMESTONE_QUARRY)).toBe(false);
    const [width, depth] = getBuildingDefinition(MARBLE_QUARRY).gridFootprint;
    const placed = simulation.placeBuilding(MARBLE_QUARRY, 22 + width % 2 / 2, 17 + depth % 2 / 2);
    expect(placed.ok, placed.reason).toBe(true);
    const quarry = placed.building!;
    Object.assign(quarry, { construction: 1, foundationProgress: 1, required: {} });
    expect(simulation.connectRoads(simulation.headquarters.access, quarry.access)).toBe(true);
    for (let step = 0; step < 450 * 20 && totalMarble(simulation) === 0; step++) simulation.update(.05);
    expect(totalMarble(simulation)).toBeGreaterThan(0);
    const [deposit] = simulation.marbleDeposits();
    expect(deposit!.remaining).toBe(MARBLE_DEPOSIT_QUANTITY - totalMarble(simulation));
  });

  it("a worked out marble deposit vanishes, waits for a covered spot and grows back like a boulder", () => {
    const { simulation } = homeIsland(true, 1);
    const [width, depth] = getBuildingDefinition(MARBLE_QUARRY).gridFootprint;
    const quarry = simulation.placeBuilding(MARBLE_QUARRY, 22 + width % 2 / 2, 17 + depth % 2 / 2).building!;
    Object.assign(quarry, { construction: 1, foundationProgress: 1, required: {} });
    expect(simulation.connectRoads(simulation.headquarters.access, quarry.access)).toBe(true);
    const deposit = () => simulation.marbleDeposits()[0]!;
    for (let step = 0; step < 450 * 20 && deposit().remaining > 0; step++) simulation.update(.05);
    expect(deposit().remaining).toBe(0);
    expect(simulation.isOccupied(DEPOSIT_SPOT.x, DEPOSIT_SPOT.z)).toBe(false);
    expect(simulation.saveState().stoneRespawns).toEqual([{ id: 0, kind: "deposit", restSeconds: expect.any(Number) }]);
    const [plotWidth, plotDepth] = getBuildingDefinition(FORESTER).gridFootprint;
    const cover = simulation.placeBuilding(FORESTER, Math.floor(DEPOSIT_SPOT.x) + plotWidth % 2 / 2,
      Math.floor(DEPOSIT_SPOT.z) + plotDepth % 2 / 2);
    expect(cover.ok, cover.reason).toBe(true);
    for (let second = 0; second < STONE_SOURCE_REST_SECONDS + 30; second++) simulation.update(1);
    expect(deposit().remaining).toBe(0);
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    expect(simulation.demolishBuilding(cover.building!.uid).ok).toBe(true);
    for (let second = 0; second < 5; second++) simulation.update(1);
    expect(deposit().remaining).toBe(MARBLE_DEPOSIT_QUANTITY);
    expect(simulation.isOccupied(DEPOSIT_SPOT.x, DEPOSIT_SPOT.z)).toBe(true);
  });
});

describe("generator keeps specialist stones off home islands", () => {
  it("places no marble, limestone, basalt or granite deposit on a generated home island", () => {
    for (const seed of [11, 29]) {
      const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, seed });
      expect(world.expeditionKind).not.toBe("colony");
      expect(world.colonyStoneDeposits ?? []).toEqual([]);
      expect(world.scenario?.marbleDeposits ?? []).toEqual([]);
      // The colony resource pass refuses a home island even with a resource tier.
      world.colonyResourceTier = 1;
      expect(populateColonyHardwood(world)).toBe(0);
      expect(world.colonyStoneDeposits ?? []).toEqual([]);
    }
  });
});
