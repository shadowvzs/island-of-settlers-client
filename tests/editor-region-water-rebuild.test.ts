import { describe, expect, it, vi } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { createRendererMapEdit } from "../src/render-common/map-edit/map-edit-builds";
import {
  buildWaterWeeds,
  buildWaterWeedsRegion,
  replaceWaterWeedsRegion,
  type WaterWeeds
} from "../src/render-common/water/water-weeds";
import { createWaterField, createWaterFieldPatch, type WaterField } from "../src/render-common/water-field";
import { applyStampChanges } from "../src/shared/world/editing/terrain/terrain-apply";
import {
  addStamp,
  createTerrainEditState,
  lowerStampAt
} from "../src/shared/world/editing/terrain/terrain-edit-state";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import type { CellRegion } from "../src/shared/world/grid-geometry";
import { findOpenSpots, SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld } from "./helpers/cached-worlds";

const expectPatchMatchesFull = (full: WaterField, patch: ReturnType<typeof createWaterFieldPatch>) => {
  expect(patch.width).toBeGreaterThan(0);
  expect(patch.height).toBeGreaterThan(0);
  expect(patch.pixels).toHaveLength(patch.width * patch.height * 4);
  for (let row = 0; row < patch.height; row += 1) {
    const patchRow = patch.pixels.subarray(row * patch.width * 4, (row + 1) * patch.width * 4);
    const fullStart = ((patch.y + row) * full.width + patch.x) * 4;
    expect(patchRow).toEqual(full.pixels.subarray(fullStart, fullStart + patch.width * 4));
  }
};

const expectWaterFieldPatchMatches = (
  world: ReturnType<typeof cachedWorld>,
  fog: Float32Array,
  cells: CellRegion
) => {
  const full = createWaterField(world, fog);
  const patch = createWaterFieldPatch(world, fog, cells);
  expectPatchMatchesFull(full, patch);
  return patch;
};

const isInCells = (weeds: WaterWeeds, index: number, cells: CellRegion) => {
  const x = Math.floor(weeds.placement[index * 4]!);
  const z = Math.floor(weeds.placement[index * 4 + 2]!);
  return x >= cells.minX && x <= cells.maxX && z >= cells.minZ && z <= cells.maxZ;
};

const describeWeeds = (weeds: WaterWeeds, keep: (index: number) => boolean = () => true) =>
  Array.from({ length: weeds.count }, (_, index) => index)
    .filter(keep)
    .map((index) => [
      ...weeds.placement.subarray(index * 4, index * 4 + 4),
      ...weeds.shape.subarray(index * 4, index * 4 + 4),
      ...weeds.flow.subarray(index * 2, index * 2 + 2)
    ]);

describe("regional water field patches", () => {
  it("matches the full field at blur and map edges", () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    const fog = createVertexFog(world);
    const regions: CellRegion[] = [
      { maxX: 0, maxZ: 0, minX: 0, minZ: 0 },
      { maxX: world.cellsX - 1, maxZ: world.cellsZ - 1, minX: world.cellsX - 1, minZ: world.cellsZ - 1 },
      { maxX: 31, maxZ: 34, minX: 28, minZ: 29 },
      { maxX: 3, maxZ: world.cellsZ - 2, minX: 0, minZ: world.cellsZ - 4 }
    ];
    for (const cells of regions) expectWaterFieldPatchMatches(world, fog, cells);
  });

  it("matches the full field after water is added and removed again", () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    const spot = findOpenSpots(world, 1, 24)[0]!;
    const state = createTerrainEditState();
    let applied = applyStampChanges(world, state, [
      addStamp(state, spot, 3, 7, { kind: "lake" })
    ]);
    expect(applied.waterChanged).toBe(true);
    const fog = createVertexFog(world);
    expectWaterFieldPatchMatches(world, fog, applied.cells);

    let lowered = false;
    let change = lowerStampAt(state, spot.x, spot.z, "lake");
    while (change) {
      applied = applyStampChanges(world, state, [change]);
      expect(applied.waterChanged).toBe(true);
      expectWaterFieldPatchMatches(world, fog, applied.cells);
      lowered = true;
      change = lowerStampAt(state, spot.x, spot.z, "lake");
    }
    expect(lowered).toBe(true);
    expect(world.waterDepth[Math.floor(spot.z) * (world.cellsX + 1) + Math.floor(spot.x)]).toBe(0);
  });

  it("clamps patch bounds to the field and uses cell-texel coordinates", () => {
    const world = cachedWorld(SMALL_EDITOR_WORLD);
    const fog = createVertexFog(world);
    expect(createWaterFieldPatch(world, fog, { maxX: 2, maxZ: 1, minX: -4, minZ: -3 }))
      .toMatchObject({ height: 8, width: 12, x: 0, y: 0 });
    expect(createWaterFieldPatch(world, fog, { maxX: 7, maxZ: 9, minX: 5, minZ: 6 }))
      .toMatchObject({ height: 16, width: 12, x: 20, y: 24 });
    expect(createWaterFieldPatch(world, fog, {
      maxX: world.cellsX + 4, maxZ: world.cellsZ + 4,
      minX: world.cellsX - 2, minZ: world.cellsZ - 2
    })).toMatchObject({ height: 8, width: 8, x: (world.cellsX - 2) * 4, y: (world.cellsZ - 2) * 4 });
    const empty = createWaterFieldPatch(world, fog, { maxX: -2, maxZ: -2, minX: -8, minZ: -8 });
    expect(empty).toMatchObject({ height: 0, width: 0, x: 0, y: 0 });
    expect(empty.pixels).toHaveLength(0);
  });
});

