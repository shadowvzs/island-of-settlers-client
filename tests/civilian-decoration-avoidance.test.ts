import { expect, it } from "vitest";

import { isGroundSegmentClear } from "../src/shared/settlement/settlement-navigation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const contextAround = (isSupportClear: (point: { x: number; z: number }) => boolean) => {
  const size = 24;
  const world = { seed: 1, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 2, z: 2 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() } } as unknown as WorldData;
  return { options: { world }, buildings: [], actors: [], occupied: new Uint8Array(size ** 2),
    roadDecorations: { isSupportClear } } as unknown as SettlementContext;
};

it("rejects a civilian ground segment through a decoration support volume", () => {
  const context = contextAround(point => Math.abs(point.x - 8) > .5 || Math.abs(point.z - 6) > .5);
  expect(isGroundSegmentClear(context, { x: 5, z: 6 }, { x: 11, z: 6 })).toBe(false);
});

it("keeps the same segment clear when no decoration supports it", () => {
  const context = contextAround(() => true);
  expect(isGroundSegmentClear(context, { x: 5, z: 6 }, { x: 11, z: 6 })).toBe(true);
});
