import { describe, expect, it } from "vitest";

import {
  createRockyCells,
  fitTrunkAwayFromRock,
  ROCK_TRUNK_MARGIN
} from "../src/shared/world/generation/rock-clearance";

const GRID = { cellsX: 3, cellsZ: 3 };
const withRock = (rock: [number, number][]) =>
  createRockyCells(GRID, (x, z) => rock.some(([rx, rz]) => rx === x && rz === z));

/** Distance from a point to the nearest point of a unit cell. */
const distanceToCell = ([x, z]: [number, number], [cellX, cellZ]: [number, number]) =>
  Math.hypot(Math.max(cellX - x, 0, x - (cellX + 1)), Math.max(cellZ - z, 0, z - (cellZ + 1)));

describe("trunks and rock ground", () => {
  it("never places a trunk on a rocky cell", () => {
    expect(fitTrunkAwayFromRock(GRID, withRock([[1, 1]]), 1.5, 1.5)).toBeNull();
  });

  it("leaves trunks without rocky neighbours untouched", () => {
    expect(fitTrunkAwayFromRock(GRID, withRock([]), 1.05, 1.95)).toEqual([1.05, 1.95]);
  });

  it("moves a trunk away from the edge it shares with rock", () => {
    const [x, z] = fitTrunkAwayFromRock(GRID, withRock([[0, 1]]), 1.05, 1.2)!;
    expect(x).toBeCloseTo(1 + ROCK_TRUNK_MARGIN);
    expect(z).toBeCloseTo(1.2);
  });

  it("centres a trunk that is surrounded by rock", () => {
    const ring: [number, number][] = [];
    for (let z = 0; z < 3; z += 1)
      for (let x = 0; x < 3; x += 1) if (x !== 1 || z !== 1) ring.push([x, z]);
    const cells = withRock(ring);
    for (const [x, z] of [
      [1.02, 1.03],
      [1.97, 1.5],
      [1.5, 1.99],
      [1.01, 1.99]
    ] as const) {
      const fitted = fitTrunkAwayFromRock(GRID, cells, x, z)!;
      for (const rock of ring)
        expect(distanceToCell(fitted, rock)).toBeGreaterThanOrEqual(ROCK_TRUNK_MARGIN - 1e-9);
    }
  });

  it("keeps the margin from a rocky diagonal corner, even exactly at the corner", () => {
    const fitted = fitTrunkAwayFromRock(GRID, withRock([[0, 0]]), 1, 1)!;
    expect(distanceToCell(fitted, [0, 0])).toBeCloseTo(ROCK_TRUNK_MARGIN);
    expect(fitted[0]).toBeGreaterThan(1);
    expect(fitted[1]).toBeGreaterThan(1);
  });
});
