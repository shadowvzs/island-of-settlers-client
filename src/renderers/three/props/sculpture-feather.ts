import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import { curveThrough, type SculptPoint } from "../sculpt-geometry";

/** Closed lenticular feather, with a shaped quill and an actual convex front and back. */
export const createSculptureFeatherGeometry = (points: readonly SculptPoint[], width: number,
  detailed: boolean, contour = false) => {
  const path = curveThrough(points);
  let rows = detailed ? 16 : 3, sides = detailed ? 8 : 4;
  if (detailed && contour) { rows = 8; sides = 6; }
  const vertices: number[] = [], uv: number[] = [], indices: number[] = [];
  const across = new Vector3(), tangent = new Vector3();
  for (let row = 0; row <= rows; row++) {
    const t = row / rows, centre = path.getPoint(t);
    tangent.copy(path.getTangent(t)); across.set(tangent.y, -tangent.x, 0).normalize();
    const root = Math.min(1, t / .22), tip = Math.min(1, (1 - t) / .22);
    const spread = Math.max(.0005, (root ** .65) * (tip ** .75) * width * (.84 + t * .16));
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const vane = Math.cos(angle) * spread * (Math.cos(angle) > 0 ? .85 : 1);
      vertices.push(centre.x + across.x * vane,
        centre.y + across.y * vane, centre.z + Math.sin(angle) * spread * .09);
      uv.push(side / sides, t);
      if (row < rows && side < sides) {
        const a = row * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  // Close the tiny quill/tip rings; the body is genuinely volumetric even at close range.
  for (const row of [0, rows]) {
    const centre = path.getPoint(row / rows), cap = vertices.length / 3;
    vertices.push(centre.x, centre.y, centre.z); uv.push(.5, row / rows);
    for (let side = 0; side < sides; side++) {
      const a = row * (sides + 1) + side, b = a + 1;
      if (row === 0) indices.push(cap, a, b);
      else indices.push(cap, b, a);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); return geometry;
};
