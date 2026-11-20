import { describe, expect, it } from "vitest";

import {
  applyStampChange,
  checkStampChange
} from "../src/shared/world/editing/terrain/terrain-apply";
import {
  addStamp,
  createTerrainEditState,
  lowerStampAt,
  raiseStampAt
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import { measureLake } from "../src/shared/world/editing/terrain/terrain-lakes";
import { MAX_LAKE_LEVEL } from "../src/shared/world/editing/terrain/terrain-stamps";
import { BLOCKING, BUILD, PROP, type WorldData } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

/** Whether every cell within `reach` cells is large building land (flat, open ground). */
const isOpenAround = (world: WorldData, x: number, z: number, reach: number) => {
  for (let dz = -reach; dz <= reach; dz += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      if (world.buildClass[(z + dz) * world.cellsX + x + dx] !== BUILD.large) return false;
    }
  }
  return true;
};

/** A dry, open, flat spot with room for a big lake around it. */
const findOpenSpot = (world: WorldData) => {
  for (let z = 20; z < world.cellsZ - 20; z += 1) {
    for (let x = 20; x < world.cellsX - 20; x += 1) {
      const vertex = z * (world.cellsX + 1) + x;
      if (!isOpenAround(world, x, z, 2)) continue;
      if (world.riverDistance[vertex]! < 18 || world.coastDistance[vertex]! < 14) continue;
      // The lake must stay fresh at the largest click: an open spot with a low rim can become sea.
      const probe = addStamp(createTerrainEditState(), { x: x + 0.5, z: z + 0.5 }, MAX_LAKE_LEVEL, 4,
        { kind: "lake" }).after!;
      if (measureLake(world, { heights: world.heights, waterSurface: world.waterSurface }, probe).sea) continue;
      return { x: x + 0.5, z: z + 0.5 };
    }
  }
  throw new Error("no open spot");
};

describe("lake surface", () => {
  const grid = { cellsX: 20, cellsZ: 20, seaLevel: 0 };
  const flat = (height: number) => ({
    heights: new Float32Array(21 * 21).fill(height),
    waterSurface: new Float32Array(21 * 21)
  });
  const lake = { id: 1, kind: "lake" as const, level: 2, seed: 3, x: 10, z: 10 };

  it("lies just below the rim on high ground (fresh water)", () => {
    const info = measureLake(grid, flat(2), lake);
    expect(info.sea).toBe(false);
    expect(info.surface).toBeLessThan(2);
    expect(info.surface).toBeGreaterThan(1.8);
  });

  it("becomes sea when it would lie as low as the sea", () => {
    const info = measureLake(grid, flat(0.2), lake);
    expect(info.sea).toBe(true);
    expect(info.surface).toBe(0);
  });
});

describe("lakes on the world", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);
  const spot = findOpenSpot(world);
  const state = createTerrainEditState();
  const vertex = Math.floor(spot.z) * (world.cellsX + 1) + Math.floor(spot.x);
  const cell = Math.floor(spot.z) * world.cellsX + Math.floor(spot.x);
  const ground = world.heights[vertex]!;

  it("digs a fresh pond that blocks building", () => {
    applyStampChange(world, state, raiseStampAt(state, spot.x, spot.z, 4, "lake"));
    expect(world.lakeWater![vertex]).toBe(1);
    expect(world.waterSurface[vertex]).toBeGreaterThan(world.seaLevel);
    expect(world.waterDepth[vertex]).toBeGreaterThan(0.3);
    expect(world.blocking[cell]).toBe(BLOCKING.water);
  });

  it("deepens and widens with every click and grows water plants", () => {
    const depth = world.waterDepth[vertex]!;
    let applied = applyStampChange(world, state, raiseStampAt(state, spot.x, spot.z, 4, "lake"));
    for (let level = 3; level <= MAX_LAKE_LEVEL; level += 1) {
      applied = applyStampChange(world, state, raiseStampAt(state, spot.x, spot.z, 4, "lake"));
    }
    expect(world.waterDepth[vertex]).toBeGreaterThan(depth + 1);
    expect(applied.waterChanged).toBe(true);
    const plants = state.stampProps.get(state.stamps[0]!.id) ?? [];
    const kinds = new Set(plants.map((index) => world.props.types[index]));
    expect(plants.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect([PROP.reeds, PROP.cattail, PROP.waterLily]).toContain(kind);
    }
  });

  it("refuses a lake in the sea", () => {
    const sea = [...world.waterDepth.keys()].find((index) => world.waterDepth[index]! > 2)!;
    const at = { x: sea % (world.cellsX + 1), z: Math.floor(sea / (world.cellsX + 1)) };
    const change = addStamp(createTerrainEditState(), at, 1, 1, { kind: "lake" });
    expect(checkStampChange(world, createTerrainEditState(), change)).toBe("water");
  });

  it("fills back level by level to the dry ground", () => {
    for (let level = MAX_LAKE_LEVEL; level > 0; level -= 1) {
      applyStampChange(world, state, lowerStampAt(state, spot.x, spot.z, "lake")!);
    }
    expect(state.stamps).toHaveLength(0);
    expect(world.heights[vertex]).toBeCloseTo(ground, 5);
    expect(world.lakeWater![vertex]).toBe(0);
    expect(world.waterDepth[vertex]).toBe(0);
  });
});
