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
import {
  getFootprintRatio,
  getLevelShape,
  getStampRing,
  getStampRise,
  getTotalRise,
  MAX_MOUNTAIN_LEVEL,
  type TerrainStamp
} from "../src/shared/world/editing/terrain/terrain-stamps";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { isGravelGround } from "../src/shared/world/generation/mine-apron";
import { getDominantMaterial } from "../src/shared/world/ground-buffer";
import {
  BUILD,
  MATERIAL,
  MATERIAL_COUNT,
  NO_MINE_ZONE,
  PROP,
  PROP_REMOVED,
  type WorldData
} from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";
import { listRockNeighbours } from "./mountain-ground";

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 };
const peak = (level: number, x = 0, z = 0): TerrainStamp => ({ id: 1, level, seed: 5, x, z });

/** Whether no cell within `reach` cells of the cell is mine land (the stamp makes its own). */
const isAwayFromMineLand = (world: WorldData, x: number, z: number, reach: number) => {
  for (let dz = -reach; dz <= reach; dz += 1)
    for (let dx = -reach; dx <= reach; dx += 1)
      if (world.mineZone[(z + dz) * world.cellsX + x + dx] !== NO_MINE_ZONE) return false;
  return true;
};

/** A dry, open, flat spot with room for a big mountain around it. */
const findOpenSpot = (world: WorldData) => {
  for (let z = 20; z < world.cellsZ - 20; z += 1) {
    for (let x = 20; x < world.cellsX - 20; x += 1) {
      const cell = z * world.cellsX + x;
      if (world.buildClass[cell] !== BUILD.large) continue;
      const vertex = z * (world.cellsX + 1) + x;
      if (world.riverDistance[vertex]! < 18 || world.coastDistance[vertex]! < 15) continue;
      if (!isAwayFromMineLand(world, x, z, 12)) continue;
      return { x: x + 0.5, z: z + 0.5 };
    }
  }
  throw new Error("no open spot");
};

describe("mountain stamp shapes", () => {
  it("grow wider and higher with every level, a boulder and an outcrop below", () => {
    expect(getStampRise(peak(1), 0, 0)).toBe(0);
    expect(getStampRise(peak(2), 0, 0)).toBeGreaterThan(0.4);
    for (let level = 3; level <= MAX_MOUNTAIN_LEVEL; level += 1) {
      expect(getLevelShape(level).radius).toBeGreaterThan(getLevelShape(level - 1).radius);
      expect(getStampRise(peak(level), 0, 0)).toBeGreaterThan(getStampRise(peak(level - 1), 0, 0));
    }
    const { radius } = getLevelShape(MAX_MOUNTAIN_LEVEL);
    expect(getStampRise(peak(MAX_MOUNTAIN_LEVEL), radius * 1.4, 0)).toBe(0);
  });

  it("have an irregular footprint, not a cone", () => {
    const stamp = peak(5);
    const rises = Array.from({ length: 16 }, (_, step) => {
      const angle = (step / 16) * Math.PI * 2;
      return getStampRise(stamp, Math.cos(angle) * 5, Math.sin(angle) * 5);
    });
    expect(Math.max(...rises) - Math.min(...rises)).toBeGreaterThan(0.2);
  });

  it("merge overlapping mountains smoothly without stacking them", () => {
    const first = peak(5, 0, 0);
    const second = { ...peak(5, 6, 0), id: 2, seed: 9 };
    for (let x = -2; x <= 8; x += 1) {
      const merged = getTotalRise([first, second], x, 0);
      const higher = Math.max(getStampRise(first, x, 0), getStampRise(second, x, 0));
      expect(merged).toBeGreaterThanOrEqual(higher);
      expect(merged).toBeLessThan(higher + 0.25);
    }
  });
});

