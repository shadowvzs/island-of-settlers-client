import { describe, expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import {
  BIOME_GRASS,
  getBiomeGrassBlend,
  getBiomeGrassWeights,
  pickBiomeGrassKind
} from "../src/render-common/props/biome-grass";
import { clearCoverPaintRegion, getPaintedCoverValue, paintCoverCells } from "../src/render-common/props/cover-paint";
import {
  buildFieldCoverInstances,
  createFieldCoverContext,
  getCoverAcceptance
} from "../src/render-common/props/field-cover";
import { getFieldCoverExclusions, roadsideCoverWeight } from "../src/render-common/props/field-cover-exclusions";
import { createBiomeGrassHeroMesh } from "../src/render-common/props/plants/biome-grass-mesh";
import {
  COVER,
  createPropMesh,
  getMeshId,
  getMeshKind,
  getVariantCount
} from "../src/render-common/props/prop-meshes";
import { applyWorldDiff, createWorldSnapshot } from "../src/shared/world/editing/history/world-diff";
import { applyExpeditionWorldTheme } from "../src/shared/world/generation/expedition-world-themes";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { ISLAND_THEMES, THEME_COUNT } from "../src/shared/world/generation/island-themes";
import { sampleBilinear } from "../src/shared/world/grid-geometry";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { writeMapFile } from "../src/shared/world/save/map-writer";
import type { WorldData } from "../src/shared/world/world-data";
import { cachedWorld } from "./helpers/cached-worlds";

const NEW_KINDS = new Set<number>([COVER.savannaGrass, COVER.jungleGrass, COVER.forestGrass]);

const buildWorld = (theme: "dirt" | "meadow") =>
  cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 1000, theme });

