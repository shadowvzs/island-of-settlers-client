import { describe, expect, it } from "vitest";

import type { BuildingFrame } from "../src/render-common/buildings/building-catalog";
import { createDepositSignPlacement } from "../src/render-common/rocks/deposit-sign-placement";
import { BuildingType } from "../src/shared/settlement/building-type-ids";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { BLOCKING, BUILD, type MineZone, ORE, type WorldData } from "../src/shared/world/world-data";

const fixture = () => ({ cellsX: 24, cellsZ: 24, blocking: new Uint8Array(24 * 24),
  buildClass: new Uint8Array(24 * 24).fill(BUILD.large),
  buildCap: new Uint8Array(24 * 24).fill(BUILD.large) }) as WorldData;
const zone: MineZone = { cellCount: 20, centreX: 12.5, centreZ: 12.5, id: 1,
  ore: ORE.iron, richness: .8, surveyed: true };
const road: RoadSegment = { end: { x: 12.5, z: 15 }, start: { x: 12.5, z: 9 }, tier: "dirt" };

describe("nonblocking surveyed-deposit sign placement", () => {
  it("moves clear of reserved road width, keeps a free position stable, and changes no collision bytes", () => {
    const world = fixture(), before = world.blocking.slice();
    const initial = createDepositSignPlacement(world, [], [])(zone)!;
    expect(initial).toEqual({ x: 12.5, z: 12.5 });
    const cell = Math.floor(initial.z) * world.cellsX + Math.floor(initial.x);
    expect(world.buildClass[cell]).toBeGreaterThanOrEqual(BUILD.flag);
    const moved = createDepositSignPlacement(world, [road], [])(zone, initial)!;
    expect(Math.abs(moved.x - 12.5)).toBeGreaterThan(.9);
    expect(createDepositSignPlacement(world, [], [])(zone, moved)).toEqual(moved);
    expect(world.blocking).toEqual(before);
  });
  it("shifts around a rotated building and its access lane", () => {
    const building = { id: "mine", type: BuildingType.Headquarters, x: 12.5, z: 12.5,
    rotation: Math.PI / 2 } as BuildingFrame;
    const point = createDepositSignPlacement(fixture(), [], [building])(zone)!;
    expect(Math.hypot(point.x - 12.5, point.z - 12.5)).toBeGreaterThan(2);
  });
  it("hides when no nearby ground remains, and can reappear after ground is freed", () => {
    const world = fixture(); world.blocking.fill(BLOCKING.water);
    expect(createDepositSignPlacement(world, [], [])(zone)).toBeNull();
    world.blocking[12 * 24 + 12] = BLOCKING.free;
    expect(createDepositSignPlacement(world, [], [])(zone)).toEqual({ x: 12.5, z: 12.5 });
  });
  it("uses the terrain cap, not merely free ground or a stale build class", () => {
    const world = fixture(); world.buildCap.fill(BUILD.none);
    expect(createDepositSignPlacement(world, [], [])(zone)).toBeNull();
    const cell = 12 * 24 + 12;
    world.buildCap[cell] = BUILD.mine; world.buildClass[cell] = BUILD.none;
    expect(createDepositSignPlacement(world, [], [])(zone)).toEqual({ x: 12.5, z: 12.5 });
  });
  it("keeps neighbouring signs separate and rejects cliff/tree cells", () => {
    const world = fixture(); world.blocking[12 * 24 + 12] = BLOCKING.prop;
    const place = createDepositSignPlacement(world, [], []);
    const first = place(zone)!;
    expect(first).not.toEqual({ x: 12.5, z: 12.5 });
    expect(place({ ...zone, id: 2 }, undefined, [first])).not.toEqual(first);
  });
});