describe("mountain stamp list", () => {
  it("raises the stamp under a click one level and lowers it with ctrl", () => {
    const state = createTerrainEditState();
    raiseStampAt(state, 10, 10, 1);
    raiseStampAt(state, 10.3, 10, 1);
    raiseStampAt(state, 10, 10.2, 1);
    expect(state.stamps).toHaveLength(1);
    expect(state.stamps[0]!.level).toBe(3);
    lowerStampAt(state, 10, 10);
    expect(state.stamps[0]!.level).toBe(2);
    lowerStampAt(state, 10, 10);
    lowerStampAt(state, 10, 10);
    expect(state.stamps).toHaveLength(0);
    expect(lowerStampAt(state, 10, 10)).toBeNull();
  });

  it("caps the level", () => {
    const state = createTerrainEditState();
    for (let click = 0; click < MAX_MOUNTAIN_LEVEL + 3; click += 1) raiseStampAt(state, 5, 5, 1);
    expect(state.stamps[0]!.level).toBe(MAX_MOUNTAIN_LEVEL);
  });
});

describe("mountain stamps on the world", () => {
  const world = cachedWorld(SMALL);
  const spot = findOpenSpot(world);
  const state = createTerrainEditState();

  it("refuses rivers and deep water", () => {
    const river = [...world.riverDistance.keys()].find(
      (vertex) => world.riverDistance[vertex] === 0
    );
    const deep = [...world.waterDepth.keys()].find((vertex) => world.waterDepth[vertex]! > 3);
    const at = (vertex: number) => ({
      x: vertex % (world.cellsX + 1),
      z: Math.floor(vertex / (world.cellsX + 1))
    });
    if (river !== undefined) {
      const change = addStamp(createTerrainEditState(), at(river), 4, 1);
      expect(checkStampChange(world, createTerrainEditState(), change)).toBe("river");
    }
    const change = addStamp(createTerrainEditState(), at(deep!), 4, 1);
    expect(checkStampChange(world, createTerrainEditState(), change)).toBe("deepWater");
  });

  it("stands a boulder at level 1 and clears the props under it", () => {
    const change = raiseStampAt(state, spot.x, spot.z, 3);
    const applied = applyStampChange(world, state, change);
    expect(applied.added).toHaveLength(1);
    expect(world.props.types[applied.added[0]!]).toBe(PROP.largeRock);
  });

  it("raises a snowy mountain with a gravel ring by level 6 and clears its footprint", () => {
    const vertex = Math.floor(spot.z) * (world.cellsX + 1) + Math.floor(spot.x);
    const before = world.heights[vertex]!;
    let applied = applyStampChange(world, state, raiseStampAt(state, spot.x, spot.z, 3));
    for (let level = 3; level <= MAX_MOUNTAIN_LEVEL; level += 1) {
      applied = applyStampChange(world, state, raiseStampAt(state, spot.x, spot.z, 3));
    }
    expect(state.stamps[0]!.level).toBe(MAX_MOUNTAIN_LEVEL);
    expect(world.heights[vertex]! - before).toBeGreaterThan(5);
    expect(world.splat[vertex * MATERIAL_COUNT + MATERIAL.snow]).toBeGreaterThan(60);
    expect(state.ringCells.size).toBeGreaterThan(20);
    for (const cell of state.ringCells) expect(world.mineZone[cell]).not.toBe(NO_MINE_ZONE);
    const { props } = world;
    for (let index = 0; index < props.count; index += 1) {
      if (props.types[index] === PROP_REMOVED) continue;
      expect(Math.hypot(props.x[index]! - spot.x, props.z[index]! - spot.z)).toBeGreaterThan(2);
    }
    expect(applied.cells.maxX - applied.cells.minX).toBeGreaterThan(20);
  });

  it("lowers back to the ground it rose from and drops the ring", () => {
    const vertex = Math.floor(spot.z) * (world.cellsX + 1) + Math.floor(spot.x);
    for (let level = MAX_MOUNTAIN_LEVEL; level > 0; level -= 1) {
      applyStampChange(world, state, lowerStampAt(state, spot.x, spot.z)!);
    }
    expect(state.stamps).toHaveLength(0);
    expect(world.heights[vertex]).toBeCloseTo(state.base!.heights[vertex]!, 5);
    expect(state.ringCells.size).toBe(0);
  });
});

