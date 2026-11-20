import { describe, expect, it } from "vitest";

import { createIslandFelling } from "../src/app/island-felling";
import { createIslandGrowth } from "../src/app/island-growth";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { createOfflineIslandSession, OFFLINE_STEP } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { createCamera } from "../src/render-common/camera-state";
import { createAnimalManager } from "../src/render-common/wildlife/animal-manager";
import { createIslandNav } from "../src/render-common/wildlife/nav/island-nav";
import { SPECIES } from "../src/render-common/wildlife/wildlife-species";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../src/shared/world/generation/generate-world";
import { BUILD, MATERIAL, MATERIAL_COUNT } from "../src/shared/world/world-data";

const TIMEOUT = 120_000;

/** The hunting test world without the vitest-dependent cached-world helper. */
const huntingWorld = () => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 0 });
  world.heights.fill(2);
  world.blocking.fill(0);
  world.walkCost.fill(10);
  world.buildClass.fill(BUILD.large);
  world.buildCap.fill(BUILD.large);
  world.slopeClass.fill(0);
  world.seaLevel = -1;
  world.props.count = 0;
  world.splat.fill(0);
  for (let i = 0; i < world.splat.length; i += MATERIAL_COUNT) world.splat[i + MATERIAL.grass] = 255;
  world.start = { x: 10, z: 10 };
  return world;
};

/** A saved hunter already waiting beside a herd, so the covered wait boundary is exercised. */
const hunterWaitSave = async (): Promise<GameSaveV1> => {
  const world = huntingWorld();
  const animals = createAnimalManager(world, createIslandNav(world, []));
  for (const [x, z] of [[30, 30], [34, 28], [28, 36], [40, 40]] as const)
    animals.placeAnimal(SPECIES.deer, x, z, 1);
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 8,
    initialStock: { bow: 1, planks: 10 }, canWorkerEnterPlot: () => true });
  const camera = createCamera(10, 10, 1);
  const growth = createIslandGrowth(world, () => true);
  const felling = createIslandFelling({ camera, world, canFell: () => true, isGrown: growth.isGrown,
    onFelled: () => {}, onRemoved: () => {}, project: () => ({ x: 0, y: 0, depth: 0 }) });
  const base = await createGameSave(world, simulation.saveState(), {
    name: "hunter wait fixture", savedAt: 20_000_000, source: "generated", animals: [] },
  { animals: animals.saveState(), camera, growth: growth.saveState(), felling: felling.saveState() });
  const island = await createHeadlessIsland(base, true);
  const placed = island.simulation.placeBuilding(22, 22, 22);
  if (!placed.ok) throw new Error(placed.reason);
  Object.assign(placed.building!, { construction: 1, foundationProgress: 1, required: {} });
  if (!island.simulation.connectRoads(island.simulation.headquarters.access, placed.building!.access))
    throw new Error("the hunter road did not connect");
  for (let tick = 0; tick < 1200; tick++) island.simulation.update(.05);
  const warm = await island.save();
  const live = await createOfflineIslandSession(structuredClone(warm), {
    archipelago: undefined, enemyCampsBlockJumps: false, exactBudgetSeconds: 1800, islandId: null,
    mode: "exact", now: warm.savedAt, report: () => {}, seconds: 600, start: warm.savedAt });
  for (let tick = 1; tick <= 12000; tick++) {
    await live.advance(OFFLINE_STEP);
    const hunter = live.simulation.frames().find(actor => actor.job === "Hunter");
    if (hunter?.phase === "huntWait" && hunter.timer > .1)
      return live.save(warm.savedAt + tick * 50);
  }
  throw new Error("the hunter never reached the wait boundary");
};

describe("event-core hunter wait", () => {
  it("owns the wait boundary without changing the exact chase, aim and flight outcome", async () => {
    const source = await hunterWaitSave();
    const at = source.savedAt + 60_000;
    const metrics: import("../src/app/settlement/offline-island-replay").OfflineIslandMetrics[] = [];
    const exact = await advanceOfflineGame(structuredClone(source), at, () => {},
      { exact: true, eventCore: false });
    const event = await advanceOfflineGame(structuredClone(source), at, () => {},
      { eventCore: true, onIslandMetrics: value => metrics.push(value) });
    expect(metrics[0]?.eventCoreCoverage?.reasons).toEqual([]);
    expect(metrics[0]?.eventCore?.events).toBeGreaterThan(0);
    expect(event.settlement).toEqual(exact.settlement);
    expect(event.runtime).toEqual(exact.runtime);
    expect(metrics[0]?.eventCoreCoverage?.fixedLane.unsupportedPhases).toEqual([]);
    const exactMeat = exact.settlement.buildings.find(building => building.typeId === 0)?.inventory.meat ?? 0;
    expect(exactMeat).toBeGreaterThanOrEqual(1);
    expect(event.settlement.buildings.find(building => building.typeId === 0)?.inventory.meat ?? 0)
      .toBe(exactMeat);
  }, TIMEOUT);
});
