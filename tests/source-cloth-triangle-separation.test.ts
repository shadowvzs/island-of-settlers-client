import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { sourceClothTriangleSeparation } from "../tools/analysis/source-cloth-triangle-separation";

describe("finite cloth/body triangle separation", () => {
  const cloth = [new Vector3(-1, -1, 0), new Vector3(1, -1, 0), new Vector3(0, 1, 0)];
  it("distinguishes a crossing from actual finite separation", () => {
    const body = [new Vector3(0, -.5, -1), new Vector3(0, -.5, 1), new Vector3(0, .5, 0)];
    expect(sourceClothTriangleSeparation(cloth, body).gap).toBeLessThan(0);
    expect(sourceClothTriangleSeparation(cloth, body.map(point => point.clone().add(new Vector3(3, 0, 0)))).gap).toBeGreaterThan(0);
  });
  it("finds a finite edge separator for disjoint coplanar triangles", () => {
    const other = cloth.map(point => point.clone().add(new Vector3(3, 0, 0)));
    expect(sourceClothTriangleSeparation(cloth, other).gap).toBeGreaterThan(0);
    expect(sourceClothTriangleSeparation(cloth, cloth).gap).toBe(0);
  });
});
