import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { DMath } from "../src/shared/math/deterministic-math";
import { findSeaRoute } from "../src/shared/settlement/settlement-sea-navigation";
import { ENVELOPE_REACH, type ShipObstacle, shipsOverlap } from "../src/shared/settlement/settlement-ship-clearance";
import { createShipGridCollisionQueries } from "../src/shared/settlement/settlement-ship-grid-collision";
import type { SettlementPoint } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";

const raw = (blocked: readonly ShipObstacle[]) => (a: SettlementPoint, b: SettlementPoint) => {
  const yaw = DMath.atan2(b.x - a.x, b.z - a.z);
  const hits = (point: SettlementPoint) => blocked.some(other => Math.abs(other.x - point.x) < ENVELOPE_REACH &&
    Math.abs(other.z - point.z) < ENVELOPE_REACH && shipsOverlap({ ...point, yaw }, other));
  return !hits(a) && !hits(b);
};

it("preserves all eight directed headings near exact hull contacts and signed-zero obstacle yaws", () => {
  const world = { cellsX: 32, cellsZ: 32 } as WorldData, mask = new Uint8Array(1024);
  const pool = createShipGridCollisionQueries();
  for (const yaw of [0, -0, Math.PI, -Math.PI, Math.PI / 2, -.217]) {
    const blocked = [{ x: 16.5, z: 16.5, yaw }, { x: 23.5 + 1e-10, z: 15.5, yaw: -.217 }];
    const query = pool.open(world, mask, blocked), reference = raw(blocked);
    for (let x = 9; x < 25; x++) for (let z = 9; z < 25; z++)
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
        const from = { x: x + .5, z: z + .5 }, to = { x: x + .5 + dx!, z: z + .5 + dz! };
        expect(query.clear(from, to)).toBe(reference(from, to));
        expect(query.clearGrid(z * world.cellsX + x, (z + dz!) * world.cellsX + x + dx!, dx!, dz!))
          .toBe(reference(from, to));
      }
    query.release();
  }
});

it("does not share outcomes across changed obstacles, reentrant leases, mask changes or generation wrap", () => {
  const world = { cellsX: 16, cellsZ: 16 } as WorldData, mask = new Uint8Array(256);
  const pool = createShipGridCollisionQueries(2), from = { x: 8.5, z: 8.5 }, to = { x: 9.5, z: 8.5 };
  const outer = pool.open(world, mask, [{ x: 8.5, z: 8.5, yaw: 0 }]);
  expect(outer.clear(from, to)).toBe(false);
  const nested = pool.open(world, mask, []); expect(nested.clear(from, to)).toBe(true);
  nested.release(); expect(outer.clear(from, to)).toBe(false); outer.release();
  for (const blocked of [[], [{ x: 8.5, z: 8.5, yaw: 0 }], [], [{ x: 8.5, z: 8.5, yaw: Math.PI }]]) {
    const query = pool.open(world, mask, blocked);
    expect(query.clear(from, to)).toBe(raw(blocked)(from, to)); query.release();
  }
  const replacement = pool.open(world, mask.slice(), []);
  expect(replacement.clear(from, to)).toBe(true); replacement.release();
});

it("preserves clipped fractional boundary stencils through dimension changes and FIFO eviction", () => {
  const pool = createShipGridCollisionQueries(), mask = new Uint8Array(256);
  const dimensions = [[16, 16], [32, 8], [8, 32]];
  for (let index = 0; index < 270; index++) {
    const [cellsX, cellsZ] = dimensions[index % dimensions.length]!;
    const world = { cellsX, cellsZ } as WorldData;
    const blocked = [{ x: .5 + index / 256, z: .5, yaw: index / 100 }];
    const query = pool.open(world, mask, blocked), reference = raw(blocked);
    for (const x of [0, 1, cellsX! - 2]) for (const z of [0, 1, cellsZ! - 2]) {
      const from = { x: x + .5, z: z + .5 }, to = { x: x + 1.5, z: z + .5 };
      expect(query.clear(from, to)).toBe(reference(from, to));
    }
    query.release();
  }
  const world = { cellsX: 16, cellsZ: 16 } as WorldData;
  for (const offset of [-1e-12, 0, 1e-12]) {
    const blocked = [{ x: .5 + ENVELOPE_REACH + offset, z: .5, yaw: -0 }];
    const query = pool.open(world, mask, blocked), reference = raw(blocked);
    expect(query.clear({ x: .5, z: .5 }, { x: 1.5, z: .5 }))
      .toBe(reference({ x: .5, z: .5 }, { x: 1.5, z: .5 }));
    query.release();
  }
});

it("preserves all 530 captured A-star paths and exact retained exhaustion buffers", async () => {
  const trace = JSON.parse(await readFile(resolve(
    "../resources/project-reviews/acceptance-2026-10-28/actual-query-repeat-complete/report.json"), "utf8"));
  const masks = trace.masks.map((mask: { width: number; height: number; base64: string }) => ({
    world: { cellsX: mask.width, cellsZ: mask.height } as WorldData, sea: Uint8Array.from(Buffer.from(mask.base64, "base64")) }));
  const pool = createShipGridCollisionQueries();
  expect(trace.queryDetails).toHaveLength(530);
  for (const captured of trace.queryDetails) {
    const { sea, world } = masks[captured.maskId]!;
    const blocked = captured.blocked ? captured.blocked.split(";").map((pose: string) => {
      const [x, z, yaw] = pose.split(",").map(Number); return { x: x!, z: z!, yaw: yaw! };
    }) : [];
    const query = pool.open(world, sea, blocked);
    const actualClosed: Uint8Array[] = [], expectedClosed: Uint8Array[] = [], numericClosed: Uint8Array[] = [];
    const path = findSeaRoute(world, sea, captured.fromExact, captured.toExact, query.clear, cells => actualClosed.push(cells));
    const numericPath = findSeaRoute(world, sea, captured.fromExact, captured.toExact,
      () => { throw new Error("Numeric clearance must not invoke the point fallback"); },
      cells => numericClosed.push(cells), query.clearGrid);
    query.release();
    assert.deepEqual(numericPath, path);
    assert.deepEqual(path, findSeaRoute(world, sea, captured.fromExact, captured.toExact, raw(blocked), cells => expectedClosed.push(cells)));
    assert.equal(actualClosed.length, expectedClosed.length);
    for (const [index, cells] of actualClosed.entries())
      assert(Buffer.from(cells).equals(Buffer.from(expectedClosed[index]!)));
    assert.equal(numericClosed.length, expectedClosed.length);
    for (const [index, cells] of numericClosed.entries())
      assert(Buffer.from(cells).equals(Buffer.from(expectedClosed[index]!)));
  }
});
import assert from "node:assert/strict";
