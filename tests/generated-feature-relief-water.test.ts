import { describe, expect, it } from "vitest";

import { transformGeneratedFeature } from "../src/shared/world/editing/terrain/generated-feature-transform";
import { extractTerrainComponent } from "../src/shared/world/editing/terrain/terrain-component";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import {
  MATERIAL,
  MATERIAL_COUNT,
  PROP_REMOVED,
  type WorldData
} from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const SIZE = 64;
const STRIDE = SIZE + 1;
const GROUND = 10;

let original: WorldData | undefined;
/** Flat dry ground with a cone relief at (22, 22); vertex hooks shape lakes, bars and the sea. */
const flatWorld = () => {
  original ??= cachedWorld({
    ...DEFAULT_WORLD_OPTIONS,
    cellsX: SIZE,
    cellsZ: SIZE,
    forest: 0,
    mountains: 0,
    rivers: 0,
    erosionDroplets: 0,
    oreCapacity: false
  });
  const world = structuredClone(original);
  world.props.types.fill(PROP_REMOVED);
  world.mineZone.fill(0);
  world.flow.fill(0);
  world.heights.fill(GROUND);
  world.waterSurface.fill(world.seaLevel);
  world.waterDepth.fill(0);
  world.lakeWater ??= new Uint8Array(world.heights.length);
  world.lakeWater.fill(0);
  world.roadGradeApplied = undefined;
  world.roadGradeBase = undefined;
  world.settlementGroundClearance?.fill(0);
  world.scenario = undefined;
  world.colonyStoneDeposits = undefined;
  world.authoredRivers = undefined;
  world.generatedRivers = undefined;
  return world;
};

const vertexOf = (x: number, z: number) => z * STRIDE + x;

const setWater = (world: WorldData, vertex: number, surface: number, lake = false) => {
  world.waterSurface[vertex] = surface;
  world.waterDepth[vertex] = Math.max(0, surface - world.heights[vertex]!);
  world.lakeWater![vertex] = lake ? 1 : 0;
};

const PLANE = GROUND + 0.5;
const LAKE_SURFACE = GROUND + 2;

/** A cone (3 high, radius 7) with a still crater lake whose bed dips below the selected contour. */
const lakeOnRelief = () => {
  const world = flatWorld();
  for (let z = 12; z <= 32; z++)
    for (let x = 12; x <= 32; x++)
      world.heights[vertexOf(x, z)] = GROUND + 3 * Math.max(0, 1 - Math.hypot(x - 22, z - 22) / 7);
  const lake: number[] = [];
  for (let z = 21; z <= 23; z++) for (let x = 21; x <= 23; x++) lake.push(vertexOf(x, z));
  for (const vertex of lake) world.heights[vertex] = GROUND + 0.2;
  for (const vertex of lake) setWater(world, vertex, LAKE_SURFACE, true);
  const selection = extractTerrainComponent(world, { x: 22.5, z: 25.5 }, "relief", PLANE)!;
  return { lake, selection, world };
};

type Selection = ReturnType<typeof lakeOnRelief>["selection"];

const move = (world: WorldData, selection: Selection, offsetX: number) =>
  transformGeneratedFeature(world, createTerrainEditState(), selection, {
    offsetX,
    offsetZ: 0,
    scale: 1
  });

describe("relief contours carrying a lake", () => {
  it("moves a still lake standing on the relief with its measured depth", () => {
    const { lake, selection, world } = lakeOnRelief();
    move(world, selection, 14);
    for (const vertex of lake) {
      expect(world.waterDepth[vertex]).toBe(0);
      expect(world.lakeWater![vertex]).toBe(0);
      // The relief above the contour lands on the ground below it, half a unit lower.
      expect(world.waterSurface[vertex + 14]).toBeCloseTo(LAKE_SURFACE - (PLANE - GROUND), 4);
      expect(world.waterDepth[vertex + 14]).toBeCloseTo(LAKE_SURFACE - GROUND - 0.2, 4);
      expect(world.lakeWater![vertex + 14]).toBe(1);
    }
  });

  it("moves the lake's sand shore paint with it", () => {
    const { lake, selection, world } = lakeOnRelief();
    const paint = (vertex: number, material: number) => {
      world.splat.fill(0, vertex * MATERIAL_COUNT, (vertex + 1) * MATERIAL_COUNT);
      world.splat[vertex * MATERIAL_COUNT + material] = 255;
    };
    for (let vertex = 0; vertex < world.heights.length; vertex++) paint(vertex, MATERIAL.grass);
    for (const vertex of lake) paint(vertex, MATERIAL.sand);
    move(world, selection, 14);
    for (const vertex of lake) {
      expect(world.splat[(vertex + 14) * MATERIAL_COUNT + MATERIAL.sand]).toBe(255);
      expect(world.splat[vertex * MATERIAL_COUNT + MATERIAL.grass]).toBe(255);
    }
  });

  it("lowers the lake level with lower destination ground and keeps its depths", () => {
    const { lake, selection, world } = lakeOnRelief();
    for (let z = 0; z <= SIZE; z++)
      for (let x = 33; x <= SIZE; x++) world.heights[vertexOf(x, z)] = GROUND - 0.4;
    move(world, selection, 14);
    for (const vertex of lake) {
      expect(world.waterSurface[vertex + 14]).toBeCloseTo(LAKE_SURFACE - (PLANE - GROUND) - 0.4, 4);
      expect(world.waterDepth[vertex + 14]).toBeCloseTo(LAKE_SURFACE - GROUND - 0.2, 4);
    }
  });

  it("refuses a lake that spills below the selected contour, without changes", () => {
    const { selection, world } = lakeOnRelief();
    world.heights[vertexOf(22, 20)] = GROUND + 0.2;
    const before = world.heights.slice();
    expect(() => move(world, selection, 14)).toThrow(/spills below the selected contour/);
    expect(world.heights).toEqual(before);
  });
});

