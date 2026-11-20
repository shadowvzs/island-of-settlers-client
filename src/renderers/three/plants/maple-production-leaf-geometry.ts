import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4 } from "three";

import type { OrnamentalLeaf } from "../../../render-common/plants/ornamental-tree-graph";

// The canonical alpha still defines all five lobes and sinuses. Tessellation funds actual wood/petioles.
const HIGH_EDGE = [[-.5, 0], [-.5, 1], [0, 1], [.5, 1], [.5, 0]] as const;

/** A folded palmate blade with a genuine three-sided tapered petiole rooted at its woody bearing. */
export const createMapleProductionLeafGeometry = (leaf: OrnamentalLeaf, detailed: boolean) => {
  const positions: number[] = [], colours: number[] = [], uvs: number[] = [], indices: number[] = [];
  const phase = Math.sin(leaf.seed * 2.17);
  const point = (x: number, z: number, centre: boolean) => {
    let relief = Math.sin(Math.min(1, z) * Math.PI) * (.006 + Math.abs(x) * .030);
    if (centre) relief = .052;
    positions.push(x * leaf.width, relief * leaf.length, z * leaf.length);
    const shade = .94 + phase * .035 - Math.abs(x) * .035;
    colours.push(shade, shade, shade); uvs.push(x + .5, z);
  };
  if (detailed) {
    point(0, .46, true);
    HIGH_EDGE.forEach(([x, z]) => point(x, z, false));
    for (let index = 0; index < HIGH_EDGE.length; index++)
      indices.push(0, index + 1, (index + 1) % HIGH_EDGE.length + 1);
  } else {
    // Two dimensional folded wings retain the entire palmate outline inside one conservative carrier.
    point(-.85, .10, false); point(0, .10, true);
    point(0, 1.6, false); point(.85, .10, false);
    indices.push(0, 2, 1, 1, 2, 3);
  }
  const stem = positions.length / 3;
  const radius = leaf.width * .021;
  // The base is buried in the real woody shoot; all three faces converge inside the blade base.
  for (let side = 0; side < 3; side++) {
    const angle = side / 3 * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    colours.push(.56, .41, .25); uvs.push(.5, .055);
  }
  let attachmentHeight = .052 * .20 / .46;
  if (!detailed) attachmentHeight = .052 * (1 - .10 / 1.5) + .001;
  positions.push(0, leaf.length * attachmentHeight, leaf.length * .20);
  colours.push(.66, .48, .29); uvs.push(.5, .055);
  for (let side = 0; side < 3; side++) indices.push(stem + side, stem + (side + 1) % 3, stem + 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const pose = new Matrix4().makeRotationFromEuler(new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ"));
  pose.setPosition(...leaf.position); geometry.applyMatrix4(pose);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
