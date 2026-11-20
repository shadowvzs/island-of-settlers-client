import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { MARBLE_DEPOSIT_QUANTITY, STONE_SOURCE_REST_SECONDS } from "../src/shared/balance/resources";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { ResourceTarget } from "../src/shared/settlement/settlement-types";
import { BLOCKING, PROP } from "../src/shared/world/world-data";
import { fakeColonyConquest } from "./helpers/fake-colony-conquest";
import { huntingWorld } from "./helpers/hunting-world";
import { editSavedOccupancy } from "./helpers/saved-occupancy";

const fixture = (type: number, hardwoodSawmill = false, settlers = 12) => {
  const colony = type !== 44 && type !== 33;
  const world = huntingWorld();
  if (colony) {
    world.seaLevel = .5; world.start = { x: 10, z: 31 };
    for (let z = 40; z <= 64; z++) for (let x = 0; x <= 64; x++)
      world.heights[z * 65 + x] = -1;
    for (let z = 40; z < 64; z++) for (let x = 0; x < 64; x++) {
      const cell = z * 64 + x; world.walkCost[cell] = 0; world.blocking[cell] = BLOCKING.water;
      world.buildClass[cell] = 0;
    }
  }
  world.props.count = 3;
  world.props.types.set([PROP.coniferTree, PROP.hardwoodTree, PROP.palmTree]);
  world.props.x.set([22, 25, 28]); world.props.z.set([22, 22, 22]); world.props.scale.fill(1);
  const roads = createRoadNetwork(world);
  const planted: ResourceTarget[] = [];
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: settlers,
    homeBuilding: colony ? 39 : 0, onPlantTree: point => { planted.push(point as ResourceTarget); return true; },
    initialStock: colony ? {} : { ...STARTER_STOCK, hardwoodLogs: 5 }, canWorkerEnterPlot: () => true });
  if (colony) {
    expect(simulation.startColony({ island: colonyIslandOffers(1234)[0]!, landed: { ...STARTER_STOCK, hardwoodLogs: 5 }, troops: [] }).ok).toBe(true);
    fakeColonyConquest(simulation);
  }
  const [width, depth] = getBuildingDefinition(type === 44 ? 33 : type).gridFootprint;
  // The shared Sawmill 33 owns every timber tier; 44 is a retired legacy specialist.
  const placed = simulation.placeBuilding(type === 44 ? 33 : type, 22 + width % 2 / 2, 17 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const building = placed.building!;
  if (hardwoodSawmill) {
    building.workshopUpgrade = { level: 1 };
    building.selectedOutput = "hardwoodPlanks";
  }
  Object.assign(building, { construction: 1, foundationProgress: 1, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, building.access)).toBe(true);
  const advance = (until: () => boolean, seconds = 450) => {
    for (let step = 0; step < seconds * 20; step++) {
      simulation.update(.05);
      if (until()) return true;
    }
    return false;
  };
  return { advance, building, planted, simulation, world };
};

/** Shared wares are reachable through a proxy inventory; only its local equipment is serialized. */
const localInventory = (building: { inventory: Record<string, number> }) =>
  JSON.parse(JSON.stringify(building.inventory)) as Record<string, number>;

const total = (simulation: ReturnType<typeof createSettlementSimulation>, ware: string) => {
  const pools = new Map<number, number>();
  for (const building of simulation.buildings()) {
    const snapshot = simulation.storageSnapshot(building.uid);
    if (snapshot) pools.set(snapshot.poolId,
      (pools.get(snapshot.poolId) ?? 0) + (snapshot.stored[ware] ?? 0));
  }
  return simulation.buildings().reduce((sum, building) => sum + (localInventory(building)[ware] ?? 0) +
    (building.input[ware] ?? 0) + (building.output[ware] ?? 0), 0) +
    [...pools.values()].reduce((sum, amount) => sum + amount, 0) +
    simulation.frames().reduce((sum, actor) => sum + (actor.ware === ware ? 1 : 0), 0);
};

