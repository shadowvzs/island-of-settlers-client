import { BufferGeometry, Float32BufferAttribute } from "three";

import type { OrnamentalTreeGraph } from "../../../render-common/plants/ornamental-tree-graph";
import { shrubSoilHeight } from "./roadside-shrub-textures";

type Pot = NonNullable<OrnamentalTreeGraph["pot"]>;

/** Kiln/glaze coordinates follow the actual pot height instead of arbitrary profile-ring indices. */
export const fitShrubPotUvs = (geometry: BufferGeometry, pot: Pot) => {
  const positions = geometry.getAttribute("position"), uv: number[] = [];
  for (let vertex = 0; vertex < positions.count; vertex++) {
    uv.push(Math.atan2(positions.getZ(vertex) / pot.depth, positions.getX(vertex) / pot.width) /
      (Math.PI * 2) + .5, positions.getY(vertex) / pot.height);
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
};

/** Clods rise only two millimetres above the supported soil cap and remain inside the real rim. */
export const createShrubSoilGeometry = (pot: Pot, detailed: boolean) => {
  const positions: number[] = [], uvs: number[] = [], colours: number[] = [], indices: number[] = [];
  const segments = detailed ? 32 : 16, rings = detailed ? 4 : 2;
  const add = (x: number, z: number) => {
    const u = x / (pot.width * .87) + .5, v = z / (pot.depth * .87) + .5;
    positions.push(x, pot.height - .024 + shrubSoilHeight(u, v) * .002, z);
    uvs.push(u, v); colours.push(1, 1, 1);
  };
  add(0, 0);
  for (let ring = 1; ring <= rings; ring++) for (let side = 0; side < segments; side++) {
    const angle = side / segments * Math.PI * 2, radius = ring / rings * .435;
    add(Math.sin(angle) * pot.width * radius, Math.cos(angle) * pot.depth * radius);
    const current = 1 + (ring - 1) * segments + side;
    const next = 1 + (ring - 1) * segments + (side + 1) % segments;
    if (ring === 1) indices.push(0, current, next);
    else {
      const inner = current - segments, innerNext = next - segments;
      indices.push(inner, current, innerNext, current, next, innerNext);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
