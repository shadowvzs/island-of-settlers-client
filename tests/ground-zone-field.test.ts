import { describe, expect, it } from "vitest";

import {
  buildGroundZoneField, getGroundZoneField, refreshGroundZoneField
} from "../src/render-common/ground-zone-field";
import { paintGround } from "../src/shared/world/editing/ground-paint";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../src/shared/world/generation/generate-world";
import { unionRegions } from "../src/shared/world/grid-geometry";
import { MATERIAL } from "../src/shared/world/world-data";

describe("ground zone field (mountain foot, dune zone)", () => {
  it("patches only around an edit and matches a whole-map rebuild", () => {
    const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, seed: 5 });
    const cached = getGroundZoneField(world);
    const before = cached.slice();
    const rock = paintGround(world, { material: MATERIAL.rock, radius: 3, softness: 0.4, strength: 1, x: 48, z: 48 });
    const sand = paintGround(world, { material: MATERIAL.sand, radius: 2, softness: 0.4, strength: 1, x: 20, z: 70 });
    refreshGroundZoneField(world, unionRegions(rock.cells, sand.cells));
    expect(getGroundZoneField(world)).toBe(cached);
    expect(cached).toEqual(buildGroundZoneField(world));
    expect(cached).not.toEqual(before);
  });

  it("ignores an empty region and a world without a cached field", () => {
    const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 48, cellsZ: 48, seed: 7 });
    expect(() => refreshGroundZoneField(world, { maxX: 10, maxZ: 10, minX: 2, minZ: 2 })).not.toThrow();
    const cached = getGroundZoneField(world).slice();
    refreshGroundZoneField(world, { maxX: -1, maxZ: -1, minX: 0, minZ: 0 });
    expect(getGroundZoneField(world)).toEqual(cached);
  });
});
