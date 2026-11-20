import { describe, expect, it } from "vitest";

import { getTerrainSurveyTarget } from "../src/app/settlement-ui/terrain-survey/helpers";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { FOG, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const cells = 16;
  const world = { cellsX: cells, cellsZ: cells, seaLevel: -1,
    blocking: new Uint8Array(cells ** 2), fog: new Uint8Array(cells ** 2).fill(FOG.visible),
    heights: new Float32Array((cells + 1) ** 2), walkCost: new Uint8Array(cells ** 2).fill(10),
    mineZone: new Uint16Array(cells ** 2), mineZones: [] } as unknown as WorldData;
  const point = { x: 8.5, z: 8.5 }, cell = 8 * cells + 8;
  return { cell, point, world };
};

describe("contextual terrain dispatch", () => {
  it("offers a Scout on reachable unknown ground without leaking any hidden mine data", () => {
    const { cell, point, world } = fixture();
    world.fog[cell] = FOG.hidden;
    world.mineZone[cell] = 1;
    world.mineZones.push({ id: 1, ore: 2, richness: .99, surveyed: false } as never);
    const target = getTerrainSurveyTarget(world, point, []);
    expect(target).toMatchObject({ job: "Scout", point });
    expect(JSON.stringify(target)).not.toMatch(/richness|coal|iron|gold|99|ore deposit/i);
  });

  it.each([0, 1, 2, 3, 4])("offers a geologist for known unsurveyed mine terrain regardless of hidden ore %s", ore => {
    const { cell, point, world } = fixture();
    world.mineZone[cell] = 1;
    world.mineZones.push({ id: 1, ore, richness: .7, surveyed: false } as never);
    const target = getTerrainSurveyTarget(world, point, []);
    expect(target?.job).toBe("Geologist");
    expect(target?.title).toBe("Survey mine field");
    expect(JSON.stringify(target)).not.toMatch(/coal|gold|iron|granite|0\.7/i);
    world.mineZones[0]!.surveyed = true;
    expect(getTerrainSurveyTarget(world, point, [])).toBeNull();
  });

  it("leaves roads, blocked plots, water and ordinary known ground to their existing interactions", () => {
    const { cell, point, world } = fixture();
    expect(getTerrainSurveyTarget(world, point, [])).toBeNull();
    world.fog[cell] = FOG.hidden;
    const road: RoadSegment = { start: { x: 8, z: 8.5 }, end: { x: 10, z: 8.5 }, tier: "dirt" };
    expect(getTerrainSurveyTarget(world, point, [road])).toBeNull();
    world.blocking[cell] = 1;
    expect(getTerrainSurveyTarget(world, point, [])).toBeNull();
    world.blocking[cell] = 0;
    world.walkCost[cell] = 0;
    expect(getTerrainSurveyTarget(world, point, [])).toBeNull();
    world.walkCost[cell] = 10;
    world.heights.fill(-2);
    expect(getTerrainSurveyTarget(world, point, [])).toBeNull();
  });

  it("honours fog display off and rejects off-island or non-finite clicks", () => {
    const { cell, point, world } = fixture();
    world.fog[cell] = FOG.hidden;
    world.fogDisplayDisabled = true;
    expect(getTerrainSurveyTarget(world, point, [])).toBeNull();
    for (const x of [-1, 16, Infinity, NaN]) expect(getTerrainSurveyTarget(world, { ...point, x }, [])).toBeNull();
  });
});
