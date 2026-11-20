import { describe, expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { buildFieldCoverInstances } from "../src/render-common/props/field-cover";
import { CHUNK_CELLS, listRegionChunks } from "../src/render-common/terrain-chunks";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { alignRegion, EMPTY_REGION } from "../src/shared/world/grid-geometry";
import { cachedWorld } from "./helpers/cached-worlds";

const SMALL = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 8000 };
const GRID = { cellsX: 96, cellsZ: 96 };
const keys = (chunks: { chunkX: number; chunkZ: number }[]) =>
  chunks.map(({ chunkX, chunkZ }) => `${chunkX},${chunkZ}`).sort();

describe("map editor chunk touch", () => {
  it("lists the chunk of a region inside one chunk", () => {
    const region = { maxX: 40, maxZ: 40, minX: 36, minZ: 36 };
    expect(keys(listRegionChunks(GRID, region))).toEqual(["1,1"]);
  });

  it("includes the previous chunk when the region starts on a chunk's first cells", () => {
    const region = { maxX: CHUNK_CELLS + 2, maxZ: 40, minX: CHUNK_CELLS, minZ: 36 };
    expect(keys(listRegionChunks(GRID, region))).toEqual(["0,1", "1,1"]);
  });

  it("clamps to the map and lists nothing for an empty region", () => {
    const region = { maxX: 200, maxZ: 3, minX: 90, minZ: 0 };
    expect(keys(listRegionChunks(GRID, region))).toEqual(["2,0"]);
    expect(listRegionChunks(GRID, EMPTY_REGION)).toEqual([]);
  });

  it("aligns a region to whole culling blocks", () => {
    const region = { maxX: 20, maxZ: 5, minX: 17, minZ: 3 };
    expect(alignRegion(GRID, region, 16)).toEqual({ maxX: 31, maxZ: 15, minX: 16, minZ: 0 });
  });
});

describe("field cover rebuild of a region", () => {
  it("grows the same cover as the whole island build in that region", () => {
    const world = cachedWorld(SMALL);
    const fog = createVertexFog(world);
    const region = { maxX: 63, maxZ: 63, minX: 32, minZ: 32 };
    const inside = (x: number, z: number) => x >= 32 && x < 64 && z >= 32 && z < 64;
    const whole = buildFieldCoverInstances(world, fog, 2);
    const part = buildFieldCoverInstances(world, fog, 2, region);
    const pick = (instances: typeof whole) =>
      Array.from(instances.x, (x, index) => [x, instances.z[index]!] as const)
        .filter(([x, z]) => inside(x, z))
        .map(([x, z]) => `${x.toFixed(3)},${z.toFixed(3)}`)
        .sort();
    expect(part.count).toBeGreaterThan(0);
    expect(pick(part)).toEqual(pick(whole));
  });
});
