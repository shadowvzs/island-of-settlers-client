import { describe, expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { sampleRomanSurfaceDetail } from "../src/renderers/three/buildings/roman-surface-detail";
import { createRomanTextureGrain } from "../src/renderers/three/buildings/roman-texture-grain";

const surfaces: BuildingSurface[] = [
  "mosaic", "stone",
  "plaster",
  "wood",
  "bark",
  "endgrain",
  "fish",
  "sacking",
  "straw",
  "roof",
  "steel",
  "iron",
  "gold",
  "cloth",
  "rope",
  "paint",
  "leaf",
  "dark",
  "amber", "copper", "cut-stone", "bread"
];
const point = { grain: 0.5, mineral: 0.5, u: 0.37, v: 0.32, weather: 0.5 };

describe("Roman original surface detail", () => {
  it("has recessed, shaded mortar and brighter mineral-bearing stone faces", () => {
    const mortar = sampleRomanSurfaceDetail("stone", { ...point, u: 0, v: 0 }, true);
    const stone = sampleRomanSurfaceDetail("stone", point, true);
    expect(stone.height - mortar.height).toBeGreaterThan(0.1);
    expect(stone.brightness - mortar.brightness).toBeGreaterThan(0.1);
    const mineral = sampleRomanSurfaceDetail("stone", { ...point, mineral: 0.9 }, true);
    expect(mineral.colour).not.toEqual(stone.colour);
  });
  it("keeps masonry seams periodic along both texture axes", () => {
    for (let coordinate = 0; coordinate < 1; coordinate += 0.037) {
      const verticalA = sampleRomanSurfaceDetail("stone", { ...point, u: coordinate, v: 0 }, true);
      const verticalB = sampleRomanSurfaceDetail("stone", { ...point, u: coordinate, v: 1 }, true);
      const horizontalA = sampleRomanSurfaceDetail(
        "stone",
        { ...point, u: 0, v: coordinate },
        true
      );
      const horizontalB = sampleRomanSurfaceDetail(
        "stone",
        { ...point, u: 1, v: coordinate },
        true
      );
      expect(verticalA.height).toBeCloseTo(verticalB.height, 8);
      expect(verticalA.brightness).toBeCloseTo(verticalB.brightness, 8);
      expect(horizontalA.height).toBeCloseTo(horizontalB.height, 8);
      expect(horizontalA.brightness).toBeCloseTo(horizontalB.brightness, 8);
    }
  });
  it("preserves large weathering features between resolution levels", () => {
    const minimal = createRomanTextureGrain(32);
    const high = createRomanTextureGrain(64);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        expect(minimal.weather[y * 32 + x]).toEqual(high.weather[y * 128 + x * 2]);
        expect(minimal.mineral[y * 32 + x]).toEqual(high.mineral[y * 128 + x * 2]);
      }
  });
  it("retains light metal albedo rather than baking black specular shadows", () => {
    for (const surface of ["steel", "iron", "gold"] as const) {
      for (const weather of [0, 0.5, 1]) {
        const detail = sampleRomanSurfaceDetail(surface, { ...point, weather }, true);
        expect(detail.brightness).toBeGreaterThan(0.9);
        expect(detail.roughness).toBeLessThan(170);
      }
    }
  });
  it("keeps all authored albedo, height and roughness values within usable PBR ranges", () => {
    for (const surface of surfaces)
      for (const detailed of [false, true]) {
        for (let y = 0; y < 9; y++)
          for (let x = 0; x < 9; x++) {
            const detail = sampleRomanSurfaceDetail(
              surface,
              {
                grain: x / 8,
                mineral: y / 8,
                u: x / 8,
                v: y / 8,
                weather: (x + y) / 16
              },
              detailed
            );
            expect(detail.brightness).toBeGreaterThan(0.5);
            expect(detail.brightness).toBeLessThan(1.4);
            expect(detail.height).toBeGreaterThan(0.25);
            expect(detail.height).toBeLessThan(0.8);
            expect(detail.roughness).toBeGreaterThan(120);
            expect(detail.roughness).toBeLessThanOrEqual(255);
          }
      }
  });
});
