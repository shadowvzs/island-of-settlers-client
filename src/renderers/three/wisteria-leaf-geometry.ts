import { Float32BufferAttribute, Vector3 } from "three";
import { ParametricGeometry } from "three/addons/geometries/ParametricGeometry.js";

import { createWisteriaLeafSheet } from "./wisteria-leaf-sheet";

/** One long-ovate pointed leaflet with a raised midrib and softly curved blade, reusable on every rachis. */
export const createWisteriaLeafGeometry = (lean = false) => {
  if (lean) return createWisteriaLeafSheet();
  const point = (u: number, v: number, target: Vector3) => {
    const across = u * 2 - 1, width = .24 * Math.sin(Math.PI * v) ** .78 * (1 - v * .15);
    target.set(across * width, v, .065 * Math.sin(Math.PI * v) * (1 - across * across)
      + .018 * Math.sin(across * Math.PI) * Math.sin(Math.PI * v));
  };
  const geometry = new ParametricGeometry(point, 2, 3);
  // At pointed poles the derivative across the blade collapses to zero. Sample just inside
  // the real blade instead: a zero pole normal would turn adjacent triangles black.
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), d = new Vector3();
  const normals = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
  for (let index = 0; index < normals.count; index++) {
    const u = uv.getX(index), v = Math.max(.001, Math.min(.999, uv.getY(index)));
    point(u - .0001, v, a); point(u + .0001, v, b);
    point(u, v - .0001, c); point(u, v + .0001, d);
    b.sub(a).cross(d.sub(c)).normalize(); normals.setXYZ(index, b.x, b.y, b.z);
  }
  const colours = new Float32Array(geometry.getAttribute("position").count * 3).fill(1);
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  // Parametric pole rows collapse to points: four triangles have zero area and cannot contribute
  // silhouette, shading or veins. Do not spend population triangles on those invisible faces.
  const position = geometry.getAttribute("position"), indices: number[] = [];
  for (let index = 0; index < geometry.index!.count; index += 3) {
    const first = geometry.index!.getX(index), second = geometry.index!.getX(index + 1);
    const third = geometry.index!.getX(index + 2);
    a.fromBufferAttribute(position, first); b.fromBufferAttribute(position, second);
    c.fromBufferAttribute(position, third);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16) indices.push(first, second, third);
  }
  geometry.setIndex(indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
