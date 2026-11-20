import { describe, expect, it, vi } from "vitest";

import { consumeWorkTarget, findWorkTarget } from "../src/shared/settlement/settlement-resources";
import type {
  SettlementBuilding,
  SettlementContext
} from "../src/shared/settlement/settlement-types";
import {
  createPlantedTreeSpecies,
  isTreePlantingTerrain
} from "../src/shared/world/editing/tree-planting";
import { createUniformLayout } from "../src/shared/world/generation/theme-field";
import {
  BLOCKING,
  MATERIAL,
  MATERIAL_COUNT,
  PROP,
  type WorldData
} from "../src/shared/world/world-data";

const fixture = () => {
  const size = 24,
    vertices = (size + 1) ** 2;
  const world = {
    cellsX: size,
    cellsZ: size,
    seed: 42,
    walkCost: new Uint8Array(size ** 2).fill(10),
    blocking: new Uint8Array(size ** 2),
    buildClass: new Uint8Array(size ** 2).fill(4),
    slopeClass: new Uint8Array(size ** 2),
    heights: new Float32Array(vertices).fill(2),
    coastDistance: new Float32Array(vertices).fill(30),
    waterDepth: new Float32Array(vertices),
    riverDistance: new Float32Array(vertices).fill(30),
    moisture: new Uint8Array(vertices).fill(170),
    splat: new Uint8Array(vertices * MATERIAL_COUNT),
    themeWeights: createUniformLayout("meadow")({ grid: { cellsX: size, cellsZ: size } } as never),
    props: {
      count: 0,
      types: new Uint8Array(2),
      x: new Float32Array(2),
      z: new Float32Array(2),
      scale: new Float32Array(2).fill(1)
    }
  } as unknown as WorldData;
  const context = {
    buildings: [],
    options: {
      world,
      roads: { route: () => null },
      findWorkerPath: (_from: unknown, to: unknown) => [to]
    },
    occupied: new Uint8Array(size ** 2),
    reservations: new Set(),
    resourceAmounts: new Map()
  } as unknown as SettlementContext;
  const building = {
    access: { x: 12, z: 12 }, uid: 1, workerApproach: { x: 12, z: 12 }, x: 12, z: 12
  } as SettlementBuilding;
  return { context, world, building };
};

it("rejects still-growing trees from custom providers and rechecks maturity before felling", () => {
  const { building, context } = fixture();
  let mature = false;
  const fell = vi.fn(() => true);
  const target = { id: 0, kind: "tree" as const, x: building.x + 2, z: building.z };
  context.options.resourceTargets = () => [target];
  context.options.canHarvestTree = () => mature;
  context.options.consumeResource = fell;
  expect(findWorkTarget(context, building, "tree")).toBeNull();
  expect(consumeWorkTarget(context, target)).toBe(false);
  expect(fell).not.toHaveBeenCalled();
  mature = true;
  expect(findWorkTarget(context, building, "tree")?.target).toEqual(target);
  mature = false;
  expect(consumeWorkTarget(context, target)).toBe(false);
  expect(fell).not.toHaveBeenCalled();
  mature = true;
  expect(consumeWorkTarget(context, target)).toBe(true);
  expect(fell).toHaveBeenCalledOnce();
});

