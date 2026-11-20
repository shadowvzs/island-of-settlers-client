import type { BufferGeometry } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/** Soften weathered rock edges while retaining genuine fractured planes and the exact silhouette. */
export const softenIndigenousRubbleNormals = (geometry: BufferGeometry, detailed: boolean) => {
  const original = geometry.getAttribute("normal");
  if (!original || geometry.index) return geometry;
  geometry.deleteAttribute("normal");
  const welded = mergeVertices(geometry, 1e-5); welded.computeVertexNormals();
  const smooth = welded.toNonIndexed(), rounded = smooth.getAttribute("normal");
  const blend = detailed ? .65 : .48;
  for (let index = 0; index < original.count; index++) {
    const x = original.getX(index), y = original.getY(index), z = original.getZ(index);
    const dot = x * rounded.getX(index) + y * rounded.getY(index) + z * rounded.getZ(index);
    // Deep fracture lips retain their own hard bearing edge; gentle worn shoulders receive a blend.
    if (dot < .57) continue;
    const nx = x * (1 - blend) + rounded.getX(index) * blend;
    const ny = y * (1 - blend) + rounded.getY(index) * blend;
    const nz = z * (1 - blend) + rounded.getZ(index) * blend, length = Math.hypot(nx, ny, nz);
    original.setXYZ(index, nx / length, ny / length, nz / length);
  }
  geometry.setAttribute("normal", original); smooth.dispose(); welded.dispose(); return geometry;
};
