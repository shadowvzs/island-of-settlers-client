import { BufferGeometry, Float32BufferAttribute, Shape } from "three";

import { cutIndigenousClothOpenings } from "./indigenous-cloth-cutouts";

/** A textile sleeve follows the square timber frame, with soft corners and slight inward drape. */
export const createIndigenousFrameSkin = (detailed: boolean,
  entrance?: [number, number, number], rearEntrance?: [number, number, number], radius = .065) => {
  const inset = .5 - Math.max(.025, Math.min(.45, radius)), outline = new Shape();
  outline.moveTo(.5, inset);
  outline.quadraticCurveTo(.5, .5, inset, .5);
  outline.lineTo(-inset, .5); outline.quadraticCurveTo(-.5, .5, -.5, inset);
  outline.lineTo(-.5, -inset); outline.quadraticCurveTo(-.5, -.5, -inset, -.5);
  outline.lineTo(inset, -.5); outline.quadraticCurveTo(.5, -.5, .5, -inset); outline.closePath();
  const sides = detailed ? 64 : 24, rings = detailed ? 8 : 3;
  const perimeter = outline.getSpacedPoints(sides), positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) for (let side = 0; side <= sides; side++) {
    const point = perimeter[side]!, share = ring / rings;
    const drape = .006 * Math.sin(share * Math.PI) ** 2 * (1 + Math.sin(side / sides * Math.PI * 24) ** 2);
    positions.push(point.x * (1 - drape), share - .5, point.y * (1 - drape));
    uvs.push(side / sides, 1 - share);
  }
  for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
    const a = ring * (sides + 1) + side, b = a + 1, c = a + sides + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return entrance || rearEntrance ? cutIndigenousClothOpenings(geometry, entrance, rearEntrance) : geometry;
};
