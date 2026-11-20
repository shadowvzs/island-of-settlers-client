import { expect, it } from "vitest";

import { findSeaRoute } from "../src/shared/settlement/settlement-sea-navigation";
import { createSeaRouteFailures } from "../src/shared/settlement/settlement-sea-route-failures";
import type { WorldData } from "../src/shared/world/world-data";

const directedFixture = () => {
  const world = { cellsX: 8, cellsZ: 4 } as WorldData, sea = new Uint8Array(32).fill(1);
  const blocked = [{ x: 3, z: 2, yaw: -0 }];
  const proofs = createSeaRouteFailures(world);
  const rightward = (from: { x: number }, to: { x: number }) => to.x >= from.x;
  expect(findSeaRoute(world, sea, { x: 2.5, z: 1.5 }, { x: .5, z: 1.5 }, rightward,
    reachable => proofs.record({ x: 2.5, z: 1.5 }, blocked, reachable))).toBeNull();
  return { blocked, proofs, rightward, sea, world };
};

it("reuses a real complete forward closure from a different origin without assuming undirected edges", () => {
  const { blocked, proofs, rightward, sea, world } = directedFixture();
  const from = { x: 5.5, z: 2.5 }, outside = { x: 1.5, z: .5 }, inside = { x: 6.5, z: .5 };
  expect(proofs.unreachable(from, outside, blocked)).toBe(true);
  expect(findSeaRoute(world, sea, from, outside, rightward)).toBeNull();
  expect(proofs.unreachable(from, inside, blocked)).toBe(false);
  expect(findSeaRoute(world, sea, from, inside, rightward)).not.toBeNull();
  // The proof says nothing about a source outside its forward closure, or a same-cell goal.
  expect(proofs.unreachable(outside, { x: .5, z: .5 }, blocked)).toBe(false);
  expect(proofs.unreachable(from, from, blocked)).toBe(false);
});

it("allows added or reordered exact blockers but refuses removed or changed blocker poses", () => {
  const { blocked, proofs } = directedFixture();
  const from = { x: 5.5, z: 2.5 }, outside = { x: .5, z: .5 };
  expect(proofs.unreachable(from, outside, [{ x: 7, z: 2, yaw: 1 }, ...blocked, ...blocked])).toBe(true);
  expect(proofs.unreachable(from, outside, [])).toBe(false);
  expect(proofs.unreachable(from, outside, [{ ...blocked[0]!, x: 3.0000000001 }])).toBe(false);
  expect(proofs.unreachable(from, outside, [{ ...blocked[0]!, yaw: 0 }])).toBe(false);
});

it("clears old proofs when sailing geometry or grid dimensions change", () => {
  const { blocked, proofs } = directedFixture();
  const from = { x: 5.5, z: 2.5 }, outside = { x: .5, z: .5 };
  proofs.clear();
  expect(proofs.unreachable(from, outside, blocked)).toBe(false);
  const again = directedFixture();
  again.world.cellsX = 4; again.world.cellsZ = 8;
  expect(again.proofs.unreachable({ x: 1.5, z: 5.5 }, outside, again.blocked)).toBe(false);
});
