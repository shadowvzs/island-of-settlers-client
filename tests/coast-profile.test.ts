import { describe, expect, it } from "vitest";

import { getCoastIndentShare, islandShoreDistance, type IslandSite } from "../src/shared/world/generation/archipelago-rules";
import { type CoastDetailBounds, coastDetailIndent } from "../src/shared/world/generation/coast-detail";

const site: IslandSite = {
  buildingCount: 4,
  phase: 1.37,
  radius: 100,
  spaceDepth: 40,
  spaceWidth: 40,
  x: 200,
  z: 200
};

const profile = Array.from({ length: 720 }, (_, step) => getCoastIndentShare(site, step * Math.PI / 360));

describe("natural coastline profile (M06)", () => {
  it("keeps the indentation inside the old envelope", () => {
    expect(Math.min(...profile)).toBeGreaterThanOrEqual(0.015);
    expect(Math.max(...profile)).toBeLessThanOrEqual(0.225);
    expect(Math.max(...profile) - Math.min(...profile)).toBeGreaterThan(0.1);
  });

  it("has many coves and headlands instead of the old three sines", () => {
    let extrema = 0;
    for (let index = 1; index < profile.length - 1; index += 1) {
      if ((profile[index]! - profile[index - 1]!) * (profile[index + 1]! - profile[index]!) < 0)
        extrema += 1;
    }
    expect(extrema).toBeGreaterThan(14);
  });

  it("is deterministic and periodic", () => {
    expect(getCoastIndentShare(site, 0.7)).toBe(getCoastIndentShare(site, 0.7));
    expect(getCoastIndentShare(site, 0)).toBeCloseTo(getCoastIndentShare(site, Math.PI * 2), 10);
  });
});

describe("large-island gulfs, bays and coves (COAST-NATURAL)", () => {
  const open: CoastDetailBounds = { baseShare: () => .1, limit: () => Infinity, shelter: () => 0 };
  const angles = Array.from({ length: 720 }, (_, step) => step * Math.PI / 360 - Math.PI);
  const detail = (radius: number) => angles.map(angle => coastDetailIndent({ ...site, radius }, angle, radius, open));

  it("leaves small islands unchanged", () => {
    expect(detail(40).every(indent => indent === 0)).toBe(true);
    const small = { ...site, radius: 36 };
    const expected = small.radius * (1 - getCoastIndentShare(small, 0.4)) - 20;
    const x = small.x + 20 * Math.cos(0.4), z = small.z + 20 * Math.sin(0.4);
    expect(islandShoreDistance(small, x, z)).toBeCloseTo(expected, 4);
  });

  it("only indents large islands, by at most a third of the radius", () => {
    const profile = detail(100);
    expect(Math.min(...profile)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...profile)).toBeLessThanOrEqual(100 / 3);
    expect(Math.max(...profile) - Math.min(...profile)).toBeGreaterThan(8);
  });

  it("is deterministic and periodic", () => {
    const large = { ...site, radius: 100 };
    expect(coastDetailIndent(large, 0.7, 95, open)).toBe(coastDetailIndent({ ...large }, 0.7, 95, open));
    expect(coastDetailIndent(large, -Math.PI, 95, open)).toBeCloseTo(coastDetailIndent(large, Math.PI, 95, open), 4);
  });
});