describe("map edit application", () => {
  it("uploads the field patch and merges the regional weeds", () => {
    const cells = { maxX: 3, maxZ: 3, minX: 2, minZ: 2 };
    const waterField = {
      height: 2, pixels: new Uint8Array(2 * 2 * 4), width: 2, x: 8, y: 8
    };
    const waterWeeds = {
      count: 0, flow: new Float32Array(0),
      placement: new Float32Array(0), shape: new Float32Array(0)
    };
    const setWaterField = vi.fn(), setWaterFieldPatch = vi.fn();
    const setWaterWeeds = vi.fn(), replaceWaterWeeds = vi.fn();
    const mapEdit = createRendererMapEdit(
      { cellsX: 16, cellsZ: 16 } as never,
      ["terrain"],
      {
        fieldCover: null,
        hideProps: vi.fn(),
        replaceRockChunks: vi.fn(),
        replaceStones: vi.fn(),
        setChunkGround: vi.fn(),
        setPlacedProps: vi.fn(),
        setTerrainChunk: vi.fn(),
        setWaterField,
        setWaterFieldPatch,
        setWaterWeeds,
        replaceWaterWeeds
      }
    );
    mapEdit.applyRegion({
      cells,
      chunks: [],
      placed: [],
      revision: { build: 0, props: 0, terrain: 0 },
      rocks: [],
      waterField,
      waterWeeds
    });
    expect(setWaterFieldPatch).toHaveBeenCalledWith(waterField);
    expect(replaceWaterWeeds).toHaveBeenCalledWith(waterWeeds, cells);
    expect(setWaterField).not.toHaveBeenCalled();
    expect(setWaterWeeds).not.toHaveBeenCalled();
  });
});

describe("regional underwater weeds", () => {
  it("replaces only the edited cells and keeps every untouched clump identical", () => {
    const world = cachedWorld(DEFAULT_WORLD_OPTIONS);
    const fog = createVertexFog(world);
    const before = buildWaterWeeds(world, fog);
    expect(before.count).toBeGreaterThan(0);

    const spot = findOpenSpots(world, 1, 24)[0]!;
    const state = createTerrainEditState();
    const applied = applyStampChanges(world, state, [
      addStamp(state, spot, 3, 7, { kind: "lake" })
    ]);
    const afterFog = createVertexFog(world);
    const regional = buildWaterWeedsRegion(world, afterFog, applied.cells);
    const merged = replaceWaterWeedsRegion(before, regional, applied.cells);
    const full = buildWaterWeeds(world, afterFog);

    expect(describeWeeds(regional)).toEqual(
      describeWeeds(full, (index) => isInCells(full, index, applied.cells))
    );
    expect(describeWeeds(merged, (index) => !isInCells(merged, index, applied.cells))).toEqual(
      describeWeeds(before, (index) => !isInCells(before, index, applied.cells))
    );
    expect(describeWeeds(merged)).toEqual(describeWeeds(full));
  }, 30_000);
});
