import { BufferGeometry, Float32BufferAttribute } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/** Alternating plump kernels give each wheat ear a segmented silhouette at modest cost. */
export const createRomanWheatEar = (detailed: boolean) => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const rows = detailed ? 3 : 2;
  for (let row = 0; row < rows; row++)
    for (const side of [-1, 1]) {
      const x = side * (0.15 - row * 0.025);
      const y = -0.3 + row * (0.64 / rows) + (side > 0 ? 0.055 : 0);
      const points = [
        [x, y + 0.2, 0],
        [x, y - 0.15, 0],
        [x - 0.21, y, 0],
        [x, y, 0.38],
        [x + 0.21, y, 0],
        [x, y, -0.38]
      ];
      for (let edge = 0; edge < 4; edge++) {
        const next = 2 + ((edge + 1) % 4);
        for (const triangle of [
          [0, edge + 2, next],
          [1, next, edge + 2]
        ])
          for (const index of triangle) {
            const point = points[index]!;
            positions.push(...point);
            uvs.push(point[0]! + 0.5, point[1]! + 0.5);
          }
      }
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  const rounded = mergeVertices(geometry);
  rounded.computeVertexNormals();
  geometry.dispose();
  return rounded;
};
