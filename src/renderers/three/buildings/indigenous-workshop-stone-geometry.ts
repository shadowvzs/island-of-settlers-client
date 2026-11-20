import { BufferGeometry, Float32BufferAttribute } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

type Vertex = readonly [number, number, number];

/** Close-fitting gathered masonry: chipped corners and rounded shoulders leave genuinely narrow joints. */
export const createIndigenousWorkshopStoneGeometry = (detailed: boolean, variant = 0) => {
  const offset = Math.sin(variant * 7.13) * .035;
  const chip = (corner: number) => .105 + (.5 + .5 * Math.sin(variant * 3.17 + corner * 2.71)) * .09;
  const outline: [number, number][] = detailed ? [
    [-.5, -.5 + chip(0)], [-.5 + chip(1), -.5], [.5 - chip(2), -.5], [.5, -.5 + chip(3)],
    [.5, .5 - chip(4)], [.5 - chip(5), .5], [-.5 + chip(6), .5], [-.5, .5 - chip(7)]
  ] : [[-.5, -.5 + chip(0)], [-.5 + chip(1), -.5], [.5, -.5],
    [.5, .5 - chip(4)], [.5 - chip(5), .5], [-.5, .5]];
  const positions: number[] = [], colours: number[] = [], uvs: number[] = [];
  const triangle = (a: Vertex, b: Vertex, c: Vertex) => {
    for (const [x, y, z] of [a, b, c]) {
      positions.push(x, y, z);
      uvs.push(x + .5 + variant * .173, y + .5 + variant * .317);
      const shade = .91 + Math.sin(variant * 2.4 + x * 7 + y * 5) * .035;
      colours.push(shade * 1.015, shade, shade * .96);
    }
  };
  for (const side of [-1, 1]) {
    const centre: Vertex = [offset, Math.sin(variant * 5.31) * .035, side * .5];
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index]!, b = outline[(index + 1) % outline.length]!;
      const point = (p: readonly number[], inset: number, z: number): Vertex =>
        [p[0]! * inset, p[1]! * inset, side * z];
      // Minimal keeps the same fan, but its crown must rise above the joint edges: coplanar
      // coarse faces lost every course in native review and read as one speckled slab.
      const relief = (at: number) => (detailed ? .40 : .24) + Math.sin(variant * .83 + at * 2.31) * .045;
      const innerA = point(a, detailed ? .94 : 1, relief(index));
      const innerB = point(b, detailed ? .94 : 1, relief((index + 1) % outline.length));
      if (side > 0) triangle(centre, innerA, innerB);
      else triangle(centre, innerB, innerA);
      if (!detailed) continue;
      const outerA = point(a, 1, .22), outerB = point(b, 1, .22);
      if (side > 0) {
        triangle(innerA, outerA, outerB); triangle(innerA, outerB, innerB);
      } else {
        triangle(innerA, outerB, outerA); triangle(innerA, innerB, outerB);
      }
    }
  }
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index]!, b = outline[(index + 1) % outline.length]!;
    const depth = (at: number) => detailed ? .22 : .24 + Math.sin(variant * .83 + at * 2.31) * .045;
    const frontA: Vertex = [a[0], a[1], depth(index)];
    const frontB: Vertex = [b[0], b[1], depth((index + 1) % outline.length)];
    const backA: Vertex = [a[0], a[1], -frontA[2]], backB: Vertex = [b[0], b[1], -frontB[2]];
    triangle(frontA, backA, backB); triangle(frontA, backB, frontB);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  // Equal positions share a continuous normal across the crown and shoulders. Keeping each
  // triangle flat made broad natural stone faces look like folded paper diamonds in native E.
  const welded = mergeVertices(geometry, .000001); geometry.dispose();
  welded.computeVertexNormals();
  const finished = welded.toNonIndexed(); welded.dispose();
  finished.computeBoundingBox(); finished.computeBoundingSphere();
  return finished;
};
