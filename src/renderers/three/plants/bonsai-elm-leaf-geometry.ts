import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4 } from "three";

import type { OrnamentalLeaf } from "../../../render-common/plants/ornamental-tree-graph";

/** Small oval, pointed, finely serrated lamina with one raised midrib, no palmate lobes. */
export const createBonsaiElmLeafGeometry = (leaf: OrnamentalLeaf, detailed: boolean, distant = false) => {
  let divisions = detailed ? 6 : 4, envelope = detailed ? 1.10 : 1.25;
  // At distance retain every real leaf, its mask, position and raised midrib with four triangles.
  if (distant) { divisions = 2; envelope = 1.60; }
  const half = Array.from({ length: divisions - 1 }, (_, index) => {
    const t = (index + 1) / divisions;
    return [-Math.sin(t * Math.PI) * .5 * envelope, t];
  });
  const outline = [[0, 0], ...half, [0, 1], ...half.slice().reverse().map(([x, z]) => [-x!, z!])];
  const positions = [0, leaf.length * .085, leaf.length * .46];
  const colours = [.93, 1, .86], uvs = [.5, .46], indices: number[] = [];
  outline.forEach(([x, z]) => {
    const cup = Math.sin(z! * Math.PI) * leaf.length * .025 - Math.abs(x!) * leaf.length * .045;
    const asymmetricBase = x! < 0 && z! < .35 ? leaf.length * .025 : 0;
    positions.push(x! * leaf.width, cup, z! * leaf.length + asymmetricBase);
    const shade = .82 + Math.sin(z! * 7 + leaf.seed) * .035;
    colours.push(shade * .94, shade, shade * .86); uvs.push(x! + .5, z!);
  });
  for (let edge = 0; edge < outline.length; edge++)
    indices.push(0, edge + 1, (edge + 1) % outline.length + 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ"));
  matrix.setPosition(...leaf.position); geometry.applyMatrix4(matrix);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
