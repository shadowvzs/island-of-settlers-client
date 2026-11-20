import { BufferGeometry, Float32BufferAttribute } from "three";

/** Opt-in study: a thin longitudinally bent blade; shared alpha tissue retains the real ovate edge. */
export const createWisteriaLeafSheet = () => {
  const halfWidth = .24 * Math.sin(Math.PI / 3) ** .78 * .95;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([
    -halfWidth, 0, 0, halfWidth, 0, 0,
    -halfWidth, .5, .065, halfWidth, .5, .065,
    -halfWidth, 1, 0, halfWidth, 1, 0
  ], 3));
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 0, .5, 1, .5, 0, 1, 1, 1], 2));
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(18).fill(1), 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
};