describe("dedicated advanced material chain", () => {
  it("requires distinct hardwood identity and preserves the committed cycle across reload", () => {
    expect([PROP.broadleafTree, PROP.birchTree, PROP.coniferTree, PROP.palmTree]).not.toContain(PROP.hardwoodTree);
    const { advance, simulation, world } = fixture(42);
    expect(advance(() => simulation.frames().some(actor => actor.phase === "work" && actor.target?.kind === "tree")))
      .toBe(true);
    const worker = simulation.frames().find(actor => actor.job === "Woodcutter")!;
    expect(worker.target?.id).toBe(1);
    expect(worker.productionOutput).toBe("hardwoodLogs");
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    expect(advance(() => total(simulation, "hardwoodLogs") === 6)).toBe(true);
    expect(world.props.types[0]).toBe(PROP.coniferTree);
    expect(world.props.types[2]).toBe(PROP.palmTree);
  });

  it("plants explicit hardwood seedlings in its own nursery workflow", () => {
    const { advance, planted } = fixture(41);
    expect(advance(() => planted.length > 0)).toBe(true);
    expect(planted[0]?.treeSpecies).toBe("hardwoodTree");
  });

  it("processes delivered hardwood logs one-for-one without consuming ordinary logs", () => {
    const { advance, simulation } = fixture(33, true);
    const ordinaryBefore = total(simulation, "logs");
    expect(advance(() => total(simulation, "hardwoodPlanks") > 0)).toBe(true);
    expect(total(simulation, "logs")).toBe(ordinaryBefore);
    expect(total(simulation, "hardwoodLogs") + total(simulation, "hardwoodPlanks")).toBe(5);
  });

  it("enforces colony gathering and shared sawmill placement while hiding legacy specialists", () => {
    const home = fixture(33).simulation, colony = fixture(42).simulation;
    for (const id of [41, 42, 43]) {
      expect(home.allowsBuilding(id)).toBe(false);
      expect(home.placeBuilding(id, 35, 35).ok).toBe(false);
      expect(colony.allowsBuilding(id)).toBe(true);
    }
    expect(home.allowsBuilding(33)).toBe(true);
    expect(colony.allowsBuilding(33)).toBe(true);
    expect(home.allowsBuilding(44)).toBe(false);
    expect(colony.allowsBuilding(44)).toBe(false);
    expect(colony.placeBuilding(44, 35.5, 35.5).ok).toBe(false);
  });

  it("consumes only finite marble deposits and preserves remaining quantities across reloads", () => {
    const { advance, simulation } = fixture(43);
    const before = simulation.marbleDeposits().reduce((sum, source) => sum + source.remaining, 0);
    expect(before).toBeGreaterThan(0);
    expect(advance(() => total(simulation, "marble") > 0)).toBe(true);
    const after = simulation.marbleDeposits().reduce((sum, source) => sum + source.remaining, 0);
    expect(after).toBe(before - total(simulation, "marble"));
    const saved = structuredClone(simulation.saveState());
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.saveState().marbleDeposits).toEqual(saved.marbleDeposits);
    expect(simulation.marbleDeposits().reduce((sum, source) => sum + source.remaining, 0)).toBe(after);
    const restored = simulation.saveState();
    const corrupt = structuredClone(restored); corrupt.marbleDeposits![0]!.remaining = 49;
    expect(simulation.loadState(corrupt).ok).toBe(false);
    expect(simulation.saveState()).toEqual(restored);
  });

  it("keeps advanced input/output contacts connected in every rotation", () => {
    for (const [id, kind, ware] of [[42, "output", "hardwoodLogs"], [43, "output", "marble"],
      [33, "input", "logs"], [33, "output", "planks"]] as const)
      for (let rotation = 0; rotation < 4; rotation++) {
        const contact = getBuildingStockContact(id, kind, ware, 0, 40, 50, rotation, 2);
        expect(contact).not.toBeNull();
        expect(contact!.stock.every(Number.isFinite)).toBe(true);
      }
  });
});

