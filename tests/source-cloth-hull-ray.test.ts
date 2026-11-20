import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { clothHullRayInterval } from "../tools/analysis/source-cloth-hull-ray";

const box = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => new Vector3(x, y, z))));

describe("conservative source-cloth reachability hull", () => {
  it("retains the full exact box intersection while proving a separated ray unreachable", () => {
    const hit = clothHullRayInterval(box, new Vector3(0, 0, 3), new Vector3(0, 0, -1), 0, 10)!;
    expect(hit.low).toBeCloseTo(2, 8);
    expect(hit.high).toBeCloseTo(4, 8);
    expect(hit.low).toBeLessThanOrEqual(2);
    expect(hit.high).toBeGreaterThanOrEqual(4);
    expect(clothHullRayInterval(box, new Vector3(3, 0, 3), new Vector3(0, 0, -1), 0, 10)).toBeNull();
  });
});
