import { describe, expect, it } from "vitest";

import { doorAngleTo, doorDirection, islandCentre, turnsFacing } from "../src/shared/settlement/enemy-building-facing";
import type { WorldData } from "../src/shared/world/world-data";

describe("enemy building facing", () => {
  it("matches the placement convention: turn 0 opens to +z, turn 1 to +x", () => {
    expect(doorDirection(0).z).toBeCloseTo(1);
    expect(doorDirection(1).x).toBeCloseTo(1);
    expect(doorDirection(2).z).toBeCloseTo(-1);
    expect(doorDirection(3).x).toBeCloseTo(-1);
  });

  it("orders turns from the closest front to the farthest", () => {
    const centre = { x: 50, z: 50 };
    expect(turnsFacing({ x: 80, z: 45 }, centre)).toEqual([3, 0, 2, 1]);
    expect(turnsFacing({ x: 52, z: 10 }, centre)[0]).toBe(0);
    expect(doorAngleTo(3, { x: 80, z: 50 }, centre)).toBeCloseTo(0);
    expect(doorAngleTo(1, { x: 80, z: 50 }, centre)).toBeCloseTo(Math.PI);
  });

  it("finds the mean of the walkable cells", () => {
    const walkCost = new Uint8Array(16);
    walkCost[1 * 4 + 2] = 1; walkCost[3 * 4 + 2] = 1;
    expect(islandCentre({ cellsX: 4, cellsZ: 4, walkCost } as unknown as WorldData)).toEqual({ x: 2.5, z: 2.5 });
  });
});
