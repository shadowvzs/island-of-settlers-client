import { expect, it } from "vitest";

import { TWO_LANE_CART_HALF_WIDTH } from "../src/render-common/logistics/handcart-rules";
import { createRoadVergeFreeTest } from "../src/render-common/road-verges/road-verge-free";
import { createRoadVergePlacements } from "../src/render-common/road-verges/road-verge-placement";
import { VERGE_SPECIES, vergePlantRadius } from "../src/render-common/road-verges/verge-plant-geometry";
import { BRIDGE_FLARE_LENGTH, bridgeFlareWidth } from "../src/shared/settlement/bridge-approaches";
import { BRIDGE_DECK_WIDTH, ROAD_STONE_WIDTH, roadRibbonWidth,
  type RoadSegment } from "../src/shared/settlement/road-types";

const world = { cellsX: 64, cellsZ: 64 };
const road = (ax: number, az: number, bx: number, bz: number): RoadSegment => ({
  end: { x: bx, z: bz }, start: { x: ax, z: az }, tier: "dirt", verge: "flowers"
});
/** Half-cell road steps, as the road network stores them. */
const steps = (ax: number, az: number, bx: number, bz: number) => {
  const count = Math.round(Math.hypot(bx - ax, bz - az) / .5);
  return Array.from({ length: count }, (_, index) => road(ax + (bx - ax) * index / count,
    az + (bz - az) * index / count, ax + (bx - ax) * (index + 1) / count, az + (bz - az) * (index + 1) / count));
};
const distanceTo = (x: number, z: number, segment: RoadSegment) => {
  const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
  const t = Math.max(0, Math.min(1, ((x - segment.start.x) * dx + (z - segment.start.z) * dz) /
    (dx * dx + dz * dz || 1)));
  return Math.hypot(x - segment.start.x - t * dx, z - segment.start.z - t * dz);
};
const free = () => true;
const positions = (segments: readonly RoadSegment[]) =>
  createRoadVergePlacements(segments, world, free)
    .map(placement => [placement.x, placement.z, placement.band].join(":")).sort();

it("grows no verge plant beside an unplanted road", () => {
  const unplanted = steps(4, 10, 28, 10).map(({ start, end, tier }) => ({ start, end, tier }));
  expect(createRoadVergePlacements(unplanted, world, free)).toEqual([]);
});

it("produces identical placements when one road is split into two segments", () => {
  expect(positions([...steps(4, 10, 16, 10), ...steps(16, 10, 28, 10)])).toEqual(positions(steps(4, 10, 28, 10)));
});

it("keeps every whole plant outside the two-lane cart clearance and skips bridges", () => {
  const segments = [...steps(4, 10, 28, 10), { ...road(10, 14, 20, 14), bridge: {} as never }];
  const placements = createRoadVergePlacements(segments, world, free);
  expect(placements.length).toBeGreaterThan(100);
  for (const placement of placements) {
    const reach = vergePlantRadius(placement.kind) * placement.scale;
    expect(distanceTo(placement.x, placement.z, road(4, 10, 28, 10)) - reach)
      .toBeGreaterThanOrEqual(TWO_LANE_CART_HALF_WIDTH - 1e-9);
    expect(placement.rank).toBeGreaterThanOrEqual(0);
    expect(placement.rank).toBeLessThan(1);
  }
  expect(placements.every(placement => distanceTo(placement.x, placement.z, segments.at(-1)!) > 2)).toBe(true);
  expect(new Set(placements.map(placement => placement.kind))).toEqual(new Set(VERGE_SPECIES));
});

it("does not stack plants of one band in the same quarter-cell, even where roads cross", () => {
  const placements = createRoadVergePlacements([...steps(4, 10, 28, 10), ...steps(16, 2, 16, 20)], world, free);
  const cells = placements.map(placement =>
    `${placement.band}${Math.floor(placement.x * 4)},${Math.floor(placement.z * 4)}`);
  expect(new Set(cells).size).toBe(cells.length);
});

