import { CylinderGeometry } from "three";

/** A gently tapered, slightly irregular trunk; bark grain follows the length of the timber. */
export const createRomanTimberLog = (detailed: boolean) => {
  const geometry = new CylinderGeometry(0.47, 0.5, 1, detailed ? 12 : 8, detailed ? 2 : 1, true);
  const vertices = geometry.getAttribute("position");
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index),
      y = vertices.getY(index),
      z = vertices.getZ(index);
    const angle = Math.atan2(z, x);
    const unevenBark = 1 + Math.cos(angle * 3) * 0.018 + Math.sin(angle * 5) * 0.012;
    const bend = 0.012 * Math.sin((y + 0.5) * Math.PI);
    vertices.setXYZ(index, x * unevenBark + bend, y, z * unevenBark);
  }
  geometry.computeVertexNormals();
  return geometry;
};
