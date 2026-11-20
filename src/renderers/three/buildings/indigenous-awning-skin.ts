import { BufferGeometry, Float32BufferAttribute } from "three";

import { indigenousRoofHeight } from "../../../render-common/buildings/indigenous-roof-profile";

/** A taut textile sheet with an inward folded hem, not a solid gable block or flat underside. */
export const createIndigenousAwningSkin = (detailed: boolean) => {
  const count = detailed ? 12 : 4, positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const vertex = (x: number, y: number, z: number) => {
    const index = positions.length / 3;
    positions.push(x, y, z); uvs.push(x + .5, z + .5); return index;
  };
  const surface = (x: number, z: number) => indigenousRoofHeight("awning", x, z);
  for (let row = 0; row <= count; row++) for (let column = 0; column <= count; column++) {
    const x = column / count - .5, z = row / count - .5;
    vertex(x, surface(x, z), z);
    if (row < count && column < count) {
      const a = row * (count + 1) + column, b = a + 1, c = a + count + 1;
      indices.push(a, c, b, b, c, c + 1);
    }
  }
  const perimeter: [number, number][] = [];
  for (let step = 0; step < count; step++) perimeter.push([step / count - .5, -.5]);
  for (let step = 0; step < count; step++) perimeter.push([.5, step / count - .5]);
  for (let step = 0; step < count; step++) perimeter.push([.5 - step / count, .5]);
  for (let step = 0; step < count; step++) perimeter.push([-.5, .5 - step / count]);
  const hem = perimeter.map(([x, z]) => {
    const ix = x * .988, iz = z * .988, inside = surface(ix, iz);
    return [vertex(x, surface(x, z), z), vertex(ix, inside - .009, iz), vertex(ix, inside - .002, iz)];
  });
  for (let side = 0; side < hem.length; side++) for (let edge = 0; edge < 3; edge++) {
    const from = hem[side]!, to = hem[(side + 1) % hem.length]!;
    const a = from[edge]!, b = from[(edge + 1) % 3]!, c = to[edge]!, d = to[(edge + 1) % 3]!;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
};
