import { describe, expect, it } from "vitest";

import { appendProp } from "../src/shared/world/editing/prop-set";
import { transformGeneratedFeature } from "../src/shared/world/editing/terrain/generated-feature-transform";
import { extractTerrainComponent } from "../src/shared/world/editing/terrain/terrain-component";
import { createTerrainEditState } from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { PROP, PROP_REMOVED, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const SIZE = 64;
const STRIDE = SIZE + 1;
const GROUND = 10;

let original: WorldData | undefined;
/** Flat dry ground with a cone relief (1 high, radius 4) at (22, 22). */
const coneWorld = () => {
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
  world.lakeWater?.fill(0);
  world.roadGradeApplied = undefined;
  world.roadGradeBase = undefined;
  world.settlementGroundClearance?.fill(0);
  world.scenario = undefined;
  world.colonyStoneDeposits = undefined;
  world.authoredRivers = undefined;
  world.generatedRivers = undefined;
  for (let z = 18; z <= 26; z++)
    for (let x = 18; x <= 26; x++)
      world.heights[z * STRIDE + x] = GROUND + Math.max(0, 1 - Math.hypot(x - 22, z - 22) / 4);
  const selection = extractTerrainComponent(world, { x: 22.5, z: 22.5 }, "relief", GROUND + 0.1)!;
  return { selection, world };
};

const addProp = (world: WorldData, type: number, x: number, z: number) =>
  appendProp(world.props, {
    type,
    x,
    z,
    y: GROUND,
    form: 0,
    scale: 1,
    rotation: 0.3,
    phase: 0.2
  });

const move = (world: WorldData, selection: ReturnType<typeof coneWorld>["selection"], x: number) =>
  transformGeneratedFeature(world, createTerrainEditState(), selection, {
    offsetX: x,
    offsetZ: 0,
    scale: 1
  });

describe("unrelated props at the destination", () => {
  it("re-grounds unrelated props on the landed relief and re-seats one in the way", () => {
    const { selection, world } = coneWorld();
    const carried = addProp(world, PROP.largeRock, 22.5, 22.5);
    const blocking = addProp(world, PROP.hardwoodTree, 38.5, 22.5);
    const standing = addProp(world, PROP.largeRock, 40.5, 24.5);
    const scale = world.props.scale[blocking];
    const result = move(world, selection, 16);
    expect(result.reseated).toBe(1);
    expect(result.moved).toEqual(expect.arrayContaining([carried, blocking, standing]));
    expect(world.props.x[carried]).toBeCloseTo(38.5);
    // The tree under the landing rock moves to the nearest free spot, keeping its identity.
    expect(world.props.types[blocking]).toBe(PROP.hardwoodTree);
    expect(world.props.scale[blocking]).toBe(scale);
    const shift = Math.hypot(world.props.x[blocking]! - 38.5, world.props.z[blocking]! - 22.5);
    expect(shift).toBeGreaterThan(0);
    expect(shift).toBeLessThan(3);
    // The rock off the summit stays and follows the raised ground.
    expect(world.props.x[standing]).toBe(40.5);
    expect(world.props.y[standing]).toBeGreaterThan(GROUND);
  });

  it("refuses a water plant in the way without water nearby", () => {
    const { selection, world } = coneWorld();
    addProp(world, PROP.waterLily, 38.5, 22.5);
    const before = world.heights.slice();
    expect(() => move(world, selection, 16)).toThrow(/No free spot nearby/);
    expect(world.heights).toEqual(before);
  });
});

describe("carried props without a valid landing", () => {
  it("drops a carried tree that would land in the sea to the nearest dry spot", () => {
    const { world } = coneWorld();
    // Lower the land to 0.6 above the sea, with open sea from x = 30 to the east edge.
    for (let vertex = 0; vertex < world.heights.length; vertex++) {
      const x = vertex % STRIDE;
      world.heights[vertex] = x >= 30 ? -0.4 : world.heights[vertex]! - GROUND + 0.6;
      world.waterDepth[vertex] = Math.max(0, world.seaLevel - world.heights[vertex]!);
    }
    const selection = extractTerrainComponent(world, { x: 22.5, z: 22.5 }, "relief", 0.7)!;
    const tree = addProp(world, PROP.hardwoodTree, 25.5, 22.5);
    const result = move(world, selection, 8);
    expect(result.moved).toContain(tree);
    expect(world.props.types[tree]).toBe(PROP.hardwoodTree);
    const x = world.props.x[tree]!,
      z = world.props.z[tree]!;
    expect(x === 33.5 && z === 22.5).toBe(false);
    expect(Math.hypot(x - 33.5, z - 22.5)).toBeLessThan(6);
    expect(world.waterDepth[Math.round(z) * STRIDE + Math.round(x)]).toBe(0);
  });
});

describe("map border", () => {
  it("clamps a move past the border to the nearest offset that fits", () => {
    const { selection, world } = coneWorld();
    const result = move(world, selection, 60);
    expect(result.clamped).toBe(true);
    expect(result.offsetX).toBeLessThan(60);
    expect(world.heights[22 * STRIDE + 22 + result.offsetX]).toBeCloseTo(GROUND + 0.9);
  });

  it("refuses a size that cannot fit inside the map", () => {
    const { selection, world } = coneWorld();
    selection.cells = [];
    for (let z = 1; z < 63; z++) for (let x = 1; x < 63; x++) selection.cells.push(z * SIZE + x);
    expect(() =>
      transformGeneratedFeature(world, createTerrainEditState(), selection, {
        offsetX: 0,
        offsetZ: 0,
        scale: 1.5
      })
    ).toThrow(/no longer fits inside the map/);
  });
});
