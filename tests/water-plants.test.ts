import { describe, expect, it } from "vitest";

import { createVertexFog } from "../src/render-common/chunk-sampling";
import { createWaterLily, LILY_VARIANT_COUNT } from "../src/render-common/props/plants/water-lily";
import { buildWaterWeeds } from "../src/render-common/water/water-weeds";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { SHALLOWS_DEPTH } from "../src/shared/world/generation/prop-rules";
import {
  LILY_DEPTH,
  LILY_STILLNESS,
  REED_BED_DEPTH,
  REED_BED_STILLNESS
} from "../src/shared/world/generation/water-plants";
import { sampleBilinear, sampleSmooth } from "../src/shared/world/grid-geometry";
import { createRandom } from "../src/shared/world/rng";
import { createStillWater } from "../src/shared/world/still-water";
import { PROP, type WorldData } from "../src/shared/world/world-data";
import { cachedWorld, freshWorldBeforeAll, preloadWorlds } from "./helpers/cached-worlds";

const world = cachedWorld(DEFAULT_WORLD_OPTIONS);
const still = createStillWater(world, world);
/** Small change against float rounding of the bilinear samples. */
const EPSILON = 1e-3;

const getDepth = (target: WorldData, x: number, z: number) =>
  sampleBilinear(target, target.waterSurface, x, z) - sampleSmooth(target, target.heights, x, z);

const collect = (target: WorldData, keep: (type: number, x: number, z: number) => boolean) => {
  const { props } = target;
  const spots: { depth: number; still: number; x: number; z: number }[] = [];
  for (let index = 0; index < props.count; index += 1) {
    const x = props.x[index]!;
    const z = props.z[index]!;
    if (!keep(props.types[index]!, x, z)) continue;
    spots.push({ depth: getDepth(target, x, z), still: sampleBilinear(target, still, x, z), x, z });
  }
  return spots;
};

/**
 * A stem deeper than the bank pass allows (its own measure: the interpolated water depth), so
 * placed by the water plant pass. Gentle sea beaches put bank reeds right at SHALLOWS_DEPTH,
 * where the smooth ground sample can read a hair deeper.
 */
const isWadingStem = (type: number, x: number, z: number) =>
  (type === PROP.reeds || type === PROP.cattail) &&
  sampleBilinear(world, world.waterDepth, x, z) > SHALLOWS_DEPTH + EPSILON;

describe("still water", () => {
  it("is calm fresh river water only: none on the sea or in fast channels", () => {
    let calm = 0;
    for (let index = 0; index < still.length; index += 1) {
      const speed = Math.hypot(world.flow[index * 2]!, world.flow[index * 2 + 1]!);
      const isSea = world.waterDepth[index]! > 0 && world.riverDistance[index]! > 2;
      if (isSea || speed > 1.05) expect(still[index]).toBe(0);
      if (still[index]! > 0) calm += 1;
    }
    expect(calm).toBeGreaterThan(300);
  });
});

describe("water plants (default island)", () => {
  const lilies = collect(world, (type) => type === PROP.waterLily);
  const wading = collect(world, isWadingStem);

  it("floats lilies on calm, fresh water of floating depth only", () => {
    expect(lilies.length).toBeGreaterThan(100);
    expect(lilies.length).toBeLessThan(400);
    for (const lily of lilies) {
      expect(lily.still).toBeGreaterThanOrEqual(LILY_STILLNESS - EPSILON);
      expect(lily.depth).toBeGreaterThanOrEqual(LILY_DEPTH[0] - EPSILON);
      expect(lily.depth).toBeLessThanOrEqual(LILY_DEPTH[1] + EPSILON);
    }
  });

  it("lets reed and cattail beds wade into shallow calm fresh water", () => {
    expect(wading.length).toBeGreaterThan(100);
    for (const stem of wading) {
      expect(stem.still).toBeGreaterThanOrEqual(REED_BED_STILLNESS - EPSILON);
      expect(stem.depth).toBeLessThanOrEqual(REED_BED_DEPTH + EPSILON);
    }
  });

  const small = { ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96, erosionDroplets: 6000 };
  const freshSmall = freshWorldBeforeAll(small);
  preloadWorlds(small);
  it("is deterministic per seed", () => {
    const first = freshSmall();
    const second = cachedWorld(small);
    const lilyX = (target: WorldData) =>
      Array.from(target.props.x).filter((_, index) => target.props.types[index] === PROP.waterLily);
    expect(lilyX(second)).toEqual(lilyX(first));
  });
});

describe("underwater weeds", () => {
  const fog = createVertexFog(world);
  const weeds = buildWaterWeeds(world, fog);

  it("grows submerged clumps in still water, deterministic", () => {
    expect(weeds.count).toBeGreaterThan(100);
    for (let index = 0; index < weeds.count; index += 1) {
      const [x, ground, z] = weeds.placement.subarray(index * 4, index * 4 + 3);
      const height = weeds.shape[index * 4]!;
      expect(ground! + height).toBeLessThan(sampleBilinear(world, world.waterSurface, x!, z!));
      expect(sampleBilinear(world, still, x!, z!)).toBeGreaterThan(0);
    }
    expect(buildWaterWeeds(world, fog).placement).toEqual(weeds.placement);
  });
});

describe("water lily mesh", () => {
  const variants = Array.from({ length: LILY_VARIANT_COUNT }, (_, variant) =>
    createWaterLily(createRandom(11 + variant), variant)
  );

  it("is a flat floating cluster that drifts as one piece", () => {
    for (const mesh of variants) {
      expect(mesh.indices.length % 3).toBe(0);
      expect(Math.max(...mesh.indices)).toBeLessThan(mesh.positions.length / 3);
      expect(mesh.indices.length / 3).toBeLessThan(600);
      const bends = new Set(mesh.wind.filter((_, index) => index % 2 === 0));
      expect(bends.size).toBe(1);
    }
    expect(variants[0]!.height).toBeLessThan(0.05);
    expect(variants[LILY_VARIANT_COUNT - 1]!.height).toBeGreaterThan(0.04);
  });
});
