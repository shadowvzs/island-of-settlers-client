import { describe, expect, it } from "vitest";

import { getMineVertexField, refreshMineVertexField } from "../src/render-common/mine-field";
import { BLOCKING, BUILD, NO_MINE_ZONE, ORE, SLOPE, type WorldData } from "../src/shared/world/world-data";

const fixture = () => ({
  cellsX: 6, cellsZ: 6,
  mineZone: new Uint16Array(36).fill(1), oreAmount: new Uint8Array(36).fill(200),
  mineZones: [{ id: 1, surveyed: true, ore: ORE.gold }],
  buildCap: new Uint8Array(36).fill(BUILD.mine),
  blocking: new Uint8Array(36).fill(BLOCKING.free),
  slopeClass: new Uint8Array(36).fill(SLOPE.gentle)
}) as unknown as WorldData;

const centre = 3 * 7 + 3;
const cell = 3 * 6 + 3;
const changed = { minX: 3, maxX: 3, minZ: 3, maxZ: 3 };

describe("mine glints stay inside buildable deposit ground", () => {
  it("retains ore shading but hides glints across a cliff and outside the deposit", () => {
    const world = fixture(), field = getMineVertexField(world);
    expect(field.glint[centre]).toBe(255);
    world.blocking[cell] = BLOCKING.cliff;
    refreshMineVertexField(world, changed);
    expect(field.glint[centre]).toBe(0);
    expect(field.amount[centre]).toBe(200);
    world.blocking[cell] = BLOCKING.free;
    world.mineZone[cell] = NO_MINE_ZONE;
    refreshMineVertexField(world, changed);
    expect(field.glint[centre]).toBe(0);
  });

  it("updates after terrain becomes buildable, without inventing ore on the map edge", () => {
    const world = fixture(); world.buildCap[cell] = BUILD.none;
    const field = getMineVertexField(world);
    expect(field.glint[centre]).toBe(0);
    world.buildCap[cell] = BUILD.flag;
    refreshMineVertexField(world, changed);
    expect(field.glint[centre]).toBe(255);
    world.slopeClass[cell] = SLOPE.cliff;
    refreshMineVertexField(world, changed);
    expect(field.glint[centre]).toBe(0);
    expect(field.glint[0]).toBe(0);
  });
});
