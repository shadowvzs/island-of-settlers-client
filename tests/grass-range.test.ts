import { describe, expect, it } from "vitest";

import { getGrassRingSettings } from "../src/render-common/grass/grass-ring-layout";
import {
  getGrassRange,
  GRASS_RANGE_OFF,
  grassHoleKeepAt,
  grassKeepAt
} from "../src/renderers/three/grass-range";
import { createPropMaterial } from "../src/renderers/three/three-prop-materials";

const dense = getGrassRingSettings("dense")!;

describe("grass range", () => {
  it("turns off without an eye or distance", () => {
    expect(getGrassRange(undefined, 38)).toEqual({
      chunkDistance: GRASS_RANGE_OFF,
      end: GRASS_RANGE_OFF,
      start: GRASS_RANGE_OFF,
      x: 0,
      z: 0
    });
    expect(getGrassRange({ x: 1, z: 2 }, undefined).chunkDistance).toBe(GRASS_RANGE_OFF);
  });

  it("starts fading at 60 percent and widens the chunk margin", () => {
    expect(getGrassRange({ x: 1, z: 2 }, 38)).toEqual({
      chunkDistance: 54,
      end: 38,
      start: 22.8,
      x: 1,
      z: 2
    });
  });

  it("keeps every rank whole before the fade and removes it at the end", () => {
    for (const rank of [0, 0.25, 0.5, 0.99]) {
      expect(grassKeepAt(22.8, rank, 22.8, 38)).toBe(1);
      expect(grassKeepAt(38, rank, 22.8, 38)).toBe(0);
    }
  });

  it("thins in rank order and never grows with distance", () => {
    const keep = (rank: number, distance: number) => grassKeepAt(distance, rank, 22.8, 38);
    for (let distance = 23; distance < 38; distance += 0.5) {
      expect(keep(0.1, distance)).toBeGreaterThanOrEqual(keep(0.5, distance));
      expect(keep(0.5, distance)).toBeGreaterThanOrEqual(keep(0.9, distance));
    }
    for (const rank of [0.1, 0.5, 0.9]) {
      let previous = 1;
      for (let distance = 0; distance <= 40; distance += 0.5) {
        const current = keep(rank, distance);
        expect(current).toBeLessThanOrEqual(previous);
        previous = current;
      }
    }
  });

  it("opens the short-grass hole only inside the possessed ring and fills the ring's missing cover", () => {
    for (const distance of [0, 5, 16, 40]) expect(grassHoleKeepAt(dense, distance, 0)).toBe(1);
    expect(grassHoleKeepAt(dense, 0, 1)).toBe(0);
    expect(grassHoleKeepAt(dense, 3, 1)).toBe(0);
    expect(grassHoleKeepAt(dense, 16, 1)).toBe(1);
    expect(grassHoleKeepAt(dense, 1, 0.25)).toBeCloseTo(0.75);
    for (const noise of [0, 0.5, 1]) {
      let previous = 0;
      for (let distance = 0; distance <= 20; distance += 0.25) {
        const current = grassHoleKeepAt(dense, distance, 1, noise);
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    }
  });

  it("thins the tufts by rank across the wide band and keeps them whole beyond the ring", () => {
    const keep = (rank: number, distance: number) =>
      grassKeepAt(distance, rank, 22.8, 38, grassHoleKeepAt(dense, distance, 1));
    for (const rank of [0, 0.5, 0.99]) {
      expect(keep(rank, 2)).toBe(0);
      expect(keep(rank, 16)).toBe(1);
    }
    expect(keep(0.1, 9)).toBeGreaterThan(0);
    expect(keep(0.1, 9)).toBeGreaterThanOrEqual(keep(0.9, 9));
  });

  it("uses vertex visibility for grass and keeps alpha-to-coverage for other props", () => {
    const grass = createPropMaterial({}, true);
    expect(grass.vertexShader).toContain("getGrassKeep(");
    expect(grass.vertexShader).toContain("getGrassHoleKeep(");
    expect(grass.uniforms.uGrassHole!.value.w).toBe(0);
    expect(grass.fragmentShader).toContain("#ifndef GRASS_COVER");
    expect(grass.alphaToCoverage).toBe(false);
    grass.dispose();
    const tree = createPropMaterial({}, false);
    expect(tree.alphaToCoverage).toBe(true);
    expect(tree.defines?.GRASS_COVER).toBeUndefined();
    tree.dispose();
  });
});
