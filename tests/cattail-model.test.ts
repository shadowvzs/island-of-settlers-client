import { describe, expect, it } from "vitest";

import { CATTAIL_BROWN, createCattail } from "../src/render-common/props/plants/cattail-model";
import { RIVER_GREENS } from "../src/render-common/props/plants/plant-colors";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { createRandom } from "../src/shared/world/rng";
import { PROP } from "../src/shared/world/world-data";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

/** Field-cover budget per clump (about 500 clumps on the default island). */
const CLUMP_TRIANGLES = 500;
/** Island total of the cattail kind, the procedural clumps' cost before the import. */
const ISLAND_TRIANGLES = 260_000;

const variants = [0, 1, 2].map((variant) => createCattail(createRandom(3 + variant), variant));

const meanColor = (colors: Float32Array, keep: (vertex: number) => boolean) => {
  const sum = [0, 0, 0];
  let count = 0;
  for (let vertex = 0; vertex < colors.length / 3; vertex += 1) {
    if (!keep(vertex)) continue;
    for (let channel = 0; channel < 3; channel += 1) sum[channel]! += colors[vertex * 3 + channel]!;
    count += 1;
  }
  return sum.map((value) => value / count);
};

describe("imported cattail (assets/models/plants/cattail)", () => {
  preloadWorlds(DEFAULT_WORLD_OPTIONS);
  it("stays within the field-cover budget per clump and on the island", () => {
    const world = cachedWorld(DEFAULT_WORLD_OPTIONS);
    const clumps = Array.from(world.props.types).filter((type) => type === PROP.cattail).length;
    const triangles = variants.map((mesh) => mesh.indices.length / 3);
    for (const count of triangles) expect(count).toBeLessThanOrEqual(CLUMP_TRIANGLES);
    expect(clumps * Math.max(...triangles)).toBeLessThan(ISLAND_TRIANGLES);
  }, 30_000);

  it("is a valid prop mesh: untextured, rooted wind, heights per variant", () => {
    for (const mesh of variants) {
      const vertices = mesh.positions.length / 3;
      expect(Math.max(...mesh.indices)).toBeLessThan(vertices);
      expect(mesh.uvs.every((value) => value < 0)).toBe(true);
      const bends = mesh.wind.filter((_, index) => index % 2 === 0);
      expect(Math.min(...bends)).toBeLessThan(0.01);
      expect(Math.max(...bends)).toBeGreaterThan(0.6);
      expect(mesh.contactRadius).toBeGreaterThan(0);
    }
    expect(variants[2]!.height).toBeGreaterThan(variants[0]!.height);
  });

  it("keeps the island palette: river green leaves and cattail brown heads", () => {
    const [mesh] = variants;
    const leaves = meanColor(mesh!.colors, (vertex) => mesh!.wind[vertex * 2 + 1]! > 0.15);
    const heads = meanColor(mesh!.colors, (vertex) => mesh!.wind[vertex * 2 + 1]! === 0);
    expect(leaves[1]!).toBeGreaterThan(leaves[0]! * 1.05);
    expect(leaves[1]!).toBeLessThan(RIVER_GREENS.base[1] * 1.05);
    expect(heads[0]!).toBeGreaterThan(heads[2]!);
    expect(heads[0]!).toBeLessThan(CATTAIL_BROWN[0] * 1.05);
  });

  it("mirrors the middle variant with the winding flipped", () => {
    const [first, mirrored] = variants;
    expect(mirrored!.positions[0]).toBeCloseTo(-first!.positions[0]! * (0.78 / 0.7), 4);
    expect(mirrored!.indices[1]).toBe(first!.indices[2]);
  });
});
