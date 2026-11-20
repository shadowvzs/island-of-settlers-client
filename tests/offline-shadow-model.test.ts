import { beforeAll, describe, expect, it } from "vitest";

import { predictOfflineShadow } from "../src/app/settlement/offline-shadow-model";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { talentModifiers } from "../src/shared/progression/talents";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";
import { huntingWorld } from "./helpers/hunting-world";

const START = 1_000_000;
const HOUR = 3_600;

interface Fixture { save: GameSaveV1; world: WorldData }

const placeCompleted = (simulation: ReturnType<typeof createSettlementSimulation>, type: number) => {
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const placed = simulation.placeBuilding(type, 16 + width / 2, 10 + depth / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const building = placed.building!;
  Object.assign(building, { construction: 1, foundationProgress: 1, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
  return building;
};

const createFixture = async (
  place: (simulation: ReturnType<typeof createSettlementSimulation>) => SettlementBuilding
): Promise<Fixture> => {
  const world = huntingWorld();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({
    world, roads, initialSettlers: 30, resourceTargets: () => [],
    initialStock: {
      axe: 4, fish: 200, hammer: 4, logs: 400, pickaxe: 4, planks: 40, saw: 4, shovel: 4, stone: 40
    }
  });
  const building = place(simulation);
  // A few scheduler ticks recruit the worker; the shadow model only needs the saved assignment.
  for (let tick = 0; tick < 30; tick++) simulation.update(.05);
  expect(building.worker, "fixture building was not staffed").toBeDefined();
  const save = await createGameSave(world, simulation.saveState(), {
    name: "offline shadow fixture", savedAt: START, source: "generated", animals: []
  });
  return { save, world };
};

describe("offline shadow model", () => {
  let sawmill: Fixture, woodcutter: Fixture, unsupportedBuilding: Fixture;

  beforeAll(async () => {
    sawmill = await createFixture(simulation => placeCompleted(simulation, 33));
    woodcutter = await createFixture(simulation => placeCompleted(simulation, 17));
    unsupportedBuilding = await createFixture(simulation => placeCompleted(simulation, 20));
  }, 60_000);

  it("clones the save and advances only predicted fields", () => {
    const sourceJson = JSON.stringify(sawmill.save);
    const worldJson = JSON.stringify(sawmill.world);
    const result = predictOfflineShadow(sawmill.save, sawmill.world, 600);
    expect(JSON.stringify(sawmill.save)).toBe(sourceJson);
    expect(JSON.stringify(sawmill.world)).toBe(worldJson);
    expect(result.save).not.toBe(sawmill.save);
    expect(result.save.settlement).not.toBe(sawmill.save.settlement);
    expect(result.save.settlement.buildings).not.toBe(sawmill.save.settlement.buildings);
    expect(result.save.savedAt).toBe(START + 600_000);
    expect(result.save.settlement.gameTick).toBe(sawmill.save.settlement.gameTick);
    expect(result.report.assumptions.actors).toBe("not-moved");
    expect(result.save.settlement.actors).toEqual(sawmill.save.settlement.actors);

    const predicted = result.save.settlement.buildings.find(building => building.typeId === 33)!;
    predicted.input.logs = 777;
    expect(JSON.stringify(sawmill.save)).toBe(sourceJson);
  });

  it("uses road tiers for static route costs and recomputes after a tier change", () => {
    const dirt = predictOfflineShadow(sawmill.save, sawmill.world, HOUR);
    const fastSave = structuredClone(sawmill.save);
    fastSave.settlement.roads = fastSave.settlement.roads.map(segment => ({ ...segment, tier: "granite" }));
    const fast = predictOfflineShadow(fastSave, structuredClone(sawmill.world), HOUR);
    const dirtBuilding = dirt.report.buildings.find(building => building.typeId === 33)!;
    const fastBuilding = fast.report.buildings.find(building => building.typeId === 33)!;
    expect(dirtBuilding.route?.distance).toBeGreaterThan(0);
    expect(fastBuilding.route?.distance).toBe(dirtBuilding.route?.distance);
    expect(fastBuilding.route!.weightedCost).toBeLessThan(dirtBuilding.route!.weightedCost);
    expect(fastBuilding.carrierRoundTripSeconds).toBeLessThan(dirtBuilding.carrierRoundTripSeconds);
    expect(fastBuilding.cycleSeconds).toBeLessThan(dirtBuilding.cycleSeconds);
    expect(dirt.report.routes.revisions.road).toBeGreaterThan(0);
    expect(dirt.report.routes.cache.entries).toBeGreaterThan(0);
    expect(dirt.report.routes.cache.calls).toBe(dirt.report.routes.cache.hits + dirt.report.routes.cache.misses);
    expect(dirtBuilding.route!.cacheKey).toContain(`road=${dirt.report.routes.revisions.road}`);
  });

  it("derives animation, rest and route time from live timing and talents", () => {
    const base = predictOfflineShadow(sawmill.save, sawmill.world, HOUR);
    const baseEstimate = base.report.buildings.find(building => building.typeId === 33)!;
    const talents = talentModifiers(undefined);
    const boosted = predictOfflineShadow(sawmill.save, sawmill.world, HOUR, {
      talents: { ...talents, carrierSpeed: .5, productionSpeed: 1 }
    });
    const boostedEstimate = boosted.report.buildings.find(building => building.typeId === 33)!;
    expect(baseEstimate.workerOverheadSeconds).toBeGreaterThan(0);
    expect(baseEstimate.workerOverheadSeconds).toBeLessThan(3);
    expect(boostedEstimate.workSeconds).toBeCloseTo(baseEstimate.workSeconds / 2, 5);
    expect(boostedEstimate.workerOverheadSeconds).toBeCloseTo(baseEstimate.workerOverheadSeconds / 2, 5);
    expect(boostedEstimate.carrierRoundTripSeconds)
      .toBeCloseTo(baseEstimate.carrierRoundTripSeconds / 1.5, 5);
  });

  it("reports the no-traffic, no-collision and unchanged-world assumptions", () => {
    const result = predictOfflineShadow(sawmill.save, sawmill.world, HOUR);
    expect(result.report.flags.noTraffic).toBe(true);
    expect(result.report.flags.noCollisions).toBe(true);
    expect(result.report.flags.noDepositDepletion).toBe(true);
    expect(result.report.flags.noAnimalRespawn).toBe(true);
    expect(result.report.flags.actorsMoved).toBe(false);
    expect(result.report.assumptions.traffic).toBe("ignored");
    expect(result.report.assumptions.collisions).toBe("ignored");
    expect(result.report.notes.some(note => note.includes("No traffic jams"))).toBe(true);
    expect(result.report.buildings.length).toBeGreaterThan(0);
  });

  it("leaves deposits, animals, resource amounts and the supplied world unchanged", () => {
    const save = structuredClone(sawmill.save);
    save.runtime = { animals: { sentinel: [1, 2, 3] }, camera: { centerX: 7, centerZ: 8 } };
    Object.assign(save.settlement, {
      marbleDeposits: [{ id: 5, x: 1, z: 2, remaining: 9 }],
      stoneRespawns: [{ prop: 3, remaining: 12 }]
    });
    save.settlement.resourceAmounts = [["fish", 123]];
    const world = structuredClone(sawmill.world);
    world.oreAmount[0] = 77;
    const before = JSON.stringify(save);
    const oreBefore = world.oreAmount[0];
    const result = predictOfflineShadow(save, world, HOUR);
    expect(JSON.stringify(save)).toBe(before);
    expect(world.oreAmount[0]).toBe(oreBefore);
    expect(result.save.runtime).toEqual(save.runtime);
    expect(result.save.settlement.marbleDeposits).toEqual(save.settlement.marbleDeposits);
    expect(result.save.settlement.stoneRespawns).toEqual(save.settlement.stoneRespawns);
    expect(result.save.settlement.resourceAmounts).toEqual(save.settlement.resourceAmounts);
    expect(result.report.flags.depositsSpent).toBe(false);
    expect(result.report.flags.animalsChanged).toBe(false);
  });

  it("assumes endless raw supply for an input-free producer with no trees", () => {
    expect(woodcutter.world.props.count).toBe(0);
    const worldJson = JSON.stringify(woodcutter.world);
    const raw = predictOfflineShadow(woodcutter.save, woodcutter.world, HOUR);
    const estimate = raw.report.buildings.find(building => building.typeId === 17)!;
    expect(raw.report.flags.unlimitedRawSupply).toBe(true);
    expect(estimate.cycles).toBeGreaterThan(0);
    expect(estimate.produced.logs).toBe(estimate.cycles);
    expect(JSON.stringify(woodcutter.world)).toBe(worldJson);

    const disabled = predictOfflineShadow(woodcutter.save, woodcutter.world, HOUR, {
      includeEndlessRawProducers: false
    });
    expect(disabled.report.unsupported).toContainEqual({
      uid: estimate.uid, typeId: 17, reason: "raw resource producer disabled"
    });
    expect(disabled.report.buildings.some(building => building.uid === estimate.uid)).toBe(false);
  });

  it("reports in-flight actor cargo without moving actors", () => {
    const save = structuredClone(sawmill.save);
    const actor = save.settlement.actors[0]!;
    Object.assign(actor, { consumed: undefined, productionOutput: undefined, ware: "logs", wareUnits: 2 });
    const result = predictOfflineShadow(save, sawmill.world, 600);
    expect(result.report.inFlight.actors).toBeGreaterThan(0);
    expect(result.report.inFlight.goods.logs).toBeGreaterThanOrEqual(2);
    expect(result.report.totalGoods.logs).toBe(
      (result.report.predictedGoods.logs ?? 0) + (result.report.inFlight.goods.logs ?? 0));
    expect(result.save.settlement.actors).toEqual(save.settlement.actors);
  });

  it("reads saved carrier capacity, hand carts and carrier concurrency", () => {
    const save = structuredClone(sawmill.save);
    const carriers = save.settlement.actors.slice(0, 2);
    for (const carrier of carriers) {
      Object.assign(carrier, { job: "Carrier", workerMovementPlan: { manifest: { capacity: 3, units: 3 } } });
    }
    const storage = save.settlement.buildings.find(building => building.typeId === 0)!;
    storage.handcarts = 2;
    const result = predictOfflineShadow(save, sawmill.world, HOUR);
    expect(result.report.carriers.actors).toBeGreaterThanOrEqual(2);
    expect(result.report.carriers.capacity).toBe(3);
    expect(result.report.carriers.capacitySource).toBe("saved");
    expect(result.report.carriers.concurrency).toBe(result.report.carriers.actors);
    expect(result.report.carriers.handcarts).toBeGreaterThanOrEqual(2);
    const estimate = result.report.buildings.find(building => building.typeId === 33)!;
    expect(estimate.carrierCapacity).toBe(3);
    expect(estimate.carrierConcurrency).toBe(result.report.carriers.actors);
  });

  it("credits the current worker cycle before the first predicted cycle", () => {
    const save = structuredClone(sawmill.save);
    const production = save.settlement.buildings.find(building => building.typeId === 33)!;
    const worker = save.settlement.actors.find(actor => actor.uid === production.worker)!;
    Object.assign(worker, { phase: "work", productionSeconds: 10, timer: 5 });
    const result = predictOfflineShadow(save, sawmill.world, 15 * 60);
    const estimate = result.report.buildings.find(building => building.uid === production.uid)!;
    expect(estimate.workerProgressSeconds).toBeCloseTo(estimate.workSeconds / 2, 5);
    expect(estimate.firstCycleSeconds).toBeLessThan(estimate.cycleSeconds);
    expect(estimate.timeCycles).toBeGreaterThan(0);
  });

  it("reports an unsupported completed building instead of pretending coverage", () => {
    const result = predictOfflineShadow(unsupportedBuilding.save, unsupportedBuilding.world, HOUR);
    const building = unsupportedBuilding.save.settlement.buildings.find(entry => entry.typeId === 20)!;
    expect(result.report.unsupported).toContainEqual({
      uid: building.uid, typeId: 20, reason: "no ware output"
    });
    expect(result.report.buildings.some(entry => entry.uid === building.uid)).toBe(false);
  });

  it("predicts a small sawmill cycle and exact storage/log stock deltas", () => {
    const save = structuredClone(sawmill.save);
    const production = save.settlement.buildings.find(building => building.typeId === 33)!;
    const storage = save.settlement.buildings.find(building => building.typeId === 0)!;
    production.input = {};
    production.output = {};
    const pool = save.settlement.storagePools.pools.find(entry => entry.id === storage.storagePoolId)!;
    const logsBefore = pool.available.logs ?? 0;
    const planksBefore = pool.available.planks ?? 0;
    const cyclesBefore = production.cycle;
    const result = predictOfflineShadow(save, sawmill.world, 15 * 60);
    const estimate = result.report.buildings.find(building => building.uid === production.uid)!;
    const after = result.save.settlement.buildings.find(building => building.uid === production.uid)!;
    const poolAfter = result.save.settlement.storagePools.pools.find(entry => entry.id === storage.storagePoolId)!;
    expect(estimate.cycles).toBeGreaterThan(0);
    expect(estimate.workSeconds).toBeGreaterThan(0);
    expect(estimate.carrierRoundTripSeconds).toBeGreaterThan(0);
    expect(estimate.cycleSeconds).toBeGreaterThan(estimate.workSeconds);
    expect(after.cycle).toBe(cyclesBefore + estimate.cycles);
    expect(poolAfter.available.logs ?? 0).toBe(logsBefore - estimate.cycles);
    expect(poolAfter.available.planks ?? 0).toBe(planksBefore + estimate.cycles);
    expect(result.report.goodsDelta.logs).toBe(-estimate.cycles);
    expect(result.report.goodsDelta.planks).toBe(estimate.cycles);
    expect(result.report.totals.cycles).toBe(estimate.cycles);
  });

  it("caps the modeled window at 24 h and is deterministic", () => {
    const first = predictOfflineShadow(sawmill.save, sawmill.world, 30 * HOUR);
    const second = predictOfflineShadow(structuredClone(sawmill.save), structuredClone(sawmill.world), 30 * HOUR);
    expect(first.report.modeledSeconds).toBe(24 * HOUR);
    expect(first.report.cappedAt24h).toBe(true);
    expect(first.save.savedAt).toBe(START + 24 * HOUR * 1000);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
