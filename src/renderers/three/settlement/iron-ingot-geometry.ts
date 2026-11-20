import { BufferGeometry, Float32BufferAttribute } from "three";

import { IRON_INGOT_PROFILE } from "../../../render-common/wares/iron-ingot";

/** Original indexed cast-ingot geometry; both LODs retain the same readable 94-triangle silhouette. */
export const createIronIngotGeometry = () => {
  const geometry = new BufferGeometry(), positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const rings = IRON_INGOT_PROFILE.map(({ corner, halfLength: x, halfWidth: z, y }) => [
    [-x + corner, y, -z], [x - corner, y, -z], [x, y, -z + corner], [x, y, z - corner],
    [x - corner, y, z], [-x + corner, y, z], [-x, y, z - corner], [-x, y, -z + corner]
  ]);
  const vertex = (point: number[]) => {
    const index = positions.length / 3;
    positions.push(...point); uvs.push(point[0]! + .5, point[2]! + .5);
    return index;
  };
  // Separate bevel/wall/rim normals keep broad faces flat and the silver edge highlights narrow.
  for (let row = 0; row < rings.length - 1; row++) for (let side = 0; side < 8; side++) {
    const next = (side + 1) % 8;
    const a = vertex(rings[row]![side]!), b = vertex(rings[row + 1]![side]!);
    const c = vertex(rings[row + 1]![next]!), d = vertex(rings[row]![next]!);
    indices.push(a, b, d, b, c, d);
  }
  const bottom = rings[0]!.map(vertex);
  for (let side = 1; side < 7; side++) indices.push(bottom[0]!, bottom[side]!, bottom[side + 1]!);
  const top = rings[rings.length - 1]!.map(vertex), center = vertex([0, .455, 0]);
  for (let side = 0; side < 8; side++) indices.push(center, top[(side + 1) % 8]!, top[side]!);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};