const SHORE = 0.6;
const SEA_FLOOR = -0.4;

/** Low dry ground (the sea level is 0) with sea water over the given vertices. */
const shoreWorld = (isSea: (x: number, z: number) => boolean) => {
  const world = flatWorld();
  world.heights.fill(SHORE);
  for (let z = 0; z <= SIZE; z++)
    for (let x = 0; x <= SIZE; x++) {
      if (!isSea(x, z)) continue;
      world.heights[vertexOf(x, z)] = SEA_FLOOR;
      setWater(world, vertexOf(x, z), world.seaLevel);
    }
  return world;
};

/** A low cone (1 high, radius 4) at (22, 22) west of a sea open to the east map edge. */
const coneBySea = () => {
  const world = shoreWorld((x) => x >= 30);
  for (let z = 18; z <= 26; z++)
    for (let x = 18; x <= 26; x++)
      world.heights[vertexOf(x, z)] = SHORE + Math.max(0, 1 - Math.hypot(x - 22, z - 22) / 4);
  const selection = extractTerrainComponent(world, { x: 22.5, z: 22.5 }, "relief", SHORE + 0.1)!;
  return { selection, world };
};

describe("relief destinations partly in water", () => {
  it("allows a destination partly in the open sea and keeps the sea level", () => {
    const { selection, world } = coneBySea();
    move(world, selection, 8);
    expect(world.heights[vertexOf(30, 22)]).toBeCloseTo(SEA_FLOOR + 0.9, 5);
    expect(world.waterDepth[vertexOf(30, 22)]).toBe(0);
    expect(world.waterDepth[vertexOf(33, 22)]).toBeGreaterThan(0);
    expect(world.waterSurface[vertexOf(33, 22)]).toBe(world.seaLevel);
  });

  it("refuses a destination that crosses a river or an inland lake", () => {
    const { selection, world } = coneBySea();
    const water = vertexOf(29, 22);
    setWater(world, water, SHORE + 0.3);
    world.flow[water * 2] = 1;
    expect(() => move(world, selection, 6)).toThrow(/crosses a river/);
    world.flow[water * 2] = 0;
    setWater(world, water, SHORE + 0.3, true);
    expect(() => move(world, selection, 6)).toThrow(/overlaps an inland lake/);
  });

  it("refuses a relief that would cut a pool off from the open sea, without changes", () => {
    // A narrow sea channel from x = 30 to the east edge; a north-south bar relief west of it.
    const world = shoreWorld((x, z) => x >= 30 && z >= 21 && z <= 23);
    for (let z = 14; z <= 30; z++)
      for (let x = 20; x <= 24; x++)
        world.heights[vertexOf(x, z)] = SHORE + Math.max(0, 1.2 - Math.abs(x - 22) * 0.5);
    const selection = extractTerrainComponent(world, { x: 22.5, z: 22.5 }, "relief", SHORE + 0.1)!;
    const before = world.heights.slice();
    expect(() => move(world, selection, 12)).toThrow(/cut a pool off from the open sea/);
    expect(world.heights).toEqual(before);
  });
});

/** A flat-topped mesa (height `rise`, radius 3) with vertical sides: its cut edge is a cliff. */
const mesa = (rise: number) => {
  const world = flatWorld();
  for (let z = 18; z <= 26; z++)
    for (let x = 18; x <= 26; x++)
      if (Math.hypot(x - 22, z - 22) <= 3) world.heights[vertexOf(x, z)] = GROUND + rise;
  const selection = extractTerrainComponent(world, { x: 22.5, z: 22.5 }, "relief", GROUND + 0.1)!;
  return { selection, world };
};

describe("steep relief cuts", () => {
  it("blends a steep landed edge into the destination under the slope limit", () => {
    const { selection, world } = mesa(1.6);
    move(world, selection, 16);
    for (let x = 30; x <= 46; x++) {
      const step = Math.abs(world.heights[vertexOf(x, 22)]! - world.heights[vertexOf(x - 1, 22)]!);
      expect(step).toBeLessThanOrEqual(0.66);
    }
    expect(world.heights[vertexOf(38, 22)]).toBeCloseTo(GROUND + 1.5);
  });

  it("refuses a cliff too high to blend within four tiles, without changes", () => {
    const { selection, world } = mesa(5);
    const before = world.heights.slice();
    expect(() => move(world, selection, 16)).toThrow(/too steep to blend/);
    expect(world.heights).toEqual(before);
  });
});
