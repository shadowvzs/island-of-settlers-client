import { Group, InstancedMesh, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createPlacementRoadDashes } from "../src/renderers/three/buildings/placement-road-dashes";

describe("placement road dashes", () => {
  it("draws one upward-facing dash per road step just above the ground", () => {
    const parent = new Group();
    const dashes = createPlacementRoadDashes(parent, (x) => x * 0.1);
    const route = [{ x: 2, z: 3 }, { x: 2.5, z: 3 }, { x: 3, z: 3.5 }];
    dashes.update(route);
    const mesh = parent.children[0] as InstancedMesh;
    expect(mesh.visible).toBe(true);
    expect(mesh.count).toBe(2);
    const matrix = new Matrix4();
    mesh.getMatrixAt(0, matrix);
    const centre = new Vector3().setFromMatrixPosition(matrix);
    expect(centre.x).toBeCloseTo(2.25);
    expect(centre.z).toBeCloseTo(3);
    expect(centre.y).toBeGreaterThan(0.225);
    const up = new Vector3(0, 1, 0).transformDirection(matrix);
    expect(up.y).toBeGreaterThan(0.9);
    expect(matrix.determinant()).toBeGreaterThan(0);
    dashes.update(null);
    expect(mesh.visible).toBe(false);
  });
});
