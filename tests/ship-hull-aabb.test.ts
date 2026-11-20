import { expect, it } from "vitest";

import { createShipClearanceMasks, shipHullFitsSea } from "../src/shared/settlement/settlement-ship-clearance";
import { findTurningPortal } from "../src/shared/settlement/settlement-ship-portal";
import type { WorldData } from "../src/shared/world/world-data";

it("preserves original shore samples at rotated, fractional, negative and near-integer boundaries", () => {
  const world = { cellsX: 64, cellsZ: 64, terrainRevision: 0 } as WorldData;
  const sea = Uint8Array.from({ length: 64 * 64 }, (_, index) => {
    const x = index % 64, z = Math.floor(index / 64);
    return Number(x >= 8 && x < 56 && z >= 8 && z < 56 && !(x === 31 && z % 3 === 0));
  });
  const masks = createShipClearanceMasks(world, sea);
  const headings = [0, -0, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI,
    ...Array.from({ length: 80 }, (_, index) => index / 13)];
  const coordinates = [-1e-10, -0, 0, 1e-10, 8 - 1e-10, 8, 8 + 1e-10,
    16, 31 - 1e-10, 31, 31 + 1e-10, 32.5, 55.5, 64, 2 ** 52, NaN, Infinity, -Infinity];
  for (const yaw of headings) for (const x of coordinates) for (const z of [0, 8, 16, 31, 32.5, 55.5, 64]) {
    const pose = { x, z, yaw };
    expect(masks.hullFitsSea(world, sea, pose)).toBe(shipHullFitsSea(world, sea, pose));
  }
});

it("uses raw fallback for another sea/world, dimensions or changed terrain revision", () => {
  const world = { cellsX: 64, cellsZ: 64, terrainRevision: 0 } as WorldData;
  const sea = new Uint8Array(64 * 64).fill(1), masks = createShipClearanceMasks(world, sea);
  const pose = { x: 32, z: 32, yaw: -.217 }, dry = new Uint8Array(sea.length);
  expect(masks.hullFitsSea(world, sea, pose)).toBe(true);
  expect(masks.hullFitsSea(world, dry, pose)).toBe(false);
  expect(masks.hullFitsSea({ ...world }, dry, pose)).toBe(false);
  sea.fill(0); world.terrainRevision = 1;
  expect(masks.hullFitsSea(world, sea, pose)).toBe(false);
  world.cellsX = 32;
  expect(masks.hullFitsSea(world, sea, pose)).toBe(shipHullFitsSea(world, sea, pose));
  expect(createShipClearanceMasks(world, sea).hullFitsSea(world, sea, pose)).toBe(false);
});

it("retains custom-mask raw fallback and complete bounded portal outcomes", () => {
  const world = { cellsX: 64, cellsZ: 64, terrainRevision: 0 } as WorldData;
  const sea = Uint8Array.from({ length: 64 * 64 }, (_, index) => Number(index % 64 > 7 && index % 64 < 60));
  const masks = createShipClearanceMasks(world, sea);
  const custom = { parallelX: masks.parallelX, parallelZ: masks.parallelZ, turning: masks.turning };
  for (const from of [{ x: 10, z: 30, yaw: 0 }, { x: 12, z: 30, yaw: .217 },
    { x: 12, z: 30, yaw: Math.PI / 2 }]) for (const max of [1, 64, 512]) {
    const search = { blocked: [{ x: 17, z: 30, yaw: 0 }], sea, world };
    expect(findTurningPortal({ ...search, masks }, from, max))
      .toEqual(findTurningPortal({ ...search, masks: custom }, from, max));
  }
});
