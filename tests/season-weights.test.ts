import { describe, expect, it } from "vitest";

import {
  GAME_WEEK_MS,
  getDominantSeason,
  resolveSeasonPhase,
  type SeasonSettings
} from "../../island-of-settlers-shared/src/appearance/season-calendar";
import { resolveSeasonWeights } from "../src/render-common/seasonal-appearance/season-weights";

const fixed = (fixedSeason: SeasonSettings["fixedSeason"], previousSeason = fixedSeason): SeasonSettings => ({
  changedAt: 1_000_000, fixedSeason, mode: "none", previousSeason, transitionSeconds: 180
});

describe("cosmetic season phase and weights", () => {
  it("blends an admin change over its transition and swaps the dominant season at mid-blend", () => {
    const settings = fixed("autumn", "summer");
    expect(resolveSeasonPhase(settings, 1_000_000)).toEqual({ blend: 0, from: "summer", to: "autumn" });
    const half = resolveSeasonPhase(settings, 1_000_000 + 90_000);
    expect(half.blend).toBeCloseTo(0.5);
    expect(getDominantSeason(half)).toBe("autumn");
    expect(resolveSeasonPhase(settings, 1_000_000 + 400_000).blend).toBe(1);
  });

  it("follows the UTC calendar in four-season mode with a one game week transition", () => {
    const settings: SeasonSettings = { ...fixed("summer"), changedAt: 0, mode: "four" };
    const start = Date.UTC(2026, 8, 1);
    expect(resolveSeasonPhase(settings, start)).toEqual({ blend: 0, from: "summer", to: "autumn" });
    expect(resolveSeasonPhase(settings, start + GAME_WEEK_MS / 2).blend).toBeCloseTo(0.5);
    expect(resolveSeasonPhase(settings, Date.UTC(2026, 9, 15))).toEqual({ blend: 1, from: "summer", to: "autumn" });
    // Winter began on 1 December of the previous year.
    expect(resolveSeasonPhase(settings, Date.UTC(2027, 1, 10)).from).toBe("autumn");
    expect(resolveSeasonPhase({ ...settings, mode: "two" }, Date.UTC(2026, 6, 1)).to).toBe("monsoon");
  });

  it("keeps tropical islands green apart from a light autumn tint, and bares trees on the way to winter", () => {
    const autumn = { blend: 1, from: "summer", to: "autumn" } as const;
    expect(resolveSeasonWeights(autumn, "temperate").autumn).toBe(1);
    expect(resolveSeasonWeights(autumn, "tropical").autumn).toBeCloseTo(0.35);
    const toWinter = { blend: 0.5, from: "autumn", to: "winter" } as const;
    expect(resolveSeasonWeights(toWinter, "temperate").dormant).toBe(1);
    expect(resolveSeasonWeights(toWinter, "tropical")).toMatchObject({ dormant: 0, winter: 0 });
  });

  it("snows first, then builds the snow cover; melts over the first half of winter -> spring", () => {
    const bare = resolveSeasonWeights({ blend: 0.3, from: "autumn", to: "winter" }, "temperate");
    expect(bare).toMatchObject({ snowCover: 0, snowfall: 0 });
    expect(bare.dormant).toBeGreaterThan(0.6);
    const early = resolveSeasonWeights({ blend: 0.41, from: "autumn", to: "winter" }, "temperate");
    expect(early.snowfall).toBe(1);
    expect(early.snowCover).toBe(0);
    const late = resolveSeasonWeights({ blend: 0.9, from: "autumn", to: "winter" }, "temperate");
    expect(late.snowCover).toBeGreaterThan(0.9);
    expect(resolveSeasonWeights({ blend: 1, from: "winter", to: "winter" }, "temperate"))
      .toMatchObject({ dormant: 1, snowCover: 1, snowfall: 0 });
    const melt = resolveSeasonWeights({ blend: 0.2, from: "winter", to: "spring" }, "temperate");
    expect(melt.snowCover).toBeCloseTo(0.5);
    expect(resolveSeasonWeights({ blend: 0.45, from: "winter", to: "spring" }, "temperate"))
      .toMatchObject({ dormant: 1, snowCover: 0 });
    expect(resolveSeasonWeights({ blend: 1, from: "winter", to: "winter" }, "tropical"))
      .toMatchObject({ snowCover: 0, snowfall: 0 });
  });

  it("leans the summer of the two-season mode to the dry season", () => {
    const summer = { blend: 1, from: "summer", to: "summer" } as const;
    expect(resolveSeasonWeights(summer, "temperate").drySeason).toBe(0);
    expect(resolveSeasonWeights(summer, "temperate", "two").drySeason).toBe(1);
    expect(resolveSeasonWeights({ blend: 0.25, from: "monsoon", to: "summer" }, "temperate").drySeason)
      .toBeCloseTo(0.25);
  });
});

