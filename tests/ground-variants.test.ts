import { DataTexture } from "three";
import { describe, expect, it } from "vitest";

import { createVertexAttributes } from "../src/render-common/chunk-sampling";
import { buildCoverField } from "../src/render-common/props/cover-field";
import { buildFieldCoverInstances } from "../src/render-common/props/field-cover";
import { fieldCropCoverCells, setFieldCropCoverCells } from "../src/render-common/props/field-cover-exclusions";
import { GROUND_CLIMATE_TUNING } from "../src/render-common/shaders/ground-climate-glsl";
import { GROUND_DETAIL_LAYERS, GROUND_VARIANT_LAYERS } from "../src/render-common/shaders/ground-variant-layers-glsl";
import { paintGround } from "../src/shared/world/editing/ground-paint";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import {
  GROUND_DETAIL_IDS, GROUND_VARIANT_COUNT, TILLED_SOIL_VARIANT, toGroundVariantTile
} from "../src/shared/world/ground-variants";
import { MAP_LAYERS } from "../src/shared/world/save/map-layers";
import { MATERIAL, MATERIAL_COUNT } from "../src/shared/world/world-data";
import { createTerrainMaterial } from "../src/renderers/three/three-materials";
import { cachedWorld } from "./helpers/cached-worlds";

const texture = new DataTexture(new Uint8Array(4), 1, 1);

const BRUSH = { radius: 2, softness: 0.5, x: 32, z: 32 };

describe("ground variants (GROUND-PALETTE step 2)", () => {
  it("appends one texture layer per photo variant after the splat materials (tilled soil has none)", () => {
    expect(GROUND_VARIANT_LAYERS).toEqual([MATERIAL_COUNT, MATERIAL_COUNT + 1, MATERIAL_COUNT + 2, MATERIAL_COUNT + 3]);
    expect(GROUND_DETAIL_IDS).toEqual(["basalt", "river-pebbles"]);
    expect(GROUND_DETAIL_LAYERS).toEqual([MATERIAL_COUNT + 6, MATERIAL_COUNT + 7]);
    expect(GROUND_VARIANT_COUNT).toBe(5);
    expect(MAP_LAYERS.find(layer => layer.name === "groundVariants")).toMatchObject({
      optional: true, scope: "vertex", stride: GROUND_VARIANT_COUNT
    });
  });

  it("paints a variant over the ground without touching the splat, and splat paint clears it", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed: 5 });
    world.groundVariants = new Uint8Array(world.heights.length * GROUND_VARIANT_COUNT);
    const vertex = BRUSH.z * (world.cellsX + 1) + BRUSH.x;
    const splat = world.splat.slice();
    const moss = paintGround(world, { ...BRUSH, material: toGroundVariantTile(1), strength: 1 });
    expect(world.splat).toEqual(splat);
    expect(world.groundVariants[vertex * GROUND_VARIANT_COUNT + 1]).toBe(255);
    expect(world.groundVariants[vertex * GROUND_VARIANT_COUNT]).toBe(0);
    expect(moss.zoneIds.size).toBe(0);
    paintGround(world, { ...BRUSH, material: MATERIAL.grass, strength: 1 });
    expect(world.groundVariants[vertex * GROUND_VARIANT_COUNT + 1]).toBe(0);
  });

  it("paints tilled garden soil into its own channel, packed in the theme attribute (no new buffer)", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed: 5 });
    world.groundVariants = new Uint8Array(world.heights.length * GROUND_VARIANT_COUNT);
    const vertex = BRUSH.z * (world.cellsX + 1) + BRUSH.x;
    paintGround(world, { ...BRUSH, material: toGroundVariantTile(TILLED_SOIL_VARIANT), strength: 1 });
    expect(world.groundVariants[vertex * GROUND_VARIANT_COUNT + TILLED_SOIL_VARIANT]).toBe(255);
    expect(Object.keys(createVertexAttributes(1))).not.toContain("variantB");
  });

  it("grows no grass cover on painted tilled soil (thinned across the soft brush edge)", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed: 5 });
    const fog = new Float32Array(world.heights.length).fill(1);
    const region = { maxX: BRUSH.x + 1, maxZ: BRUSH.z + 1, minX: BRUSH.x - 1, minZ: BRUSH.z - 1 };
    world.groundVariants = new Uint8Array(world.heights.length * GROUND_VARIANT_COUNT);
    const wide = { ...BRUSH, radius: 4 };
    paintGround(world, { ...wide, material: MATERIAL.grass, strength: 1 });
    expect(buildFieldCoverInstances(world, fog, 6, region).count).toBeGreaterThan(0);
    paintGround(world, { ...wide, material: toGroundVariantTile(TILLED_SOIL_VARIANT), strength: 1 });
    expect(buildFieldCoverInstances(world, fog, 6, region).count).toBe(0);
  });

  it("marks cultivated crop plots as tilled soil in the cover field (G) and keeps the tufts out", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed: 5 });
    const fields = ["grain", "flax", "vine", "charcoal"].map((kind, index) => ({ kind, x: 10 + index, z: 12 }));
    const cells = fieldCropCoverCells(fields, world.cellsX);
    expect([...cells]).toEqual([12 * 64 + 10, 12 * 64 + 11, 12 * 64 + 12]);
    setFieldCropCoverCells(world, cells);
    const field = buildCoverField(world, { maxX: 14, maxZ: 13, minX: 9, minZ: 11 });
    expect(field.pixels[(12 * 64 + 11) * 2 + 1]).toBe(255);
    expect(field.pixels[(12 * 64 + 11) * 2]).toBe(0);
    expect(field.pixels[(12 * 64 + 13) * 2 + 1]).toBe(0);
    setFieldCropCoverCells(world, new Set());
  });

  it("keeps grass off the monument plinth without drawing tilled soil there", () => {
    const world = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, seed: 5 });
    const soil = fieldCropCoverCells([{ kind: "grain", x: 10, z: 12 }], world.cellsX);
    const plinth = 30 * 64 + 30;
    setFieldCropCoverCells(world, new Set([...soil, plinth]), soil);
    const field = buildCoverField(world, { maxX: 31, maxZ: 31, minX: 9, minZ: 11 });
    expect(field.pixels[(12 * 64 + 10) * 2 + 1]).toBe(255);
    expect(field.pixels[plinth * 2]).toBe(0);
    expect(field.pixels[plinth * 2 + 1]).toBe(0);
    setFieldCropCoverCells(world, new Set());
  });

  it("draws tidal flats as pale silt over the sand, not the dark mud tile, above the shallows only", () => {
    const fragment = createTerrainMaterial({}, texture, texture, "full").fragmentShader;
    expect(fragment).toContain("applyTidalSilt(ground, tidal, xz);");
    expect(fragment).not.toContain("TIDAL_TINT, clamp(detail.tidal");
    expect(GROUND_CLIMATE_TUNING.tidalDepth[0]).toBeGreaterThanOrEqual(-0.06);
    expect(GROUND_CLIMATE_TUNING.tidalTint.every(value => value >= 0.95)).toBe(true);
  });
});

