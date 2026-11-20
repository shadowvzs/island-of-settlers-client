import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4 } from "three";

import type {
  OrnamentalLeaf
} from "../../../render-common/plants/ornamental-tree-graph";

interface FoliageMesh {
  positions: number[];
  colours: number[];
  uvs: number[];
  indices: number[];
}

const finishFoliage = (mesh: FoliageMesh, matrix: Matrix4) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(mesh.colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(mesh.indices);
  geometry.computeVertexNormals();
  geometry.applyMatrix4(matrix);
  geometry.computeBoundingBox();
  return geometry;
};

const transform = (position: readonly number[], yaw: number, pitch: number, roll = 0) => {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(pitch, yaw, roll, "YXZ"));
  matrix.setPosition(position[0]!, position[1]!, position[2]!);
  return matrix;
};

/** A folded blade with a petiole at its authored anchor, raised midrib and curved margin. */
export const createOrnamentalLeafGeometry = (leaf: OrnamentalLeaf, detailed: boolean) => {
  const mesh: FoliageMesh = { positions: [], colours: [], uvs: [], indices: [] };
  const sections = detailed ? 5 : 3;
  mesh.positions.push(0, 0, 0); mesh.colours.push(.72, .8, .67); mesh.uvs.push(.5, 0);
  for (let row = 1; row < sections; row++) {
    const t = row / sections;
    const width = Math.sin(Math.PI * t) ** .8 * leaf.width / 2;
    for (const side of [-1, 0, 1]) {
      const y = Math.sin(t * Math.PI) * leaf.length * (.10 - Math.abs(side) * .13);
      mesh.positions.push(side * width, y, t * leaf.length);
      const shade = .70 + (1 - Math.abs(side)) * .21 + .06 * Math.sin(t * 13 + leaf.seed);
      mesh.colours.push(shade * .91, shade, shade * .84);
      mesh.uvs.push((side + 1) / 2, t);
    }
    const a = 1 + (row - 1) * 3;
    if (row === 1) mesh.indices.push(0, a, a + 1, 0, a + 1, a + 2);
    if (row >= sections - 1) continue;
    mesh.indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4,
      a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  const tip = mesh.positions.length / 3, last = tip - 3;
  mesh.positions.push(0, 0, leaf.length); mesh.colours.push(.75, .82, .69); mesh.uvs.push(.5, 1);
  mesh.indices.push(last, tip, last + 1, last + 1, tip, last + 2);
  return finishFoliage(mesh, transform(leaf.position, leaf.yaw, leaf.pitch, leaf.roll));
};

