import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { BuildingType } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { inFarmRange } from "../src/shared/settlement/settlement-farm-area";
import { createSettlementFieldCycles } from "../src/shared/settlement/settlement-field-cycles";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { consumeWorkTarget, findWorkTarget } from "../src/shared/settlement/settlement-resources";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import {
  setStoneArea,
  stoneArea,
  STONEMASON_RADIUS
} from "../src/shared/settlement/settlement-stone-area";
import type { ResourceTarget, SettlementContext } from "../src/shared/settlement/settlement-types";
import {
  buildingAreaRange,
  buildingWorkRadius,
  LOOKOUT_SIGHT_RADIUS,
  resourceWorkRadius
} from "../src/shared/settlement/settlement-work-ranges";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 40;
  const world = {
    seed: 9,
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2),
    blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: {
      count: 0,
      types: new Uint8Array(),
      x: new Float32Array(),
      z: new Float32Array(),
      scale: new Float32Array()
    }
  } as unknown as WorldData;
  const context: SettlementContext = {
    options: {
      world,
      roads: { route: () => null, addRoad: () => true, upgradeRoad: () => true },
      findWorkerPath: (_from, to) => [{ ...to }]
    },
    buildings: [],
    actors: [],
    occupied: new Uint8Array(size ** 2),
    reservations: new Set(),
    resourceAmounts: new Map(),
    nextActor: 0,
    nextBuilding: 0,
    settlers: 20,
    accumulator: 0,
    scheduling: 0,
    transfers: []
  };
  const farm = makeBuilding(context, BuildingType.Farm, 14.5, 12, 0);
  farm.construction = 1;
  context.buildings.push(farm);
  context.fieldCycles = createSettlementFieldCycles(context);
  const cycles = context.fieldCycles;
  const target = (x: number, z: number): ResourceTarget => ({
    id: z * size + x,
    kind: "field",
    x: x + 0.5,
    z: z + 0.5
  });
  return { world, context, farm, cycles, target };
};
describe("selected civilian work areas", () => {
  it("defaults around the farm entrance and restricts every sow target to the two-tile circle", () => {
    const { cycles, farm } = fixture();
    const area = cycles.farmArea(farm.uid)!;
    expect(area.custom).toBe(false);
    for (let i = 0; i < 6; i++) {
      const work = cycles.findWork(farm);
      if (!work) break;
      expect(inFarmRange(farm, work.target)).toBe(true);
      expect(cycles.complete(farm, work.target).success).toBe(true);
    }
    expect(cycles.snapshot().length).toBeGreaterThan(0);
    expect(cycles.snapshot().length).toBeLessThanOrEqual(6);
  });
  it("rejects obsolete assigned bounds and always retains the automatic circle", () => {
    const { cycles, farm } = fixture();
    const x = Math.floor(farm.access.x),
      z = Math.floor(farm.access.z) + 1;
    expect(cycles.setFarmArea(farm.uid, { minX: x, minZ: z, maxX: x, maxZ: z })).toBe(false);
    expect(cycles.farmArea(farm.uid)?.custom).toBe(false);
    expect(cycles.setFarmArea(farm.uid, null)).toBe(true);
    expect(cycles.findWork(farm)?.stage).toBe("sow");
  });
  it("automatically harvests mature patches before sowing elsewhere", () => {
    const { cycles, farm, target } = fixture();
    const x = Math.floor(farm.access.x),
      z = Math.floor(farm.access.z);
    const old = target(x - 1, z),
      next = target(x, z + 2);
    expect(cycles.complete(farm, old).success).toBe(true);
    expect(cycles.complete(farm, next).success).toBe(true);
    expect(cycles.setFarmArea(farm.uid, { minX: x + 1, minZ: z, maxX: x + 1, maxZ: z })).toBe(
      false
    );
    cycles.update(120);
    expect(cycles.findWork(farm)?.target.id).toBe(old.id);
    expect(cycles.findWork(farm)?.stage).toBe("harvest");
    expect(cycles.complete(farm, old)).toEqual({ success: true, ware: "grain" });
    expect(cycles.findWork(farm)?.target.id).toBe(next.id);
  });
  it("rechecks newly blocked sow terrain and neighboring tree/crop reservations", () => {
    const { context, cycles, farm, target } = fixture();
    const x = Math.floor(farm.access.x),
      z = Math.floor(farm.access.z) + 1;
    const seed = target(x, z);
    context.reservations.add(`plant:${seed.id + 1}`);
    expect(cycles.findWork(farm)?.target.id).not.toBe(seed.id);
    expect(cycles.complete(farm, seed).success).toBe(false);
    context.reservations.clear();
    context.options.world.blocking[seed.id] = 3;
    expect(cycles.complete(farm, seed).success).toBe(false);
    context.options.world.blocking[seed.id] = 0;
    context.reservations.add(`field:${seed.id}`);
    expect(cycles.complete(farm, seed).success).toBe(true);
  });
  it("filters stonemason targets by selected bounds and twenty-four-tile entrance distance", () => {
    const { context } = fixture(),
      stone = makeBuilding(context, BuildingType.Quarry, 20, 20, 0);
    context.buildings.push(stone);
    const origin = stone.access;
    context.options.resourceTargets = () => [
      { id: 1, kind: "stone", x: origin.x + 1, z: origin.z },
      { id: 2, kind: "stone", x: origin.x + 5, z: origin.z },
      { id: 3, kind: "stone", x: origin.x + STONEMASON_RADIUS + 0.1, z: origin.z }
    ];
    expect(findWorkTarget(context, stone, "stone")?.target.id).toBe(1);
    const x = Math.floor(origin.x + 5),
      z = Math.floor(origin.z);
    expect(setStoneArea(context, stone.uid, { minX: x, minZ: z, maxX: x, maxZ: z })).toBe(true);
    expect(findWorkTarget(context, stone, "stone")?.target.id).toBe(2);
    expect(
      consumeWorkTarget(context, { id: 1, kind: "stone", x: origin.x + 1, z: origin.z }, stone)
    ).toBe(false);
    expect(context.resourceAmounts.has("stone:1")).toBe(false);
    expect(stoneArea(context, stone.uid)?.custom).toBe(true);
    expect(setStoneArea(context, stone.uid, { minX: x + 20, minZ: z, maxX: x + 20, maxZ: z })).toBe(
      false
    );
    expect(setStoneArea(context, stone.uid, null)).toBe(true);
    expect(findWorkTarget(context, stone, "stone")?.target.id).toBe(1);
  });
  it("serves all selected areas from one building-aware radius table", () => {
    const { context } = fixture();
    const at = (typeId: number) => makeBuilding(context, typeId, 10, 10, 0);
    expect(buildingAreaRange(at(45))).toMatchObject({ center: { x: 10, z: 10 }, radius: 24 });
    expect(buildingAreaRange(at(46))).toMatchObject({ center: { x: 10, z: 10 }, radius: 24 });
    expect(buildingAreaRange(at(47))?.center).toEqual(at(47).access);
    expect(buildingAreaRange(at(7))).toBeNull();
    expect(buildingAreaRange(at(5), "roman")?.radius).toBe(8);
    expect(buildingAreaRange(at(5), "nubian")?.radius).toBe(6);
    expect(buildingAreaRange(at(5), "viking")?.radius).toBe(5);
    expect(buildingAreaRange(at(27))?.radius).toBe(8);
    expect(buildingAreaRange(at(3))?.radius).toBe(10);
    expect(buildingAreaRange(at(14))?.radius).toBe(LOOKOUT_SIGHT_RADIUS);
    expect(buildingAreaRange(at(0))?.radius).toBe(48);
    expect(buildingAreaRange(at(1))?.radius).toBe(20);
    expect(buildingAreaRange(at(2))?.radius).toBe(29);
    expect(buildingAreaRange(at(4))?.radius).toBe(39);
    expect(buildingAreaRange(at(9))?.radius).toBe(53);
    const harbour = at(39);
    expect(buildingAreaRange(harbour)).toBeNull();
    harbour.foundedByExpedition = true;
    expect(buildingAreaRange(harbour)?.radius).toBe(24);
  });

  it("uses matching worker circles, with the hunter reaching fifty percent farther", () => {
    for (const typeId of [BuildingType.Woodcutter, BuildingType.Fishery, BuildingType.Quarry, BuildingType.Forester]) expect(buildingWorkRadius(typeId)).toBe(24);
    for (const kind of ["tree", "stone", "fish", "plant"])
      expect(resourceWorkRadius(kind)).toBe(24);
    expect(buildingWorkRadius(BuildingType.Hunter)).toBe(36);
    expect(resourceWorkRadius("wildlife")).toBe(36);
    expect(buildingWorkRadius(BuildingType.Farm)).toBe(8);
    const { context } = fixture();
    const hunter = makeBuilding(context, BuildingType.Hunter, 7, 7, 0);
    context.buildings.push(hunter);
    let offered: ResourceTarget[] = [
      { id: 1, kind: "wildlife", x: 33, z: 31 },
      { id: 2, kind: "wildlife", x: 35, z: 33 }
    ];
    context.options.resourceTargets = (kind, origin, range) => {
      expect(kind).toBe("wildlife");
      expect(origin).toBe(hunter);
      expect(range).toBe(36);
      return offered;
    };
    expect(findWorkTarget(context, hunter, "wildlife")?.target.id).toBe(1);
    offered = [offered[1]!];
    expect(findWorkTarget(context, hunter, "wildlife")).toBeNull();
  });
  it("allows quarry and woodcutter work out to twenty-four cells", () => {
    const { context } = fixture();
    for (const [typeId, kind] of [
      [BuildingType.Quarry, "stone"],
      [BuildingType.Woodcutter, "tree"]
    ] as const) {
      const building = makeBuilding(context, typeId, 28, 15, 0);
      context.buildings.push(building);
      const origin = kind === "stone" ? building.access : building;
      let offered: ResourceTarget[] = [
        { id: 1, kind, x: origin.x - 23, z: origin.z },
        { id: 2, kind, x: origin.x - 24.1, z: origin.z }
      ];
      context.options.resourceTargets = (_kind, _origin, range) => {
        expect(range).toBe(24);
        return offered;
      };
      expect(findWorkTarget(context, building, kind)?.target.id).toBe(1);
      offered = [offered[1]!];
      expect(findWorkTarget(context, building, kind)).toBeNull();
    }
  });
  it("a recruited stonemason switches work targets, rejects an unpaid old target, and delivers extracted stone", () => {
    const { context } = fixture();
    let simulation: ReturnType<typeof createSettlementSimulation>;
    const roads = createRoadNetwork(context.options.world, {
      isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
    });
    const targets: ResourceTarget[] = [],
      extracted: number[] = [];
    simulation = createSettlementSimulation({
      world: context.options.world,
      roads,
      initialStock: { planks: 80, stone: 60, hammer: 4, pickaxe: 1 },
      resourceTargets: (kind) => (kind === "stone" ? targets : undefined),
      consumeResource: (target) => {
        if (target.kind !== "stone") return undefined;
        extracted.push(target.id);
        return true;
      }
    });
    const [w, d] = getBuildingDefinition(BuildingType.Quarry).gridFootprint;
    const quarry = simulation.placeBuilding(
      BuildingType.Quarry,
      Math.floor(14 - w / 2) + w / 2,
      Math.floor(12 - d / 2) + d / 2
    ).building!;
    expect(simulation.connectRoads(simulation.headquarters.access, quarry.access)).toBe(true);
    targets.push(
      { id: 1, kind: "stone", x: quarry.access.x - 3, z: quarry.access.z + 2 },
      { id: 2, kind: "stone", x: quarry.access.x + 3, z: quarry.access.z + 2 },
      { id: 3, kind: "stone", x: quarry.access.x + 8.1, z: quarry.access.z }
    );
    const bounds = (index: number) => {
      const target = targets[index]!;
      const x = Math.floor(target.x),
        z = Math.floor(target.z);
      return { minX: x, minZ: z, maxX: x, maxZ: z };
    };
    expect(simulation.setStoneArea(quarry.uid, bounds(0))).toBe(true);
    for (
      let i = 0;
      i < 6000 && !simulation.frames().some((a) => a.job === "Stonemason" && a.phase === "work");
      i++
    )
      simulation.update(0.05);
    const mason = simulation.frames().find((a) => a.job === "Stonemason")!;
    expect(mason.target?.id).toBe(1);
    expect(mason.phase).toBe("work");
    expect(simulation.setStoneArea(quarry.uid, bounds(1))).toBe(true);
    for (let i = 0; i < 6000 && mason.ware !== "stone"; i++) simulation.update(0.05);
    expect(extracted).toEqual([2]);
    expect(mason.ware).toBe("stone");
    expect(
      Math.hypot(mason.target!.x - quarry.access.x, mason.target!.z - quarry.access.z)
    ).toBeLessThanOrEqual(8);
    expect(simulation.setStoneArea(quarry.uid, bounds(0))).toBe(true);
    for (let i = 0; i < 3000 && (quarry.output.stone ?? 0) === 0; i++) simulation.update(0.05);
    expect(quarry.output.stone).toBe(1);
    for (let i = 0; i < 6000 && !extracted.includes(1); i++) simulation.update(0.05);
    expect(extracted).toEqual([2, 1]);
    expect(extracted).not.toContain(3);
  });
  it("a Japanese rice farmer sows and harvests rice paddies instead of idling in the field", () => {
    const { world } = fixture();
    let simulation: ReturnType<typeof createSettlementSimulation>;
    const roads = createRoadNetwork(world, {
      isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
    });
    simulation = createSettlementSimulation({
      playerNation: "japanese",
      world,
      roads,
      initialStock: { hammer: 4, planks: 80, scythe: 1, stone: 60 }
    });
    const [w, d] = getBuildingDefinition(5).gridFootprint;
    const farm = simulation.placeBuilding(
      5,
      Math.floor(14 - w / 2) + w / 2,
      Math.floor(12 - d / 2) + d / 2
    ).building!;
    expect(farm).toBeDefined();
    expect(simulation.connectRoads(simulation.headquarters.access, farm.access)).toBe(true);
    let sawSowing = false, sawHarvest = false;
    for (let i = 0; i < 12_000 && !(sawSowing && sawHarvest); i++) {
      simulation.update(.05);
      const farmer = simulation.frames().find(actor => actor.job === "Rice farmer" && actor.action === "work");
      if (farmer?.fieldWork === "sow") {
        sawSowing = true;
        expect(farmer.ware).toBeNull();
      }
      if (farmer?.fieldWork === "harvest") {
        sawHarvest = true;
        expect(simulation.fieldFrames().find(site => site.id === farmer.target?.id)?.kind).toBe("rice");
      }
    }
    expect(sawSowing).toBe(true);
    expect(sawHarvest).toBe(true);
  });

  it("a real recruited farmer sows multiple patches and harvests only mature wheat before depositing grain", () => {
    const { context } = fixture();
    let simulation: ReturnType<typeof createSettlementSimulation>;
    const roads = createRoadNetwork(context.options.world, {
      isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false
    });
    simulation = createSettlementSimulation({
      world: context.options.world,
      roads,
      initialStock: { planks: 80, stone: 60, hammer: 4, scythe: 1 }
    });
    const [w, d] = getBuildingDefinition(37).gridFootprint;
    const farm = simulation.placeBuilding(
      37,
      Math.floor(14 - w / 2) + w / 2,
      Math.floor(12 - d / 2) + d / 2
    ).building!;
    expect(farm).toBeDefined();
    expect(simulation.connectRoads(simulation.headquarters.access, farm.access)).toBe(true);
    let carried = false,
      maximumGrowing = 0,
      sawSowing = false,
      sawHarvest = false;
    for (let i = 0; i < 9000; i++) {
      simulation.update(0.05);
      maximumGrowing = Math.max(
        maximumGrowing,
        simulation.fieldFrames().filter((site) => site.state === "growing").length
      );
      const farmer = simulation
        .frames()
        .find((actor) => actor.job === "Farmer" && actor.action === "work");
      if (farmer?.fieldWork === "sow") {
        sawSowing = true;
        expect(farmer.ware).toBeNull();
      }
      if (farmer?.fieldWork === "harvest") {
        sawHarvest = true;
        const site = simulation.fieldFrames().find((site) => site.id === farmer.target?.id);
        expect(site?.state).toBe("ripe");
        expect(site?.progress).toBe(1);
      }
      carried ||= simulation
        .frames()
        .some((a) => a.job === "Farmer" && a.ware === "grain" && a.visible);
      if ((simulation.headquarters.inventory.grain ?? 0) + (farm.output.grain ?? 0) > 0) break;
    }
    expect(carried).toBe(true);
    expect(maximumGrowing).toBeGreaterThanOrEqual(2);
    expect(sawSowing).toBe(true);
    expect(sawHarvest).toBe(true);
    expect(simulation.fieldFrames().every((site) => inFarmRange(farm, site))).toBe(true);
    expect(
      (simulation.headquarters.inventory.grain ?? 0) + (farm.output.grain ?? 0)
    ).toBeGreaterThan(0);
    expect(simulation.headquarters.inventory.scythe).toBe(0);
  });
});

