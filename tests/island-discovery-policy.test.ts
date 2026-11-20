import { describe, expect, it } from "vitest";

import { ADVENTURE_THEMES } from "../src/shared/settlement/adventure-themes";
import { cloneDiscoveredIsland, createDiscoveryCalendar, discoverIslandClimate,
  discoverySeasonForMonth, islandDiscoveryError, SEASON_THEME,selectDiscoveryTheme }
  from "../src/shared/settlement/island-discovery-policy";

describe("seasonal discovery calendar", () => {
  it("covers all twelve northern months", () => {
    expect(Array.from({ length: 12 }, (_, index) => discoverySeasonForMonth(index + 1)))
      .toEqual(["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer",
        "autumn", "autumn", "autumn", "winter"]);
    expect(() => discoverySeasonForMonth(0)).toThrow(/month/);
    expect(() => discoverySeasonForMonth(13)).toThrow(/month/);
  });

  it("rolls the season month over at UTC midnight, including leap February", () => {
    const at = Date.parse("2024-02-29T23:30:00Z");
    expect(createDiscoveryCalendar(() => at)()).toEqual({ month: 2, timeZone: "UTC" });
    expect(createDiscoveryCalendar(() => Date.parse("2024-03-01T00:00:00Z"))()).toEqual({ month: 3, timeZone: "UTC" });
    expect(createDiscoveryCalendar(() => Date.parse("2026-12-31T23:59:59Z"))().month).toBe(12);
    expect(createDiscoveryCalendar(() => Date.parse("2027-01-01T00:00:00Z"))().month).toBe(1);
  });
});

describe("immutable seasonal discovery policy", () => {
  it("covers the exact 90/10 threshold and all four alternative intervals", () => {
    expect(selectDiscoveryTheme("forest", .899999, .99)).toBe("forest");
    const others = ADVENTURE_THEMES.filter(theme => theme !== "forest");
    expect([0, .25, .5, .75].map(draw => selectDiscoveryTheme("forest", .9, draw))).toEqual(others);
    expect(() => selectDiscoveryTheme("forest", 1, 0)).toThrow(/draw/);
  });

  it("has 90% preferred and 2.5% each alternative in a fixed-seed sample", () => {
    const counts = new Map(ADVENTURE_THEMES.map(theme => [theme, 0]));
    for (let seed = 0; seed < 20_000; seed++) {
      const { theme } = discoverIslandClimate(seed, 120, { month: 7, timeZone: "UTC" });
      counts.set(theme, counts.get(theme)! + 1);
    }
    // Stated deterministic tolerance: ±1 percentage point preferred, ±0.5 each alternative.
    expect(counts.get("desert")!).toBeGreaterThan(17_800);
    expect(counts.get("desert")!).toBeLessThan(18_200);
    for (const theme of ADVENTURE_THEMES.filter(theme => theme !== "desert")) {
      expect(counts.get(theme)!).toBeGreaterThan(400);
      expect(counts.get(theme)!).toBeLessThan(600);
    }
  });

  it("rounds one immutable final route and validates it without reading today's date", () => {
    const calendar = { month: 2, timeZone: "UTC" };
    const seasonal = discoverIslandClimate(12, 121, calendar, { theme: "winter" });
    const distant = discoverIslandClimate(12, 121, calendar, { theme: "tropical" });
    expect(seasonal.voyageSeconds).toBe(121);
    expect(distant.voyageSeconds).toBe(152);
    expect(distant.discovery.baseVoyageSeconds).toBe(121);
    expect(islandDiscoveryError(JSON.parse(JSON.stringify(distant)))).toBeNull();
    expect(discoverIslandClimate(12, 121, calendar, { theme: "tropical" })).toEqual(distant);
    expect(islandDiscoveryError({ ...distant, voyageSeconds: 190 })).toMatch(/duration/);
    expect(islandDiscoveryError({ voyageSeconds: 140, theme: "desert" })).toBeNull();
    expect(SEASON_THEME[distant.discovery.season]).toBe("winter");
  });

  it("rejects unsupported policy/timezone and malformed debug overrides", () => {
    const record = discoverIslandClimate(1, 120, { month: 7, timeZone: "UTC" });
    expect(islandDiscoveryError({ ...record, discovery: { ...record.discovery, policyVersion: 2 } as never }))
      .toMatch(/Unsupported/);
    expect(islandDiscoveryError({ ...record, discovery: { ...record.discovery, timeZone: "bad-zone" } }))
      .toMatch(/metadata/);
    expect(islandDiscoveryError({ ...record, discovery: { ...record.discovery, debug: false as never } }))
      .toMatch(/override/);
    expect(() => discoverIslandClimate(1, Infinity, { month: 7, timeZone: "UTC" })).toThrow(/duration/);
  });

  it("clones nested metadata so a card snapshot cannot mutate its committed discovery", () => {
    const island = discoverIslandClimate(4, 120, { month: 7, timeZone: "UTC" }, { theme: "winter" });
    const copy = cloneDiscoveredIsland(island);
    copy.discovery!.debug!.theme = "desert";
    expect(island.discovery.debug!.theme).toBe("winter");
  });
});
