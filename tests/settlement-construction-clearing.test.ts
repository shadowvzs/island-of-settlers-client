import { STARTER_STOCK } from "@shared/catalog/balance";
import { describe, expect, it, vi } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { BuildingType } from "../src/shared/settlement/building-type-ids";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { updateWorker } from "../src/shared/settlement/settlement-workers";
import {
  BLOCKING,
  BUILD,
  MATERIAL_COUNT,
  ORE,
  PROP,
  PROP_REMOVED,
  SLOPE,
  type WorldData
} from "../src/shared/world/world-data";

const fixture = (stock = STARTER_STOCK) => {
  const size = 64,
    vertices = (size + 1) ** 2;
  const world = {
    cellsX: size,
    cellsZ: size,
    start: { x: 10.5, z: 10.5 },
    seed: 1,
    heights: new Float32Array(vertices),
    blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    buildCap: new Uint8Array(size ** 2).fill(BUILD.large),
    slopeClass: new Uint8Array(size ** 2),
    splat: new Uint8Array(vertices * MATERIAL_COUNT),
    oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2),
    mineZones: [],
    props: {
      count: 1,
      types: new Uint8Array([PROP.fern, 0, 0, 0]),
      x: new Float32Array([10.5, 0, 0, 0]),
      z: new Float32Array([10.5, 0, 0, 0])
    }
  } as unknown as WorldData;
  const planned = vi.fn();
  const simulation = createSettlementSimulation({
    world,
    roads: createRoadNetwork(world),
    initialStock: { ...stock },
    onBuildingPlanned: planned
  });
  const plot = (typeId: number = BuildingType.Woodcutter, rotation = 0) => {
    const [w, d] = getBuildingDefinition(typeId).gridFootprint;
    const width = rotation % 2 ? d : w,
      depth = rotation % 2 ? w : d;
    const x = 30 + width / 2,
      z = 30 + depth / 2;
    return { width, depth, x, z, left: 30, top: 30 };
  };
  const populate = (width: number, depth: number) => {
    world.props.count = 4;
    world.props.types.set([PROP.broadleafTree, PROP.largeRock, PROP.fern, PROP.bush]);
    world.props.x.set([30, 30 + width - 0.01, 30 + width, 29.99]);
    world.props.z.set([30, 30 + depth - 0.01, 30.5, 30.5]);
    for (const id of [0, 1]) {
      const cell = Math.floor(world.props.z[id]!) * size + Math.floor(world.props.x[id]!);
      world.blocking[cell] = BLOCKING.prop;
      world.buildClass[cell] = BUILD.none;
    }
  };
  return { world, simulation, planned, plot, populate };
};

describe("construction clearing", () => {
  it("clears headquarters too and reports the cleared source IDs once", () => {
    const { planned, simulation, world } = fixture();
    expect(world.props.types[0]).toBe(PROP_REMOVED);
    expect(planned).toHaveBeenCalledTimes(1);
    expect(planned).toHaveBeenCalledWith(simulation.headquarters, [0]);
  });
  it.each([0, 1, 2, 3])(
    "clears only prop positions inside a successful rotated plot (%i)",
    (rotation) => {
      const { planned, plot, populate, simulation, world } = fixture();
      const p = plot(28, rotation);
      populate(p.width, p.depth);
      const result = simulation.placeBuilding(28, p.x, p.z, rotation);
      expect(result.ok, result.reason).toBe(true);
      expect([...world.props.types]).toEqual([PROP_REMOVED, PROP_REMOVED, PROP.fern, PROP.bush]);
      expect(planned).toHaveBeenLastCalledWith(result.building, [0, 1]);
    }
  );
  it.each(["terrain", "funding"])(
    "failed %s validation never clears props or notifies the renderer",
    (reason) => {
      const { planned, plot, populate, simulation, world } = fixture(
        reason === "funding" ? {} : STARTER_STOCK
      );
      const p = plot();
      populate(p.width, p.depth);
      if (reason === "terrain") world.blocking[30 * 64 + 30] = BLOCKING.water;
      const before = [...world.props.types];
      expect(simulation.placeBuilding(BuildingType.Woodcutter, p.x, p.z).ok).toBe(false);
      expect([...world.props.types]).toEqual(before);
      expect(planned).toHaveBeenCalledTimes(1);
    }
  );
  it("accepts usable larger mine yards with one correct deposit and rejects exhausted/wrong ore", () => {
    const { plot, simulation, world } = fixture();
    const p = plot(BuildingType.IronMine);
    const cell = 32 * 64 + 32;
    world.mineZone[cell] = 1;
    world.oreAmount[cell] = 8;
    world.buildCap[cell] = BUILD.mine;
    world.buildClass[cell] = BUILD.mine;
    world.mineZones.push({ id: 1, ore: ORE.iron } as never);
    expect(simulation.validatePlacement(BuildingType.IronMine, p.x, p.z)).toBeNull();
    world.mineZones[0]!.ore = ORE.coal;
    expect(simulation.validatePlacement(BuildingType.IronMine, p.x, p.z)).toContain("mineral");
    world.mineZones[0]!.ore = ORE.iron;
    world.oreAmount[cell] = 0;
    expect(simulation.validatePlacement(BuildingType.IronMine, p.x, p.z)).toContain("mineral");
    world.oreAmount[cell] = 8;
    world.slopeClass[30 * 64 + 30] = SLOPE.cliff;
    expect(simulation.validatePlacement(BuildingType.IronMine, p.x, p.z)).toContain("not buildable");
  });
  it("mining mixed plots depletes only the ore required by the mine", () => {
    const { plot, world } = fixture();
    const context = {
      options: { world, roads:createRoadNetwork(world) },
      actors:[], occupied:new Uint8Array(world.cellsX*world.cellsZ),
      nextBuilding: 0,
      buildings: [],
      reservations: new Set(),
      resourceAmounts: new Map()
    } as unknown as SettlementContext;
    const p = plot(BuildingType.IronMine);
    const building = makeBuilding(context, BuildingType.IronMine, p.x, p.z);
    building.construction = 1;
    context.buildings.push(building);
    const wrongCell = 30 * 64 + 30,
      rightCell = wrongCell + 1;
    world.mineZone[wrongCell] = 1;
    world.mineZone[rightCell] = 2;
    world.mineZones.push({ id: 1, ore: ORE.coal } as never, { id: 2, ore: ORE.iron } as never);
    world.oreAmount[wrongCell] = 8;
    world.oreAmount[rightCell] = 8;
    const actor = {
      uid:0, ...building.doorThreshold, y:building.y, yaw:0, path:[],pathIndex:0,animationTime:0,ware:null,action:"work",home:building.uid,
      building: building.uid,
      phase: "work",
      timer: 0,
      job: "Miner",
      visible: false
    } as SettlementActor;
    context.actors.push(actor);
    updateWorker(context, actor, 0.1);
    expect(world.oreAmount[wrongCell]).toBe(8);
    expect(world.oreAmount[rightCell]).toBe(7);
    expect(actor.ware).toBe("ironOre");
    expect(building.output.ironOre ?? 0).toBe(0);
    for(let step=0;step<200 && !building.output.ironOre;step++)updateWorker(context,actor,.05);
    expect(building.output.ironOre).toBe(1);
    expect(actor.ware).toBeNull();
    world.oreAmount[rightCell] = 0;
    actor.phase = "work";
    actor.timer = 0;
    updateWorker(context, actor, 0.1);
    expect(world.oreAmount[wrongCell]).toBe(8);
    expect(building.output.ironOre).toBe(1);
  });
});
