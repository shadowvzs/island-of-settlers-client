import { BufferGeometry, Float32BufferAttribute } from "three";

import {
  indigenousRoofHeight, type IndigenousRoofProfile
} from "../../../render-common/buildings/indigenous-roof-profile";
import { createIndigenousAwningSkin } from "./indigenous-awning-skin";
import { createIndigenousFrameSkin } from "./indigenous-frame-skin";
import { createIndigenousRoundedSkin } from "./indigenous-rounded-skin";

/** A continuous roof skin with a closed rim and underside; dimensions are applied by the recipe. */
export const createIndigenousRoofGeometry = (profile: IndigenousRoofProfile, detailed: boolean,
  entrance?: [number, number, number], rearEntrance?: [number, number, number], cutout = false,
  frameRadius?: number) => {
  if (profile === "framed") return createIndigenousFrameSkin(detailed, entrance, rearEntrance, frameRadius);
  if (profile === "awning") return createIndigenousAwningSkin(detailed);
  if (profile === "tipi" || profile === "earth")
    return createIndigenousRoundedSkin(profile, detailed, entrance, rearEntrance, cutout);
  let segments = detailed ? 12 : 4;
  if (entrance) segments = detailed ? 24 : 8;
  const xLines = Array.from({ length: segments + 1 }, (_, index) => index / segments - .5);
  if (entrance) xLines.push(entrance[0], entrance[1]);
  const xs = [...new Set(xLines)].sort((a, b) => a - b);
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const vertex = (x: number, y: number, z: number) => {
    const index = positions.length / 3;
    positions.push(x, y, z); uvs.push(x + .5, z + .5);
    return index;
  };
  for (let iz = 0; iz <= segments; iz++) for (const x of xs) {
    const z = iz / segments - .5;
    const height = indigenousRoofHeight(profile, x, z, entrance);
    vertex(x, height, z);
  }
  for (let iz = 0; iz < segments; iz++) for (let ix = 0; ix < xs.length - 1; ix++) {
    const a = iz * xs.length + ix, b = a + 1, c = a + xs.length, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const perimeter: Array<[number, number]> = [];
  for (const x of xs.slice(0, -1)) perimeter.push([x, -.5]);
  for (let i = 0; i < segments; i++) perimeter.push([.5, i / segments - .5]);
  for (const x of xs.slice(1).reverse()) perimeter.push([x, .5]);
  for (let i = 0; i < segments; i++) perimeter.push([-.5, .5 - i / segments]);
  const centre = vertex(0, -.5, 0);
  perimeter.forEach(([x, z], index) => {
    const [nx, nz] = perimeter[(index + 1) % perimeter.length]!;
    const a = vertex(x, indigenousRoofHeight(profile, x, z, entrance), z);
    const b = vertex(nx, indigenousRoofHeight(profile, nx, nz, entrance), nz);
    const c = vertex(x, -.5, z), d = vertex(nx, -.5, nz);
    const open = entrance && z === .5 && nz === .5 &&
      Math.min(x, nx) >= entrance[0] && Math.max(x, nx) <= entrance[1];
    if (!open) indices.push(a, b, c, b, d, c);
    if (!entrance) indices.push(centre, c, d);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};
