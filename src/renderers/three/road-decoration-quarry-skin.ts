import { BufferGeometry, Float32BufferAttribute } from "three";

import type { RoadArchStone } from "../../render-common/road-decoration-recipe";
import { createRockShape } from "../../render-common/rocks/rock-shapes";

/** The actual pier quarry surface, dressed into an exposed radial face above the fitted core. */
export const createRoadQuarrySkin = (part: RoadArchStone, detailed: boolean, face: -1 | 1) => {
  const stone = createRockShape(0, (part.rubble ?? 0) % 4, detailed ? "low" : "pebble");
  const positions = stone.positions.slice();
  for (let vertex = 0; vertex < positions.length; vertex++) {
    const value = positions[vertex]!, normalized = Math.min(1, Math.abs(value) * 2);
    positions[vertex] = Math.sign(value) * .5 * normalized ** .35;
  }
  for (let vertex = 0; vertex < positions.length; vertex += 3) {
    const t = .025 + (positions[vertex]! + .5) * .95;
    const r = .025 + (positions[vertex + 1]! + .5) * .95;
    const angle = part.from + t * (part.to - part.from), radius = part.innerRadius + r * part.thickness;
    const exposed = part.depth / 2 - .065 + (positions[vertex + 2]! + .5) * .065;
    positions[vertex] = part.position[0] + Math.cos(angle) * radius;
    positions[vertex + 1] = part.position[1] + Math.sin(angle) * radius;
    positions[vertex + 2] = part.position[2] + face * exposed;
  }
  const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const indices = [...stone.indices];
  // Mapping X/Y into tangent/radius reverses handedness; the back face reverses Z too.
  if (face > 0) for (let index = 0; index < indices.length; index += 3)
    [indices[index + 1], indices[index + 2]] = [indices[index + 2]!, indices[index + 1]!];
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const colours = new Float32Array(positions.length);
  for (let index = 0; index < colours.length; index++) colours[index] = part.tint[index % 3]!;
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  const flat = geometry.toNonIndexed(); geometry.dispose(); return flat;
};
