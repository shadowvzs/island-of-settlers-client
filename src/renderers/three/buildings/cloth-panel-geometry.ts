import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

import type { Point3 } from "../../../render-common/buildings/building-recipe";
import type { ClothPanelCorners } from "../../../render-common/buildings/indigenous-tipi-portal";

/** Slightly tensioned fabric with its corners sewn to the real support surface, both LODs. */
export const createClothPanelGeometry = (corners: ClothPanelCorners, size: Point3, detailed: boolean) => {
  const segments = detailed ? 4 : 2, positions: number[] = [], indices: number[] = [];
  const points = corners.map(point => new Vector3(...point));
  const world = points.map(point => point.clone().multiply(new Vector3(...size)));
  const normal = world[1]!.clone().sub(world[0]!).cross(world[3]!.clone().sub(world[0]!)).normalize();
  const offset = normal.clone().divide(new Vector3(...size)).multiplyScalar(.004);
  for (let row = 0; row <= segments; row++) for (let column = 0; column <= segments; column++) {
    const u = column / segments, v = row / segments;
    const bottom = points[0]!.clone().lerp(points[1]!, u);
    const top = points[3]!.clone().lerp(points[2]!, u);
    const point = bottom.lerp(top, v).addScaledVector(offset, Math.sin(u * Math.PI) * Math.sin(v * Math.PI));
    positions.push(...point.toArray());
  }
  for (let row = 0; row < segments; row++) for (let column = 0; column < segments; column++) {
    const a = row * (segments + 1) + column, b = a + 1, c = a + segments + 1;
    indices.push(a, b, c, b, c + 1, c);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(positions.length).fill(1), 3));
  const uvs: number[] = [];
  for (let row = 0; row <= segments; row++) for (let column = 0; column <= segments; column++)
    uvs.push(column / segments, row / segments);
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
