import { BufferGeometry, Float32BufferAttribute } from "three";

import type { RoadProfilePart } from "../../render-common/road-decoration-recipe";

/** Closed, pointed leaf with a raised central fold. Eight triangles, no alpha sorting or wind. */
export const createRoadDecorationLeaf = (part: RoadProfilePart) => {
  let points = [[0, 0, -.5], [-.5, 0, 0], [0, 0, .5], [.5, 0, 0]];
  if (part.kind === "botanical-leaf") points = [[0, 0, -.5], [-.35, 0, -.35], [-.5, 0, 0],
    [-.35, 0, .35], [0, 0, .5], [.35, 0, .35], [.5, 0, 0], [.35, 0, -.35]];
  const perimeter = points.length;
  points.push([0, .5, 0], [0, -.5, 0]);
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [];
  for (const [center, reverse] of [[perimeter, false], [perimeter + 1, true]] as const)
    for (let index = 0; index < perimeter; index++) {
    const indices = reverse ? [center, (index + 1) % perimeter, index] : [center, index, (index + 1) % perimeter];
    for (const vertex of indices) {
      const point = points[vertex]!;
      positions.push(point[0]! * part.size[0], point[1]! * part.size[1], point[2]! * part.size[2]);
      colors.push(...part.tint); uvs.push(point[0]! + .5, point[2]! + .5);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  if (part.rotation) {
    geometry.rotateX(part.rotation[0]); geometry.rotateY(part.rotation[1]); geometry.rotateZ(part.rotation[2]);
  }
  geometry.translate(...part.position);
  return geometry;
};