const countNewKinds = (world: WorldData) => {
  const cover = buildFieldCoverInstances(world, createVertexFog(world), 6);
  const counts = new Map<number, number>();
  for (let index = 0; index < cover.count; index += 1) {
    const kind = getMeshKind(cover.meshIds[index]!);
    if (!NEW_KINDS.has(kind)) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return { counts, cover };
};

describe("biome grass registry", () => {
  it("registers three kinds with eight variants and distinct high/min LODs", () => {
    expect(BIOME_GRASS).toHaveLength(3);
    for (const parameters of BIOME_GRASS) {
      expect(getVariantCount(parameters.kind)).toBe(8);
      for (let variant = 0; variant < 8; variant += 1) {
        const mesh = createPropMesh(7, parameters.kind, variant);
        expect(mesh.lodMinimalIndices).toBeDefined();
        expect(mesh.lodMinimalIndices!.length / 3).toBeLessThan(mesh.indices.length / 3);
        expect(mesh.height).toBeGreaterThanOrEqual(parameters.height[0]);
        expect(mesh.height).toBeLessThanOrEqual(parameters.height[1]);
        expect(mesh.castsShadow).toBe(parameters.shadowCasting);
        expect(mesh.uvs.every(value => value < 0)).toBe(true);
      }
    }
    const hero = createBiomeGrassHeroMesh(COVER.savannaGrass, 0);
    expect(hero.indices.length / 3).toBeGreaterThan(createPropMesh(7, COVER.savannaGrass, 0).indices.length / 3);
  });

  it("keeps the model set deterministic and stable across calls", () => {
    const first = createPropMesh(7, COVER.savannaGrass, 3);
    const second = createPropMesh(7, COVER.savannaGrass, 3);
    expect(Array.from(second.positions)).toEqual(Array.from(first.positions));
    expect(Array.from(second.wind)).toEqual(Array.from(first.wind));
    expect(getMeshId(COVER.savannaGrass, 3)).toBeLessThan(getMeshId(COVER.jungleGrass, 0));
  });
});

describe("biome grass selection", () => {
  it("grows savanna grass on dry open ground and never on bare or excluded cells", () => {
    const world = buildWorld("dirt");
    const { counts, cover } = countNewKinds(world);
    expect(counts.get(COVER.savannaGrass) ?? 0).toBeGreaterThan(0);
    const exclusions = getFieldCoverExclusions(world);
    for (let index = 0; index < cover.count; index += 1) {
      if (!NEW_KINDS.has(getMeshKind(cover.meshIds[index]!))) continue;
      const x = cover.x[index]!, z = cover.z[index]!;
      expect(sampleBilinear(world, world.waterDepth, x, z)).toBe(0);
      expect(roadsideCoverWeight(world, x, z)).not.toBeNull();
      expect(exclusions?.[Math.floor(z) * world.cellsX + Math.floor(x)] ?? 0).toBe(0);
    }
  });

  it("switches to jungle grass on a tropical island and forest grass under temperate canopy", () => {
    const tropical = buildWorld("meadow");
    applyExpeditionWorldTheme(tropical, "tropical", "adventure");
    const jungle = countNewKinds(tropical).counts;
    expect(jungle.get(COVER.jungleGrass) ?? 0).toBeGreaterThan(0);

    const meadow = buildWorld("meadow");
    const forest = countNewKinds(meadow).counts;
    expect(forest.get(COVER.forestGrass) ?? 0).toBeGreaterThan(0);
    expect(forest.get(COVER.savannaGrass) ?? 0).toBe(0);
    expect(forest.get(COVER.jungleGrass) ?? 0).toBe(0);
  });

  it("blends at a theme border by probability instead of a hard switch", () => {
    const world = buildWorld("dirt");
    const ground = { dry: 0.6, lush: 0, moisture: 0.2, shaded: 0, trodden: 0 };
    const desertChannel = ISLAND_THEMES.indexOf("desert");
    const setDesertShare = (share: number) => {
      for (let vertex = 0; vertex < world.themeWeights.length / THEME_COUNT; vertex += 1) {
        const base = vertex * THEME_COUNT;
        world.themeWeights.fill(0, base, base + THEME_COUNT);
        world.themeWeights[base + desertChannel] = Math.round(255 * share);
      }
    };
    setDesertShare(1);
    const dry = getBiomeGrassWeights(world, 8.5, 8.5, ground);
    setDesertShare(0.5);
    const border = getBiomeGrassWeights(world, 8.5, 8.5, ground);
    expect(border.savanna).toBeGreaterThan(0);
    expect(border.savanna).toBeLessThan(dry.savanna);
    expect(pickBiomeGrassKind(border, 0.001)).toBe(COVER.savannaGrass);
    expect(getBiomeGrassBlend(border).heightScale).toBeGreaterThan(1);
  });
});

describe("painted grass and map data", () => {
  it("paints only accepted cells, regrows that kind and clears with the doodad eraser", () => {
    const world = buildWorld("meadow");
    const context = createFieldCoverContext(world, {
      maxX: world.cellsX - 1, maxZ: world.cellsZ - 1, minX: 0, minZ: 0
    });
    let accepted = -1;
    for (let cell = 0; cell < world.cellsX * world.cellsZ && accepted < 0; cell += 1) {
      const x = (cell % world.cellsX) + 0.5, z = Math.floor(cell / world.cellsX) + 0.5;
      if (getCoverAcceptance(context, x, z) > 0.2) accepted = cell;
    }
    expect(accepted).toBeGreaterThanOrEqual(0);
    const kind = COVER.savannaGrass;
    expect(paintCoverCells(world, [accepted], kind)).toBe(1);
    expect(world.coverPaint![accepted]).toBe(getPaintedCoverValue(kind));
    const { cover } = countNewKinds(world);
    const painted = Array.from({ length: cover.count }, (_, index) => index)
      .filter(index => getMeshKind(cover.meshIds[index]!) === kind &&
        Math.floor(cover.z[index]!) * world.cellsX + Math.floor(cover.x[index]!) === accepted);
    expect(painted.length).toBeGreaterThan(0);
    const region = { maxX: accepted % world.cellsX, maxZ: Math.floor(accepted / world.cellsX),
      minX: accepted % world.cellsX, minZ: Math.floor(accepted / world.cellsX) };
    expect(clearCoverPaintRegion(world, region)).toBe(1);
    expect(world.coverPaint![accepted]).toBe(0);
  });

  it("round-trips painted grass through a saved map", async () => {
    const world = buildWorld("meadow");
    const cell = Math.floor(world.cellsX * world.cellsZ / 2);
    paintCoverCells(world, [cell], COVER.jungleGrass);
    const bytes = await writeMapFile(world, { animals: [], name: "biome-grass", savedAt: 1, source: "test" });
    const loaded = await readMapFile(bytes);
    expect(loaded.world.coverPaint?.[cell]).toBe(getPaintedCoverValue(COVER.jungleGrass));
  });

  it("keeps painted grass in the editor undo history", () => {
    const world = buildWorld("meadow");
    const cell = Math.floor(world.cellsX * world.cellsZ / 2);
    const snapshot = createWorldSnapshot(world, null);
    snapshot.capture();
    paintCoverCells(world, [cell], COVER.savannaGrass);
    const diff = snapshot.diff();
    expect(diff).not.toBeNull();
    applyWorldDiff(world, null, diff!, "before");
    expect(world.coverPaint?.[cell] ?? 0).toBe(0);
    applyWorldDiff(world, null, diff!, "after");
    expect(world.coverPaint?.[cell]).toBe(getPaintedCoverValue(COVER.savannaGrass));
  });
});