describe("forester sites and species", () => {
  it("randomizes reachable sites reproducibly instead of always choosing the closest", () => {
    const a = fixture(),
      b = fixture();
    const first = findWorkTarget(a.context, a.building, "plant")!;
    expect(first.target).toEqual(findWorkTarget(b.context, b.building, "plant")!.target);
    expect(Math.hypot(first.target.x - 12, first.target.z - 12)).toBeGreaterThan(2);
    const second = findWorkTarget(a.context, a.building, "plant")!.target;
    expect(second).toEqual(findWorkTarget(b.context, b.building, "plant")!.target);
    expect(second.id).not.toBe(first.target.id);
    expect(Math.hypot(first.target.x - 12, first.target.z - 12)).toBeLessThanOrEqual(10);
  });
  it("leaves logging targeted at the closest mature tree", () => {
    const { building, context, world } = fixture();
    world.props.count = 2;
    world.props.types.fill(PROP.broadleafTree);
    world.props.x.set([16, 13]);
    world.props.z.fill(12);
    expect(findWorkTarget(context, building, "tree")!.target.id).toBe(1);
  });
  it("rejects occupied terrain, roads, nearby foundations, crops and reserved field work", () => {
    const { building, context, world } = fixture();
    const point = { id: 15 * 24 + 15, kind: "plant" as const, x: 15.5, z: 15.5 };
    context.options.resourceTargets = () => [point];
    const target = () => findWorkTarget(context, building, "plant");
    expect(target()).not.toBeNull();
    world.blocking[point.id] = BLOCKING.prop;
    expect(target()).toBeNull();
    world.blocking[point.id] = BLOCKING.free;
    context.occupied[point.id + 1] = 1;
    expect(target()).toBeNull();
    context.occupied[point.id + 1] = 0;
    context.reservations.add(`field:${point.id - 1}`);
    expect(target()).toBeNull();
    context.reservations.clear();
    context.fieldCycles = { isOccupied: () => true } as never;
    expect(target()).toBeNull();
    context.fieldCycles = undefined;
    // A road one cell away reserves its 1.2 stone width over the planting cell's edge.
    context.options.roads.segments = () => [{ end: { x: 17, z: 16 }, start: { x: 14, z: 16 }, tier: "dirt" }];
    expect(target()).toBeNull();
  });
  it("checks sites again before planting and permits cleared cells to be planted again", () => {
    const { building, context, world } = fixture();
    const point = { id: 15 * 24 + 15, kind: "plant" as const, x: 15.5, z: 15.5 };
    const planted = vi.fn(() => true);
    context.options.onPlantTree = planted;
    context.options.resourceTargets = () => [point];
    context.resourceAmounts.set(`plant:${point.id}`, 0);
    expect(findWorkTarget(context, building, "plant")!.target).toEqual(point);
    expect(consumeWorkTarget(context, point)).toBe(true);
    world.blocking[point.id] = BLOCKING.prop;
    expect(consumeWorkTarget(context, point)).toBe(false);
    expect(planted).toHaveBeenCalledTimes(1);
    world.blocking[point.id] = BLOCKING.free;
    expect(consumeWorkTarget(context, point)).toBe(true);
  });
  it("plants palms on sand and conifers on snowy highland using generation species rules", () => {
    const sandy = fixture().world;
    for (let vertex = 0; vertex < (sandy.cellsX + 1) ** 2; vertex++)
      sandy.splat[vertex * MATERIAL_COUNT + MATERIAL.sand] = 255;
    // Warm palms (951951899): temperate meadow sand grows conifers, a warm theme's sand grows palms.
    expect(createPlantedTreeSpecies(sandy)(12.5, 12.5)).toBe(PROP.coniferTree);
    sandy.themeWeights = createUniformLayout("desert")({ grid: { cellsX: 24, cellsZ: 24 } } as never);
    expect(createPlantedTreeSpecies(sandy)(12.5, 12.5)).toBe(PROP.palmTree);
    const snowy = fixture().world;
    snowy.heights.fill(8);
    snowy.themeWeights = createUniformLayout("snowy")({
      grid: { cellsX: 24, cellsZ: 24 }
    } as never);
    const choose = createPlantedTreeSpecies(snowy);
    for (let i = 0; i < 10; i++) expect(choose(12.5, 12.5)).toBe(PROP.coniferTree);
  });
  it("keeps saplings off submerged, cliff, rocky, mine and wet shore ground", () => {
    const { world } = fixture();
    const at = () => isTreePlantingTerrain(world, 12.5, 12.5);
    expect(at()).toBe(true);
    world.waterDepth.fill(0.1);
    expect(at()).toBe(false);
    world.waterDepth.fill(0);
    world.coastDistance.fill(1);
    expect(at()).toBe(false);
    world.coastDistance.fill(30);
    world.slopeClass[12 * 24 + 12] = 3;
    expect(at()).toBe(false);
    world.slopeClass[12 * 24 + 12] = 0;
    for (const material of [MATERIAL.rock, MATERIAL.mine, MATERIAL.gravel]) {
      world.splat[13 * 25 * MATERIAL_COUNT + 13 * MATERIAL_COUNT + material] = 255;
      expect(at()).toBe(false);
      world.splat.fill(0);
    }
    expect(isTreePlantingTerrain(world, -1, 12)).toBe(false);
  });
  it("skips reserved and unreachable random sites", () => {
    const { building, context } = fixture();
    const points = [
      { id: 1, kind: "plant" as const, x: 15.5, z: 15.5 },
      { id: 2, kind: "plant" as const, x: 16.5, z: 15.5 },
      { id: 3, kind: "plant" as const, x: 17.5, z: 15.5 }
    ];
    context.options.resourceTargets = () => [...points];
    context.reservations.add("plant:1");
    context.options.findWorkerPath = (_from, to) => (to.x === 16.5 ? null : [to]);
    expect(findWorkTarget(context, building, "plant")!.target.id).toBe(3);
  });
});
