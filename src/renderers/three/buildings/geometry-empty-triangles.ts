import type { BufferGeometry } from "three";

/** Lathe end rings include collapsed zero-area triangles. Removing those changes no visible surface. */
export const removeEmptyTriangles = (geometry: BufferGeometry) => {
  const positions = geometry.getAttribute("position"), index = geometry.index;
  const count = index?.count ?? positions.count;
  const vertexAt = (offset: number) => index ? index.getX(offset) : offset;
  const kept: number[] = [];
  for (let offset = 0; offset < count; offset += 3) {
    const a = vertexAt(offset), b = vertexAt(offset + 1), c = vertexAt(offset + 2);
    const abX = positions.getX(b) - positions.getX(a), abY = positions.getY(b) - positions.getY(a);
    const abZ = positions.getZ(b) - positions.getZ(a), acX = positions.getX(c) - positions.getX(a);
    const acY = positions.getY(c) - positions.getY(a), acZ = positions.getZ(c) - positions.getZ(a);
    const x = abY * acZ - abZ * acY, y = abZ * acX - abX * acZ, z = abX * acY - abY * acX;
    if (x !== 0 || y !== 0 || z !== 0) kept.push(a, b, c);
  }
  if (kept.length < count) geometry.setIndex(kept);
  return geometry;
};
