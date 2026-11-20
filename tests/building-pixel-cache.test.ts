import type { DataTexture } from "three";
import { describe, expect, it, vi } from "vitest";

/** A fresh module graph: nothing cached yet. */
const loadTextures = async () => {
  vi.resetModules();
  const [fire, water, sail, bronze] = await Promise.all([
    import("../src/renderers/three/buildings/roman-furnace-fire"),
    import("../src/renderers/three/buildings/roman-water-textures"),
    import("../src/renderers/three/buildings/national-mill-sail-texture"),
    import("../src/renderers/three/buildings/viking-statue-textures")
  ]);
  return { bronze, fire, sail, water };
};

type Textures = Awaited<ReturnType<typeof loadTextures>>;
const paintAll = ({ bronze, fire, sail, water }: Textures) => [true, false].flatMap(detailed => {
  const waterMaps = water.createRomanWaterTextures(detailed);
  const bronzeMaps = bronze.paintMaps(detailed ? 256 : 64, (u, v) => (u + v) / 2, 40, "test-bronze");
  return [fire.createFlameTexture(detailed, 19), fire.createRomanSmokeTexture(detailed),
    fire.createRomanEmberTexture(detailed), waterMaps.map, waterMaps.normalMap,
    sail.createNationalMillSailTexture("viking", detailed), bronzeMaps.albedo, bronzeMaps.height] as DataTexture[];
});

describe("building texture pixel cache", () => {
  it("gives every texture its own copy of the painted pixels", async () => {
    const textures = await loadTextures();
    const cold = paintAll(textures), warm = paintAll(textures);
    const fresh = paintAll(await loadTextures());
    for (const [index, texture] of warm.entries()) {
      expect(texture.image.data).not.toBe(cold[index]!.image.data);
      expect(texture.image.data).toEqual(cold[index]!.image.data);
      expect(texture.image.data).toEqual(fresh[index]!.image.data);
    }
  }, 60_000);
});
