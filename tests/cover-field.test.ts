import { describe, expect, it } from "vitest";

import { buildCoverField, patchCoverField } from "../src/render-common/props/cover-field";
import { excludeFieldCoverRegion } from "../src/render-common/props/field-cover-exclusions";
import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { MATERIAL, MATERIAL_COUNT } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const COVER_GROUNDS = [MATERIAL.grass, MATERIAL.lushGrass, MATERIAL.forestFloor];

describe("cover-density field", () => {
  const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 4000 });
  const field = buildCoverField(world);

  it("stays in byte range and zero where no cover ground exists", () => {
    expect(field.width).toBe(world.cellsX);
    expect(field.height).toBe(world.cellsZ);
    expect(field.pixels.every((value) => value >= 0 && value <= 255)).toBe(true);
    const stride = world.cellsX + 1;
    for (let cellZ = 0; cellZ < world.cellsZ; cellZ += 1) {
      for (let cellX = 0; cellX < world.cellsX; cellX += 1) {
        const vertex = (cellZ + 1) * stride + cellX + 1;
        const base = vertex * MATERIAL_COUNT;
        if (!COVER_GROUNDS.some((material) => world.splat[base + material]! > 0))
          expect(field.pixels[(cellZ * world.cellsX + cellX) * 2]).toBe(0);
      }
    }
  });

  it("clears an excluded cell and is deterministic", () => {
    const grassy = field.pixels.findIndex((value) => value > 0);
    expect(grassy).toBeGreaterThanOrEqual(0);
    const cellX = grassy % world.cellsX, cellZ = Math.floor(grassy / world.cellsX);
    excludeFieldCoverRegion(world, { maxX: cellX, maxZ: cellZ, minX: cellX, minZ: cellZ });
    const excluded = buildCoverField(world);
    expect(excluded.pixels[grassy * 2]).toBe(0);
    expect(buildCoverField(world).pixels).toEqual(excluded.pixels);
  });

  it("patches the whole map to the same field", () => {
    const reference = buildCoverField(world);
    const copy = { height: reference.height, pixels: new Uint8Array(reference.pixels.length), width: reference.width };
    patchCoverField(copy, world, {
      maxX: world.cellsX - 1,
      maxZ: world.cellsZ - 1,
      minX: 0,
      minZ: 0
    });
    expect(copy.pixels).toEqual(reference.pixels);
  });

  it("samples the field in both ground variants through the lawn depth uniform", () => {
    for (const source of Object.values(GROUND_VARIANT_GLSL)) {
      expect(source).toContain("sampleCoverField(");
      expect(source).toContain("uniform vec4 uLawnDepth;");
      expect(source).toContain("if (uLawnDepth.w >= 1.0) return 0.0;");
    }
  });
});
