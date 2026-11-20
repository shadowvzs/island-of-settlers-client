import { expect, it } from "vitest";

import { findSeaExit } from "../src/shared/settlement/settlement-sea-exit";
import { createStaticSeaExitLookup } from "../src/shared/settlement/settlement-static-sea-exit";
import type { WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const world = { cellsX: 32, cellsZ: 32, terrainRevision: 0 } as WorldData;
  const mask = new Uint8Array(32 * 32).fill(1);
  return { mask, world };
};

it("keeps origin-sensitive BFS choices within the same connected sea and fractional origin cells", () => {
  const { mask, world } = fixture();
  const lookup = createStaticSeaExitLookup(world, () => mask);
  const north = { x: 16.1, z: 10.1 }, south = { x: 16.1, z: 21.1 };
  expect(lookup(north)).toEqual(findSeaExit(world, mask, north));
  expect(lookup(south)).toEqual(findSeaExit(world, mask, south));
  expect(lookup(north)).not.toEqual(lookup(south));
  expect(lookup({ x: 16.9, z: 10.9 })).toEqual(findSeaExit(world, mask, north));
  const returned = lookup(north)!;
  returned.x = -100;
  expect(lookup(north)).toEqual(findSeaExit(world, mask, north));
});

it("bypasses static results for changing custom acceptance predicates", () => {
  const { mask, world } = fixture();
  const lookup = createStaticSeaExitLookup(world, () => mask), from = { x: 16, z: 16 };
  lookup(from);
  let right = false;
  const accepts = (point: { x: number }) => right ? point.x > 24 : point.x < 8;
  const leftExit = lookup(from, accepts);
  expect(leftExit).toEqual(findSeaExit(world, mask, from, accepts));
  right = true;
  expect(lookup(from, accepts)).toEqual(findSeaExit(world, mask, from, accepts));
  expect(lookup(from, accepts)).not.toEqual(leftExit);
});

it("invalidates null and successful proofs when the owned mask or terrain revision changes", () => {
  const { world } = fixture();
  let mask = new Uint8Array(32 * 32);
  const lookup = createStaticSeaExitLookup(world, () => mask), from = { x: 16, z: 16 };
  expect(lookup(from)).toBeNull();
  mask = new Uint8Array(32 * 32).fill(1);
  expect(lookup(from)).toEqual(findSeaExit(world, mask, from));
  mask.fill(0); world.terrainRevision = 1;
  expect(lookup(from)).toBeNull();
});