/** Open ground vertices (no rock face, dry, below the snow line) inside the stamp's footprint. */
const listOpenFootprint = (world: WorldData, stamp: TerrainStamp) => {
  const stride = world.cellsX + 1;
  const open: number[] = [];
  for (let vertex = 0; vertex < world.heights.length; vertex += 1) {
    const ratio = getFootprintRatio(stamp, vertex % stride, Math.floor(vertex / stride));
    if (ratio < 0.95 && isGravelGround(world, world, vertex)) open.push(vertex);
  }
  return open;
};

describe("mountain stamp gravel ring", () => {
  /** Outer edge of the ring (cells beyond the foot) in a direction from the peak. */
  const getRingReach = (stamp: TerrainStamp, angle: number) => {
    const { radius } = getLevelShape(stamp.level);
    let reach = 0;
    for (let distance = radius * 0.5; distance < radius * 2; distance += 0.05) {
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      if (getStampRing(stamp, x, z) > 0.5) reach = distance;
    }
    return reach;
  };

  it("is broken like the generator's apron: thin rims and wider tongues along the foot", () => {
    const stamp = peak(5);
    const reaches = Array.from({ length: 48 }, (_, step) =>
      getRingReach(stamp, (step / 48) * Math.PI * 2)
    );
    const feet = Array.from({ length: 48 }, (_, step) => {
      const angle = (step / 48) * Math.PI * 2;
      let foot = 0;
      for (let distance = 0; distance < 30; distance += 0.05) {
        if (getFootprintRatio(stamp, Math.cos(angle) * distance, Math.sin(angle) * distance) < 1)
          foot = distance;
      }
      return foot;
    });
    const widths = reaches.map((reach, index) => reach - feet[index]!);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths) * 2 + 0.5);
  });
});

describe("mountain stamp apron", () => {
  const world = cachedWorld(SMALL);
  const spot = findOpenSpot(world);
  const state = createTerrainEditState();
  applyStampChange(world, state, raiseStampAt(state, spot.x, spot.z, 3));

  it("turns the open ground between the rocks to mine gravel at levels 2 to 5", () => {
    for (let level = 2; level <= 5; level += 1) {
      applyStampChange(world, state, raiseStampAt(state, spot.x, spot.z, 3));
      const stamp = state.stamps[0]!;
      expect(stamp.level).toBe(level);
      const open = listOpenFootprint(world, stamp);
      expect(open.length).toBeGreaterThan(4);
      for (const vertex of open) {
        expect(getDominantMaterial(world.splat, vertex)).toBe(MATERIAL.mine);
      }
      const stride = world.cellsX + 1;
      const openCells = [...world.mineZone.keys()].filter((cell) => {
        const corner = Math.floor(cell / world.cellsX) * stride + (cell % world.cellsX);
        const corners = [corner, corner + 1, corner + stride, corner + stride + 1];
        return corners.every((vertex) => open.includes(vertex));
      });
      expect(openCells.length).toBeGreaterThan(0);
      for (const cell of openCells) expect(world.mineZone[cell]).not.toBe(NO_MINE_ZONE);
      expect(state.ringCells.size).toBeGreaterThan(level * 4);
      const stampRock = (vertex: number) =>
        getDominantMaterial(world.splat, vertex) === MATERIAL.rock &&
        getFootprintRatio(stamp, vertex % stride, Math.floor(vertex / stride)) < 1;
      const touching = listRockNeighbours(world, stampRock);
      expect(touching.filter(({ material }) => material !== MATERIAL.mine)).toEqual([]);
    }
  });
});
