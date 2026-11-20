import { describe, expect, it } from "vitest";

import {
  listBuildingSurfacePaints,
  NATION_SURFACES,
  paintBuildingSurface,
  ROMAN_SURFACE_COLOURS,
  surfacePaintKey
} from "../src/renderers/three/buildings/building-surface-paint";

describe("building surface paint (world worker recipes)", () => {
  it("lists the Roman base pack plus the nation's own surfaces, each key once", () => {
    const romanCount = Object.keys(ROMAN_SURFACE_COLOURS).length;
    expect(listBuildingSurfacePaints("roman", true)).toHaveLength(romanCount);
    const nubian = listBuildingSurfacePaints("nubian", false);
    expect(nubian).toHaveLength(romanCount + Object.keys(NATION_SURFACES.nubian!).length);
    expect(new Set(nubian.map(surfacePaintKey)).size).toBe(nubian.length);
    expect(nubian.every((paint) => paint.resolution === 128 && !paint.detailed)).toBe(true);
    expect(listBuildingSurfacePaints("viking", true).at(-1)).toMatchObject({
      nation: "viking", resolution: 1024, surface: "roof"
    });
  });

  it("paints opaque RGBA maps, deterministically (albedo, normal and roughness when detailed)", () => {
    const paint = { detailed: true, nation: "japanese", resolution: 32, surface: "roof" } as const;
    const maps = paintBuildingSurface(paint);
    expect(maps).toHaveLength(3);
    maps.forEach((map) => {
      expect(map).toHaveLength(32 * 32 * 4);
      expect(map.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
    });
    expect(paintBuildingSurface(paint)).toEqual(maps);
    expect(paintBuildingSurface({ ...paint, detailed: false, nation: "roman", surface: "stone" }))
      .toHaveLength(1);
  });

  it("refuses a surface the nation has no recipe for", () => {
    expect(() => paintBuildingSurface({ detailed: false, nation: "viking", resolution: 8, surface: "stone" }))
      .toThrow(/No viking surface recipe/);
  });
});
