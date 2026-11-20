import { describe, expect, it } from "vitest";

import { getSeasonLeafShades } from "../src/render-common/seasonal-appearance/season-leaf-shades";
import { AUTUMN_PALETTES, SEASON_CLASS } from "../src/render-common/seasonal-appearance/season-palettes";

const SHADES = [[0.34, 0.52, 0.15], [0.24, 0.42, 0.11], [0.62, 0.57, 0.17]] as const;

describe("season leaf shades", () => {
  it("keeps the summer shades without a season", () => {
    expect(getSeasonLeafShades(SHADES, { autumn: 0, dormant: 0, spring: 0 })).toEqual(SHADES);
  });

  it("turns autumn leaves to the oak tones, red above green", () => {
    const shades = getSeasonLeafShades(SHADES, { autumn: 1, dormant: 0, spring: 0 });
    shades.forEach(([red, green]) => expect(red).toBeGreaterThan(green));
    const [base] = AUTUMN_PALETTES[SEASON_CLASS.oak];
    expect(shades[0]![0] / shades[0]![1]).toBeCloseTo(base[0] / base[1], 5);
  });

  it("dries dormant leaves but not the spring buds", () => {
    const dormant = getSeasonLeafShades(SHADES, { autumn: 0.5, dormant: 1, spring: 0 });
    dormant.forEach(([red, green, blue]) => expect(red > green && green > blue).toBe(true));
    const budding = getSeasonLeafShades(SHADES, { autumn: 0, dormant: 0.5, spring: 1 });
    budding.forEach(([red, green]) => expect(green).toBeGreaterThan(red));
  });

  it("deepens monsoon leaves to a darker, more saturated green", () => {
    const monsoon = getSeasonLeafShades(SHADES, { autumn: 0, dormant: 0, monsoon: 1, spring: 0 });
    monsoon.forEach((shade, index) => {
      const [red, green, blue] = shade;
      const source = SHADES[index]!;
      expect(green).toBeGreaterThan(red);
      expect(green - Math.max(red, blue)).toBeGreaterThan((source[1] - Math.max(source[0], source[2])) * 0.9);
      expect(red + green + blue).toBeLessThan(source[0] + source[1] + source[2]);
    });
  });
});
