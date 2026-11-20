import { describe, expect, it, vi } from "vitest";

import {
  createSeaMask,
  findCoastalWorkSite
} from "../src/shared/settlement/settlement-sea-navigation";
import type { SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import type { WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 40;
  const heights = new Float32Array((size + 1) ** 2);
  const walkCost = new Uint8Array(size ** 2).fill(10);
  for (let z = 0; z <= size; z++) for (let x = 16; x <= size; x++) heights[z * (size + 1) + x] = -2;
  for (let z = 0; z < size; z++) for (let x = 16; x < size; x++) walkCost[z * size + x] = 0;
  const world = {
    cellsX: size,
    cellsZ: size,
    seaLevel: -1,
    heights,
    walkCost,
    blocking: new Uint8Array(size ** 2),
    props: { count: 0 }
  } as unknown as WorldData;
  const findWorkerPath = vi.fn(
    (_from: SettlementPoint, to: SettlementPoint): SettlementPoint[] | null => [{ ...to }]
  );
  const roads = { revision: 0 };
  const context = {
    options: { world, roads, findWorkerPath },
    occupied: new Uint8Array(size ** 2),
    navigationRevision: 0
  } as unknown as SettlementContext;
  const building = { access: { x: 12.5, z: 20.5 } };
  const sea = createSeaMask(world);
  const find = () => findCoastalWorkSite(context, building, sea, new Set(), 8);
  return { context, find, findWorkerPath, roads, world };
};

describe("coastal carrier route reuse", () => {
  it("reuses unchanged shore routes and protects cached points from a caller's edits", () => {
    const { find, findWorkerPath } = fixture();
    const first = find()!;
    expect(first).not.toBeNull();
    const calls = findWorkerPath.mock.calls.length;
    const originalX = first.path[0]!.x;
    first.path[0]!.x = -100;
    expect(find()!.path[0]!.x).toBe(originalX);
    expect(findWorkerPath).toHaveBeenCalledTimes(calls);
  });

  it("checks each unreachable land point once and retries it after a navigation change", () => {
    const { context, find, findWorkerPath } = fixture();
    findWorkerPath.mockReturnValue(null);
    expect(find()).toBeNull();
    const points = findWorkerPath.mock.calls.map(([, to]) => `${to.x},${to.z}`);
    expect(points.length).toBeGreaterThan(0);
    expect(new Set(points).size).toBe(points.length);
    const calls = points.length;
    expect(find()).toBeNull();
    expect(findWorkerPath).toHaveBeenCalledTimes(calls);
    context.navigationRevision!++;
    findWorkerPath.mockImplementation((_from, to) => [{ ...to }]);
    expect(find()).not.toBeNull();
    expect(findWorkerPath.mock.calls.length).toBeGreaterThan(calls);
  });

  it.each(["terrain", "props", "road", "prop-count"])(
    "invalidates shore routes after a %s change",
    (kind) => {
      const { find, findWorkerPath, roads, world } = fixture();
      expect(find()).not.toBeNull();
      const calls = findWorkerPath.mock.calls.length;
      if (kind === "terrain") world.terrainRevision = 1;
      if (kind === "props") world.buildRevision = 1;
      if (kind === "road") roads.revision++;
      if (kind === "prop-count") world.props.count++;
      expect(find()).not.toBeNull();
      expect(findWorkerPath.mock.calls.length).toBeGreaterThan(calls);
    }
  );
});
