import { describe, expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { buildFieldCoverInstances } from "../src/render-common/props/field-cover";
import { COVER, getMeshKind } from "../src/render-common/props/prop-meshes";
import { buildSpringFlowerInstances, SPRING_FLOWERS } from "../src/render-common/props/spring-flowers";
import { getSpringBloomRamp, SPRING_BLOOM } from "../src/render-common/seasonal-appearance/spring-bloom";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";

const FLOWER_KINDS = new Set<number>([COVER.pinkFlower, COVER.whiteFlower, COVER.yellowFlower]);
const world = () => cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 4000 });

describe("spring meadow flowers", () => {
  it("grows only wildflowers, scattered early points and later patch points", () => {
    const island = world();
    const flowers = buildSpringFlowerInstances(island, createVertexFog(island), 4);
    expect(flowers.count).toBeGreaterThan(50);
    const points = Array.from(flowers.phase, phase => phase / (Math.PI * 2));
    for (let index = 0; index < flowers.count; index++)
      expect(FLOWER_KINDS.has(getMeshKind(flowers.meshIds[index]!))).toBe(true);
    const early = points.filter(point => point < SPRING_FLOWERS.patchBloom).length;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(points.length * 0.5);
    expect(Math.max(...points)).toBeLessThan(1);
  });

  it("leaves the field cover streams unchanged and skips expedition scenery", () => {
    const island = world();
    const fog = createVertexFog(island);
    const before = buildFieldCoverInstances(island, fog, 6).count;
    buildSpringFlowerInstances(island, fog, 4);
    expect(buildFieldCoverInstances(island, fog, 6).count).toBe(before);
    expect(buildSpringFlowerInstances({ ...island, expeditionKind: "adventure" }, fog, 4).count)
      .toBe(0);
  });

  it("opens the bloom ramp only in the second half of the spring weight", () => {
    expect(getSpringBloomRamp(0.5)).toBe(0);
    expect(getSpringBloomRamp(SPRING_BLOOM.fullAt)).toBe(1);
    expect(getSpringBloomRamp(0.75)).toBeGreaterThan(0);
  });
});
