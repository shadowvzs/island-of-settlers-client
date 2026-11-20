import { Float32BufferAttribute, SphereGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { createRomanDomeRoof } from "./roman-dome-roof";

/** Open-base hemispherical roof shell: a curved outside and a visible inward-facing ceiling. */
export const createRomanCupola = (detailed: boolean) => {
  const outer = createRomanDomeRoof(detailed);
  const inner = new SphereGeometry(
    0.485,
    detailed ? 24 : 6,
    detailed ? 12 : 2,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2
  );
  const indices = inner.index!;
  for (let i = 0; i < indices.count; i += 3) {
    const first = indices.getX(i);
    indices.setX(i, indices.getX(i + 2));
    indices.setX(i + 2, first);
  }
  const normals = inner.getAttribute("normal");
  for (let i = 0; i < normals.count; i++)
    normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
  inner.setAttribute(
    "color",
    new Float32BufferAttribute(
      new Float32Array(inner.getAttribute("position").count * 3).fill(1),
      3
    )
  );
  const interior = outer.index ? inner : inner.toNonIndexed();
  const geometry = mergeGeometries([outer, interior])!;
  geometry.userData.roofTiles = outer.userData.roofTiles ?? 0;
  if (interior !== inner) interior.dispose();
  outer.dispose();
  inner.dispose();
  return geometry;
};
