import { expect, it } from "vitest";

import { findSeaRoute } from "../src/shared/settlement/settlement-sea-navigation";
import { createSeaSearchWorkspaces } from "../src/shared/settlement/settlement-sea-search-workspace";
import type { WorldData } from "../src/shared/world/world-data";

it("leases private storage for reentrancy and cannot release a later lease twice", () => {
  const pool = createSeaSearchWorkspaces(), mask = new Uint8Array(64);
  const outer = pool.lease(mask), nested = pool.lease(mask);
  expect(nested.previous).not.toBe(outer.previous);
  outer.release();
  const later = pool.lease(mask); expect(later.previous).toBe(outer.previous);
  outer.release();
  const stillNested = pool.lease(mask); expect(stillNested.previous).not.toBe(later.previous);
  nested.release(); later.release(); stillNested.release();
  expect(pool.lease(new Uint8Array(128)).previous).toHaveLength(128);
});

it("clears both stamp sets before recycling a generation", () => {
  const pool = createSeaSearchWorkspaces(2), mask = new Uint8Array(8);
  const first = pool.lease(mask); first.seen[0] = first.generation; first.closed[0] = first.generation; first.release();
  const second = pool.lease(mask); second.seen[1] = second.generation; second.closed[1] = second.generation; second.release();
  const wrapped = pool.lease(mask);
  expect(wrapped.generation).toBe(first.generation);
  expect([...wrapped.seen]).toEqual(Array(8).fill(0));
  expect([...wrapped.closed]).toEqual(Array(8).fill(0)); wrapped.release();
});

it("keeps exact diagonal paths when a clear callback performs a nested route search", () => {
  const world = { cellsX: 8, cellsZ: 8 } as WorldData, sea = new Uint8Array(64).fill(1);
  let nested = false;
  const path = findSeaRoute(world, sea, { x: .5, z: .5 }, { x: 7.5, z: 7.5 }, () => {
    if (!nested) {
      nested = true;
      expect(findSeaRoute(world, sea, { x: 7.5, z: 7.5 }, { x: .5, z: .5 }))
        .toEqual(Array.from({ length: 7 }, (_, index) => ({ x: 6.5 - index, z: 6.5 - index })));
    }
    return true;
  });
  expect(path).toEqual(Array.from({ length: 7 }, (_, index) => ({ x: 1.5 + index, z: 1.5 + index })));
});

it("delivers independent retained frontier-exhaustion buffers through reentrant and later searches", () => {
  const world = { cellsX: 8, cellsZ: 8 } as WorldData;
  const sea = Uint8Array.from({ length: 64 }, (_, index) => Number(index % 8 !== 4));
  let certificate: Uint8Array | undefined;
  expect(findSeaRoute(world, sea, { x: .5, z: .5 }, { x: 7.5, z: .5 }, undefined, closed => {
    certificate = closed;
    expect(findSeaRoute(world, sea, { x: .5, z: .5 }, { x: 3.5, z: 7.5 })).not.toBeNull();
  })).toBeNull();
  const expected = Uint8Array.from({ length: 64 }, (_, index) => Number(index % 8 < 4));
  expect(certificate).toEqual(expected);
  expect(findSeaRoute(world, sea, { x: 7.5, z: .5 }, { x: 7.5, z: 7.5 })).not.toBeNull();
  expect(certificate).toEqual(expected);
  expect(findSeaRoute({ cellsX: 2, cellsZ: 2 } as WorldData, new Uint8Array([1, 0, 0, 1]),
    { x: .5, z: .5 }, { x: 1.5, z: 1.5 })).toBeNull();
});

it("matches fresh storage after mask edits, changed dimensions and both success/exhaustion outcomes", () => {
  const world = { cellsX: 8, cellsZ: 8 } as WorldData, sea = new Uint8Array(64);
  for (let iteration = 0; iteration < 120; iteration++) {
    world.cellsX = iteration % 2 ? 16 : 8; world.cellsZ = sea.length / world.cellsX;
    for (let index = 0; index < sea.length; index++) sea[index] = Number((index * 19 + iteration * 7) % 11 > 2);
    sea[0] = 1; sea[63] = 1;
    const from = { x: .5, z: .5 }, to = { x: world.cellsX - .5, z: world.cellsZ - .5 };
    const captures: Uint8Array[] = [], fresh: Uint8Array[] = [];
    expect(findSeaRoute(world, sea, from, to, undefined, closed => captures.push(closed)))
      .toEqual(findSeaRoute(world, sea.slice(), from, to, undefined, closed => fresh.push(closed)));
    expect(captures).toEqual(fresh);
  }
});
