import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import type { OrnamentalLimb } from "../../../render-common/plants/ornamental-tree-graph";

/** Millimetre shoots retain every authored bearing without the trunk's dense tessellation. */
export const createOrnamentalShootGeometry = (limb: OrnamentalLimb) => {
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], uvs: number[] = [];
  const indices: number[] = [], last = limb.path.length - 1;
  const up = new Vector3(0, 1, 0);
  for (let ring = 0; ring <= last; ring++) {
    const centre = new Vector3(...limb.path[ring]!);
    const before = new Vector3(...limb.path[Math.max(0, ring - 1)]!);
    const after = new Vector3(...limb.path[Math.min(last, ring + 1)]!);
    const tangent = after.sub(before).normalize();
    const reference = Math.abs(tangent.y) > .95 ? new Vector3(1, 0, 0) : up;
    const side = tangent.clone().cross(reference).normalize();
    const front = tangent.clone().cross(side).normalize();
    const radius = limb.radius + (limb.tipRadius - limb.radius) * ring / last;
    for (let vertex = 0; vertex < 3; vertex++) {
      const angle = vertex / 3 * Math.PI * 2;
      const normal = side.clone().multiplyScalar(Math.cos(angle)).addScaledVector(front, Math.sin(angle));
      positions.push(...centre.clone().addScaledVector(normal, radius).toArray());
      normals.push(...normal.toArray()); colours.push(.90, .89, .86); uvs.push(vertex / 3, ring / last);
      if (ring >= last) continue;
      const a = ring * 3 + vertex, b = ring * 3 + (vertex + 1) % 3;
      indices.push(a, b, a + 3, b, b + 3, a + 3);
    }
  }
  // Parent overlaps hide the small start cap; the actual terminal is closed.
  indices.push(0, 2, 1, last * 3, last * 3 + 1, last * 3 + 2);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeBoundingBox();
  return geometry;
};
