import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { RoadSegment } from "../src/shared/settlement/road-types";
import {
  findSharedLayBy,
  insideBuildingEnvelope,
  isValidSharedLayBy,
  layByClearOfRoads,
  MAX_SHARED_LAY_BY_WALK
} from "../src/shared/settlement/settlement-carrier-laybys";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { legacyInwardBay } from "./helpers/lay-by-regression";

interface FixtureSave {
  settlement: {
    buildings: SettlementBuilding[];
    roads: Array<{ start: { x: number; z: number }; end: { x: number; z: number }; tier?: string }>;
    world: { cellsX: number; cellsZ: number };
  };
}

const fixture = (): SettlementContext => {
  const save = JSON.parse(readFileSync(
    new URL("../public/demo/continued-0.json", import.meta.url), "utf8"
  )) as FixtureSave;
  const { buildings, roads, world } = save.settlement;
  const segments = roads as unknown as RoadSegment[];
  return {
    buildings,
    clock: { tick: () => 0 },
    options: {
      roads: { revision: 1, segments: () => segments },
      world: { ...world, blocking: new Uint8Array(world.cellsX * world.cellsZ) }
    }
  } as unknown as SettlementContext;
};

const segments = (context: SettlementContext) =>
  context.options.roads.segments!() as unknown as RoadSegment[];

describe("shared lay-by selection", () => {
  it("rejects the legacy 0.8 inward bay that sits inside 36/39 fixture buildings", () => {
    const context = fixture();
    let inside = 0, notOffRoad = 0;
    for (const building of context.buildings) {
      const legacy = legacyInwardBay(building);
      if (insideBuildingEnvelope(building, legacy)) inside++;
      if (!layByClearOfRoads(legacy, segments(context))) notOffRoad++;
    }
    expect(inside).toBeGreaterThanOrEqual(36);
    expect(notOffRoad).toBeGreaterThanOrEqual(36);
  });

  it("finds valid off-road bays on the actual fixture geometry and rejects the inward point", () => {
    const context = fixture();
    const found: number[] = [];
    for (const building of context.buildings) {
      const legacy = legacyInwardBay(building);
      expect(isValidSharedLayBy(context, legacy)).toBe(false);
      const bay = findSharedLayBy(context, building);
      if (!bay) continue;
      found.push(building.uid);
      expect(bay.walk).toBeLessThanOrEqual(MAX_SHARED_LAY_BY_WALK);
      expect(insideBuildingEnvelope(building, bay)).toBe(false);
      expect(isValidSharedLayBy(context, bay)).toBe(true);
    }
    // A dense fixture cannot place a bay for every plot; those stops must stay cartless.
    expect(found.length).toBeGreaterThanOrEqual(30);
    expect(found.length).toBeLessThan(context.buildings.length);
  });

  it("picks the headquarters bay beside the road, not between the signpost and the plot", () => {
    const context = fixture();
    const headquarters = context.buildings.find(building => building.uid === 0)!;
    const bay = findSharedLayBy(context, headquarters)!;
    expect(bay).toBeDefined();
    expect(bay.x === legacyInwardBay(headquarters).x && bay.z === legacyInwardBay(headquarters).z)
      .toBe(false);
    expect(isValidSharedLayBy(context, bay)).toBe(true);
  });
});