it("plants crops on dry Flag-grade soil without requiring space for another house", () => {
  const { context, cycles, farm, world } = fixture();
  world.buildClass.fill(BUILD.none);
  for (let z = 0; z < world.cellsZ; z++)
    for (let x = 0; x < world.cellsX; x++)
      if (Math.hypot(x + 0.5 - farm.access.x, z + 0.5 - farm.access.z) <= 7)
        world.buildClass[z * world.cellsX + x] = BUILD.flag;
  for (let z = farm.z - farm.depth / 2; z < farm.z + farm.depth / 2; z++)
    for (let x = farm.x - farm.width / 2; x < farm.x + farm.width / 2; x++)
      context.occupied[Math.floor(z) * world.cellsX + Math.floor(x)] = 1;
  const work = cycles.findWork(farm);
  expect(work).not.toBeNull();
  expect(inFarmRange(farm, work!.target)).toBe(true);
  expect(
    Math.hypot(work!.target.x - farm.access.x, work!.target.z - farm.access.z)
  ).toBeLessThanOrEqual(7);
  expect(context.occupied[work!.target.id]).toBe(0);
  expect(cycles.complete(farm, work!.target)).toEqual({ success: true });
  cycles.update(120);
  const harvest = cycles.findWork(farm);
  expect(harvest?.stage).toBe("harvest");
  expect(cycles.complete(farm, harvest!.target)).toEqual({ success: true, ware: "grain" });
  world.buildClass.fill(BUILD.none);
  expect(cycles.findWork(farm)).toBeNull();
});