it("migrates a legacy colony non-destructively; exhausted marble vanishes and grows back at its spot", () => {
  const { simulation, world } = fixture(42);
  const original = simulation.saveState();
  const legacy = structuredClone(original);
  editSavedOccupancy(legacy, grid => {
    for (const source of legacy.marbleDeposits ?? [])
      grid[Math.floor(source.z) * world.cellsX + Math.floor(source.x)] = 0;
  });
  delete legacy.marbleDeposits;
  const buildings = structuredClone(legacy.buildings.map(building => ({ uid: building.uid, x: building.x,
    z: building.z, typeId: building.typeId, input: building.input, output: building.output, inventory: building.inventory })));
  expect(simulation.loadState(legacy)).toEqual({ ok: true });
  const sources = simulation.marbleDeposits();
  expect(sources.length).toBeGreaterThan(0);
  expect(simulation.buildings().map(building => ({ uid: building.uid, x: building.x, z: building.z,
    typeId: building.typeId, input: building.input, output: building.output,
    inventory: localInventory(building) })))
    .toEqual(buildings);
  for (const source of sources) expect(simulation.isOccupied(source.x, source.z)).toBe(true);
  const exhausted = simulation.saveState();
  editSavedOccupancy(exhausted, grid => {
    for (const source of exhausted.marbleDeposits!) {
      source.remaining = 0;
      grid[Math.floor(source.z) * world.cellsX + Math.floor(source.x)] = 0;
    }
  });
  expect(simulation.loadState(exhausted)).toEqual({ ok: true });
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  expect(simulation.marbleDeposits().every(source => source.remaining === 0)).toBe(true);
  // An exhausted source is not re-surveyed elsewhere; it leaves the map (cell free) while it rests.
  for (const source of simulation.marbleDeposits()) expect(simulation.isOccupied(source.x, source.z)).toBe(false);
  for (let second = 0; second < STONE_SOURCE_REST_SECONDS / 2; second++) simulation.update(1);
  expect(simulation.marbleDeposits().every(source => source.remaining === 0)).toBe(true);
  const resting = simulation.saveState();
  expect(resting.stoneRespawns!.filter(entry => entry.kind === "deposit")).toHaveLength(sources.length);
  expect(resting.stoneRespawns!.every(entry => entry.restSeconds > 0)).toBe(true);
  expect(simulation.loadState(resting)).toEqual({ ok: true });
  for (let second = 0; second <= STONE_SOURCE_REST_SECONDS / 2; second++) simulation.update(1);
  expect(simulation.marbleDeposits().every(source => source.remaining === MARBLE_DEPOSIT_QUANTITY)).toBe(true);
  expect(simulation.saveState().stoneRespawns).toEqual([]);
  for (const source of simulation.marbleDeposits()) expect(simulation.isOccupied(source.x, source.z)).toBe(true);
});

it("upgrades the real hardwood sawmill and a level-one sawmill keeps its six-item shelf and every input", () => {
  const upgrade = fixture(33);
  // Like Sawmill 33, level one pays 4 hardwood logs and 2 marble.
  Object.assign(upgrade.simulation.headquarters.inventory, { hardwoodLogs: 16, marble: 2 });
  expect(upgrade.simulation.setStorageAcceptance(upgrade.simulation.headquarters.uid, "hardwoodPlanks", false))
    .toBe(true);
  expect(upgrade.simulation.requestWorkshopUpgrade(upgrade.building.uid)).toBe(true);
  expect(upgrade.advance(() => upgrade.building.workshopUpgrade?.level === 1)).toBe(true);
  expect(upgrade.building.workshopUpgrade).toEqual({ level: 1 });
  expect(total(upgrade.simulation, "hardwoodLogs")).toBe(12);
  expect(total(upgrade.simulation, "marble")).toBe(0);

  const { advance, building, simulation } = fixture(33, true);
  Object.assign(simulation.headquarters.inventory, { hardwoodLogs: 12 });
  expect(simulation.setStorageAcceptance(simulation.headquarters.uid, "hardwoodPlanks", false)).toBe(true);
  expect(simulation.setProductionMode(building.uid, "hardwoodPlanks")).toBe(true);
  expect(advance(() => total(simulation, "hardwoodPlanks") === 6)).toBe(true);
  expect(building.workshopUpgrade).toEqual({ level: 1 });
  expect(total(simulation, "hardwoodLogs")).toBe(6);
  expect(total(simulation, "logs")).toBe(24);
  for (let tick = 0; tick < 100; tick++) simulation.update(.05);
  expect(total(simulation, "hardwoodPlanks")).toBe(6);
});
