import { describe, expect, it } from "vitest";

import { createPeriodicNoise } from "../src/render-common/materials/periodic-noise";
import { sampleRockMaterials } from "../src/render-common/rocks/rock-texture";
import {
  getFaceExposure,
  getLooseCover,
  getUpward,
  getWeathering
} from "../src/render-common/rocks/rock-zones";

const base = { cavity: 0, exposure: 0.5, moisture: 0.3, upward: 0 };

describe("cliff material zones", () => {
  it("weather sheltered, upward, creviced and wet rock more than exposed faces", () => {
    const reference = getWeathering(base);
    expect(getWeathering({ ...base, exposure: 1 })).toBeLessThan(reference);
    expect(getWeathering({ ...base, upward: 1 })).toBeGreaterThan(reference);
    expect(getWeathering({ ...base, cavity: 1 })).toBeGreaterThan(reference);
    expect(getWeathering({ ...base, moisture: 1 })).toBeGreaterThan(reference);
    expect(getWeathering({ cavity: 1, exposure: 0, moisture: 1, upward: 1 })).toBe(1);
  });

  it("expose fresh rock high on tall faces, not at the foot, the lip or on short faces", () => {
    const middle = getFaceExposure(0.6, 6);
    expect(middle).toBeGreaterThan(0.8);
    expect(getFaceExposure(0.02, 6)).toBe(0);
    expect(getFaceExposure(1, 6)).toBeLessThan(middle * 0.5);
    expect(getFaceExposure(0.6, 0.5)).toBe(0);
  });

  it("cover ground contact and shelves with loose rock, keep walls bare", () => {
    expect(getLooseCover(1, 0)).toBeGreaterThan(0.8);
    expect(getLooseCover(0, 1)).toBeGreaterThan(0.4);
    expect(getLooseCover(0, getUpward(0))).toBe(0);
  });
});

describe("cliff material texture", () => {
  const noise = createPeriodicNoise(21);
  const samples = Array.from({ length: 400 }, (_, index) =>
    sampleRockMaterials(noise, (index % 20) / 20 + 0.013, Math.floor(index / 20) / 20 + 0.007)
  );

  it("stays in the byte range around mid grey (the palette comes from the shader)", () => {
    for (const key of ["clean", "weathered", "gravel", "cavity"] as const) {
      const values = samples.map((sample) => sample[key]);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...values)).toBeLessThanOrEqual(1);
    }
    const mean = samples.reduce((sum, sample) => sum + sample.clean, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.65);
  });

  it("keeps cracks sparse: most of the rock is open surface", () => {
    const cracked = samples.filter((sample) => sample.cavity > 0.5).length;
    expect(cracked / samples.length).toBeLessThan(0.15);
  });

  it("is tileable: opposite edges match", () => {
    for (const along of [0.13, 0.37, 0.71]) {
      for (const [from, to] of [
        [
          [0, along],
          [1, along]
        ],
        [
          [along, 0],
          [along, 1]
        ]
      ] as const) {
        const first = sampleRockMaterials(noise, from[0]!, from[1]!);
        const second = sampleRockMaterials(noise, to[0]!, to[1]!);
        for (const key of Object.keys(first) as (keyof typeof first)[]) {
          expect(second[key]).toBeCloseTo(first[key], 5);
        }
      }
    }
  });
});
