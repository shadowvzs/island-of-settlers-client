import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, ShapeUtils, Vector2 } from "three";

import type { OrnamentalLeaf } from "../../../render-common/plants/ornamental-tree-graph";

/** Five main lobes and incised sinuses remain actual geometry, including on Minimal. */
export const MAPLE_LEAF_OUTLINE = [
  [0, .17], [-.22, .12], [-.27, .24], [-.50, .40], [-.42, .49], [-.30, .48],
  [-.34, .76], [-.16, .68], [0, 1], [.17, .70], [.36, .80], [.30, .50],
  [.42, .48], [.50, .39], [.27, .26], [.20, .12]
] as const;

const leafOutline = (detailed: boolean, seed: number) => {
  const points = MAPLE_LEAF_OUTLINE.map(([x, z]) => new Vector2(x, z));
  if (!detailed) return points;
  return points.flatMap((point, index) => {
    const next = points[(index + 1) % points.length]!;
    if (index < 2 || index > 13 || index === 7 || index === 8) return [point];
    const variation = Math.sin(seed * 1.73 + index * 4.13);
    const tooth = point.clone().lerp(next, .43 + variation * .08);
    tooth.x += Math.sign(tooth.x) * (.009 + variation * .003);
    tooth.y += .004;
    return [point, tooth];
  });
};

/** Petiole root is leaf.position; local +Z follows the blade and local +Y faces its upper surface. */
export const createMapleLeafGeometry = (leaf: OrnamentalLeaf, detailed: boolean) => {
  const outline = leafOutline(detailed, leaf.seed);
  const positions: number[] = [], colours: number[] = [], uvs: number[] = [], indices: number[] = [];
  const phase = Math.sin(leaf.seed * 2.17);
  for (const point of outline) {
    const t = point.y;
    const crease = Math.exp(-Math.abs(point.x) * 9) * Math.sin(t * Math.PI) * .055;
    const curl = point.x * point.x * (.07 + phase * .045) + Math.sin(t * Math.PI) * .017;
    const pucker = Math.sin(point.x * 19 + t * 7 + phase) * Math.abs(point.x) * .016;
    positions.push(point.x * leaf.width, (crease + curl + pucker) * leaf.length, t * leaf.length);
    const shade = .88 + .08 * Math.sin(t * Math.PI) - Math.abs(point.x) * .05 + phase * .035;
    colours.push(shade, shade, shade);
    uvs.push(point.x + .5, t);
  }
  for (const [a, b, c] of ShapeUtils.triangulateShape(outline, [])) indices.push(a!, c!, b!);
  const stem = positions.length / 3;
  const halfStem = leaf.width * .013;
  positions.push(-halfStem, 0, 0, halfStem, 0, 0,
    -halfStem * .72, leaf.length * .01, leaf.length * .19,
    halfStem * .72, leaf.length * .01, leaf.length * .19);
  for (let index = 0; index < 4; index++) {
    colours.push(.57, .57, .57); uvs.push(.5, index < 2 ? 0 : .19);
  }
  indices.push(stem, stem + 2, stem + 1, stem + 1, stem + 2, stem + 3);
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
