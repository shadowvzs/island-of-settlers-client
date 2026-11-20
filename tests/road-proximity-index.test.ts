import { describe, expect, it } from "vitest";

import { createRoadNetwork, type RoadWorld } from "../src/shared/settlement/road-network";
import { isWithinRoadClearance } from "../src/shared/settlement/road-proximity-index";
import { distanceToSegment } from "../src/shared/settlement/settlement-geometry";

const roadWorld = (size = 24): RoadWorld => ({
  cellsX: size,
  cellsZ: size,
  heights: new Float32Array((size + 1) ** 2),
  blocking: new Uint8Array(size ** 2)
});

describe("road proximity index", () => {
  it("answers exactly like a scan of every segment, and follows the road revision", () => {
    const roads = createRoadNetwork(roadWorld());
    roads.addRoad({ x: 2, z: 4 }, { x: 19, z: 4 });
    roads.addRoad({ x: 6, z: 4 }, { x: 6, z: 18 });
    const scan = (x: number, z: number, clearance: number) =>
      roads.segments().some(({ end, start }) => distanceToSegment({ x, z }, start, end) < clearance);
    const compare = () => {
      for (let z = 0; z <= 22; z += .37) for (let x = 0; x <= 22; x += .41)
        for (const clearance of [.8, 1.2, 3.1])
          expect(isWithinRoadClearance(roads, { x, z }, clearance)).toBe(scan(x, z, clearance));
    };
    compare();
    roads.addRoad({ x: 6, z: 18 }, { x: 20, z: 18 });
    expect(isWithinRoadClearance(roads, { x: 15, z: 18.5 }, .8)).toBe(true);
    compare();
  });

  it("scans a road source without a revision on every call", () => {
    const segments = [{ start: { x: 1, z: 1 }, end: { x: 1.5, z: 1 } }];
    const roads = { segments: () => segments };
    expect(isWithinRoadClearance(roads, { x: 1.2, z: 1.5 }, .8)).toBe(true);
    segments[0] = { start: { x: 9, z: 9 }, end: { x: 9.5, z: 9 } };
    expect(isWithinRoadClearance(roads, { x: 1.2, z: 1.5 }, .8)).toBe(false);
  });
});
