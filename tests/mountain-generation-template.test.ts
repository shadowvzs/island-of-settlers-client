import { describe, expect, it } from "vitest";

import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld, freshWorldBeforeAll, preloadWorlds } from "./helpers/cached-worlds";

const options = { ...DEFAULT_WORLD_OPTIONS, cellsX: 256, cellsZ: 256, seed: 1234 };
const SMALL_MAPS = [{ cellsX: 64, cellsZ: 64 }, { cellsX: 96, cellsZ: 96, mountains: 0 }]
  .map(overrides => ({ ...options, ...overrides }));
describe("processed relief in generated inland mountains", () => {
  const freshShaped = freshWorldBeforeAll(options);
  preloadWorlds(options, { ...options, mountainProfiles: false },
    ...SMALL_MAPS.flatMap(selected => [selected, { ...selected, mountainProfiles: false }]));
  it("changes actual cliffs deterministically while preserving shores, rivers, deposits and usable land", () => {
    const legacy = cachedWorld({ ...options, mountainProfiles: false }), shaped = cachedWorld(options);
    expect(shaped.heights).toEqual(freshShaped().heights);
    expect(shaped.mineZones).toEqual(legacy.mineZones); expect(shaped.mineZone).toEqual(legacy.mineZone);
    expect(shaped.oreAmount).toEqual(legacy.oreAmount); expect(shaped.waterDepth).toEqual(legacy.waterDepth);
    expect(shaped.waterSurface).toEqual(legacy.waterSurface); expect(shaped.start).toEqual(legacy.start);
    expect(shaped.props.x).toEqual(legacy.props.x); expect(shaped.props.z).toEqual(legacy.props.z);
    let changed = 0;
    shaped.heights.forEach((height, vertex) => {
      if (height === legacy.heights[vertex]) return;
      changed++;
      expect(Number.isFinite(height)).toBe(true);
      expect(height - legacy.heights[vertex]!).toBeGreaterThan(0);
      expect(height - legacy.heights[vertex]!).toBeLessThanOrEqual(.65 + 1e-5);
      expect(shaped.coastDistance[vertex]).toBeGreaterThanOrEqual(10);
      expect(shaped.riverDistance[vertex]).toBeGreaterThanOrEqual(8);
    });
    expect(changed).toBeGreaterThan(30);
    for (let cell = 0; cell < legacy.walkCost.length; cell++) {
      if (!legacy.walkCost[cell]) continue;
      expect(shaped.walkCost[cell]).toBe(legacy.walkCost[cell]);
      const x = cell % 256, z = Math.floor(cell / 256), vertex = z * 257 + x;
      for (const index of [vertex, vertex + 1, vertex + 257, vertex + 258])
        expect(shaped.heights[index]).toBe(legacy.heights[index]);
    }
  });
  it("keeps scarce small-map land and mountain-free maps unchanged", () => {
    for (const selected of SMALL_MAPS) {
      expect(cachedWorld(selected).heights).toEqual(cachedWorld({ ...selected, mountainProfiles: false }).heights);
    }
  });
});