it("keeps verges off plots, water and the lanes of a crossing road", () => {
  const segments = [...steps(4, 20, 28, 20), ...steps(16, 8, 16, 32)];
  const isFree = createRoadVergeFreeTest({ blocked: [{ maxX: 10, maxZ: 23, minX: 6, minZ: 21.2 }],
    isBare: x => x > 24, roads: segments });
  const placements = createRoadVergePlacements(segments, world, isFree);
  expect(placements.length).toBeGreaterThan(50);
  for (const placement of placements) {
    const reach = vergePlantRadius(placement.kind) * placement.scale;
    for (const segment of segments)
      expect(distanceTo(placement.x, placement.z, segment) - reach)
        .toBeGreaterThanOrEqual(TWO_LANE_CART_HALF_WIDTH - 1e-9);
    expect(placement.x <= 24).toBe(true);
    expect(placement.x > 6 - reach && placement.x < 10 + reach && placement.z > 21.2 - reach).toBe(false);
    if (placement.band === "C") expect(Math.hypot(placement.x - 16, placement.z - 20)).toBeGreaterThanOrEqual(1.4);
  }
});

it("keeps a continuous, gently varying verge on every 4 m stretch (owner 2026-11-08)", () => {
  const placements = createRoadVergePlacements(steps(4, 10, 52, 10), world, free);
  const side = placements.filter(placement => placement.z > 10);
  const windows = Array.from({ length: 12 }, (_, index) => side.filter(placement =>
    placement.x >= 4 + index * 4 && placement.x < 8 + index * 4).length);
  const mean = windows.reduce((sum, count) => sum + count, 0) / windows.length;
  expect(mean).toBeGreaterThan(8);
  // No bare stretch and no over-dense flower bed: every window stays within 25 % of the mean.
  expect(Math.min(...windows)).toBeGreaterThanOrEqual(mean * .75);
  expect(Math.max(...windows)).toBeLessThanOrEqual(mean * 1.25);
  // Master's drift threshold placed 467 plants on this side and 913 in total (owner reference).
  expect(side.length).toBeLessThanOrEqual(467);
  expect(placements.length).toBeLessThanOrEqual(913);
});

it("keeps the verge off the flared shore road at a bridge end, not only off the deck", () => {
  const deck: RoadSegment = { ...road(20, 10, 24, 10), bridge: { width: BRIDGE_DECK_WIDTH } as never };
  const shore = steps(4, 10, 20, 10).map((segment, index, all) => {
    const fromDeck = (all.length - index) * .5;
    const width = (distance: number) => bridgeFlareWidth(segment, distance);
    if (fromDeck > BRIDGE_FLARE_LENGTH) return segment;
    return { ...segment, endWidth: width(fromDeck - .5), startWidth: width(fromDeck) };
  });
  const segments = [...shore, deck];
  const isFree = createRoadVergeFreeTest({ blocked: [], isBare: () => false, roads: segments });
  const placements = createRoadVergePlacements(segments, world, isFree);
  expect(placements.some(placement => placement.x > 18.5 && placement.x < 20)).toBe(true);
  for (const placement of placements) {
    const reach = vergePlantRadius(placement.kind) * placement.scale;
    for (const segment of segments) {
      const dx = segment.end.x - segment.start.x;
      const fraction = Math.max(0, Math.min(1, (placement.x - segment.start.x) / dx));
      const ribbonEdge = roadRibbonWidth(segment, fraction) / 2;
      expect(distanceTo(placement.x, placement.z, segment) - reach).toBeGreaterThan(ribbonEdge);
      expect(distanceTo(placement.x, placement.z, segment) - reach)
        .toBeGreaterThanOrEqual(TWO_LANE_CART_HALF_WIDTH + Math.max(0, ribbonEdge - ROAD_STONE_WIDTH / 2) - 1e-9);
    }
  }
});
