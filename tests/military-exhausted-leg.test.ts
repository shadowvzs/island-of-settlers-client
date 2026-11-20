import { expect, it } from "vitest";

import { publicTerrainLegPath } from "../src/shared/settlement/settlement-terrain-routing";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const flatWorld = () => {
  const size = 40;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5, z: 5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() } } as unknown as WorldData;
};

it("falls back to the whole-tile corridor when the fine single-leg search is empty", () => {
  const world = flatWorld();
  const context = { options: { world }, buildings: [], actors: [], occupied: new Uint8Array(40 * 40) } as
    unknown as SettlementContext;
  const from = { x: 5, z: 5 }, to = { x: 22, z: 20 };
  const path = publicTerrainLegPath(context, from, to, false, () => null);
  expect(path).not.toBeNull();
  expect(path!.at(-1)).toMatchObject({ x: expect.any(Number), z: expect.any(Number) });
});

it("still refuses a leg whose destination is not clear", () => {
  const world = flatWorld();
  world.walkCost[20 * 40 + 22] = 0;
  const context = { options: { world }, buildings: [], actors: [], occupied: new Uint8Array(40 * 40) } as
    unknown as SettlementContext;
  expect(publicTerrainLegPath(context, { x: 5, z: 5 }, { x: 22.5, z: 20.5 }, false, () => null))
    .toBeNull();
});
