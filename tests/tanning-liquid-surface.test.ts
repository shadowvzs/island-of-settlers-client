import { Vector3 } from "three";
import { expect, it } from "vitest";

import { createTanningLiquidGeometry } from "../src/renderers/three/buildings/tanning-liquid";

it.each([true, false])("keeps the tanning fluid top-facing, recessed and raised at the rim (%s)", detailed => {
  const geometry = createTanningLiquidGeometry(detailed);
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const indices = geometry.getIndex()!;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let triangles = 0, centreHeight = 0, edgeHeight = 0;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
    expect(Number.isFinite(y)).toBe(true);
    expect(normals.getY(index)).toBeGreaterThanOrEqual(0);
    // Actual recipe: liquid at .49 with .016 height; wooden rim top is .58.
    expect(.49 + y * .016).toBeLessThan(.58);
    if (Math.hypot(x, z) < .01) centreHeight = y;
    if (Math.hypot(x, z) > .49) edgeHeight = Math.max(edgeHeight, y);
  }
  for (let index = 0; index < indices.count; index += 3) {
    a.fromBufferAttribute(positions, indices.getX(index));
    b.fromBufferAttribute(positions, indices.getX(index + 1));
    c.fromBufferAttribute(positions, indices.getX(index + 2));
    const face = b.sub(a).cross(c.sub(a));
    if (face.lengthSq() < 1e-14) continue;
    expect(face.y).toBeGreaterThan(0);
    triangles++;
  }
  expect(triangles).toBeGreaterThan(20);
  expect(edgeHeight).toBeGreaterThan(centreHeight + .4);
  geometry.dispose();
});
