import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";

import type { RoadArchStone, RoadProfilePart } from "../../render-common/road-decoration-recipe";
import { createRockShape } from "../../render-common/rocks/rock-shapes";
import { createRoadVoussoirGeometry } from "./road-decoration-voussoir";

/** Existing quarry stone topology, fitted to a course or warped into a voussoir; no noisy cuboid substitute. */
export const createRoadRubbleGeometry = (part: RoadArchStone | RoadProfilePart, detailed: boolean) => {
  if (part.kind === "arch-stone") return createRoadVoussoirGeometry(part, detailed);
  const seed = part.seed ?? 0;
  const stone = createRockShape(0, seed % 4, detailed ? "low" : "pebble"), positions = stone.positions.slice();
  // Dress broad bearing faces into the quarried lump. Rounded pebbles leave unsupported pinches
  // between courses; this retains the original chipped facets while filling a fitted masonry unit.
  for (let vertex = 0; vertex < positions.length; vertex++) {
    const value = positions[vertex]!, normalized = Math.min(1, Math.abs(value) * 2);
    positions[vertex] = Math.sign(value) * .5 * normalized ** .35;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(new Uint32BufferAttribute(stone.indices, 1));
  const colors = new Float32Array(positions.length);
  for (let index = 0; index < colors.length; index++) colors[index] = part.tint[index % 3]!;
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  geometry.scale(...part.size);
  if (part.rotation) { geometry.rotateX(part.rotation[0]); geometry.rotateY(part.rotation[1]); geometry.rotateZ(part.rotation[2]); }
  geometry.translate(...part.position);
  geometry.computeVertexNormals(); return geometry;
};
