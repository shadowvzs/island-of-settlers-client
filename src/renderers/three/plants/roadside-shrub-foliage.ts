import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4 } from "three";

import type { OrnamentalBlossom, OrnamentalLeaf } from "../../../render-common/plants/ornamental-tree-graph";

/** Rounded evergreen lamina, separate from the lobed maple and long peach leaf assets. */
export const createShrubLeafGeometry = (leaf: OrnamentalLeaf, detailed: boolean) => {
  const positions = [0, leaf.length * .075, leaf.length * .48];
  const uvs = [.5, .48], colours = [.86, .94, .83], indices: number[] = [];
  const sides = detailed ? 12 : 8;
  for (let side = 0; side < sides; side++) {
    const angle = side / sides * Math.PI * 2;
    const x = Math.sin(angle) * leaf.width * .5 * (1 + .08 * Math.cos(angle));
    const z = (1 - Math.cos(angle)) * leaf.length * .5;
    const y = Math.sin(angle * 2 + leaf.seed) * leaf.length * .012 * Math.sin(angle) ** 2;
    positions.push(x, y, z); uvs.push(x / leaf.width + .5, z / leaf.length);
    const shade = .87 + .06 * Math.sin(angle + leaf.seed * .71);
    colours.push(shade * .94, shade, shade * .91);
    if (detailed) indices.push(0, (side + 1) % sides + 1, side + 1);
  }
  // Preserve the same eight-point oval in Minimal with a six-face folded midrib triangulation.
  if (!detailed) for (let side = 2; side < sides; side++) indices.push(1, side + 1, side);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const transform = new Matrix4().makeRotationFromEuler(new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ"));
  transform.setPosition(...leaf.position); geometry.applyMatrix4(transform);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};

/** Small rounded myrtle flowers belong to this shrub; no peach blossom is substituted. */
export const createShrubFlowerGeometry = (flower: OrnamentalBlossom, detailed: boolean) => {
  const positions: number[] = [], colours: number[] = [], uvs: number[] = [], indices: number[] = [];
  const add = (x: number, y: number, z: number, yellow = false) => {
    const index = positions.length / 3;
    positions.push(x * flower.radius, y * flower.radius, z * flower.radius);
    colours.push(1, yellow ? .76 : 1, yellow ? .24 : 1); uvs.push(x * .45 + .5, z * .45 + .5);
    return index;
  };
  for (let petal = 0; petal < 5; petal++) {
    const angle = petal / 5 * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
    const rotate = (x: number, y: number, z: number) => add(x * c + z * s, y, z * c - x * s);
    const base = rotate(0, 0, .08), left = rotate(-.31, .09, .59);
    const tip = rotate(0, .15, 1), right = rotate(.31, .09, .59);
    const middle = rotate(0, .16, .60);
    indices.push(base, middle, left, left, middle, tip, tip, middle, right, right, middle, base);
  }
  const centre = add(0, .21, 0, true);
  const segments = detailed ? 8 : 5;
  for (let side = 0; side < segments; side++) {
    const angle = side / segments * Math.PI * 2, next = (side + 1) / segments * Math.PI * 2;
    const a = add(Math.sin(angle) * .25, .18, Math.cos(angle) * .25, true);
    const b = add(Math.sin(next) * .25, .18, Math.cos(next) * .25, true);
    indices.push(centre, a, b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const transform = new Matrix4().makeRotationFromEuler(new Euler(flower.pitch, flower.yaw, 0, "YXZ"));
  transform.setPosition(...flower.position); geometry.applyMatrix4(transform);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
