import { BufferGeometry, Float32BufferAttribute } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { RoadArchStone } from "../../render-common/road-decoration-recipe";
import { createRoadQuarrySkin } from "./road-decoration-quarry-skin";

/** Real fitted radial bearing planes; only exposed stone surfaces receive shallow quarry chips. */
export const createRoadVoussoirGeometry = (part: RoadArchStone, detailed: boolean) => {
  const angular = detailed ? 3 : 2, radial = detailed ? 3 : 2;
  const positions: number[] = [], colours: number[] = [], uvs: number[] = [];
  const seed = part.rubble ?? 0;
  const point = (t: number, r: number, face: number): [number, number, number] => {
    const angle = part.from + t * (part.to - part.from);
    const interior = Math.sin(Math.PI * t), edge = Math.min(r, 1 - r) * 2;
    let radius = part.innerRadius + r * part.thickness;
    if (r === 1) radius -= interior * (.018 + .014 * Math.sin(seed * 2.3 + t * 8) ** 2);
    if (r === 0) radius += interior * (.005 + .007 * Math.sin(seed + t * 9) ** 2);
    // Every bearing endpoint has the same depth. Small irregular front facets remain wholly
    // inside the masonry envelope; they do not move or rotate the actual radial cut planes.
    const exposed = part.depth / 2 - .014 - interior * edge * .032;
    const z = face * exposed;
    return [part.position[0] + Math.cos(angle) * radius,
      part.position[1] + Math.sin(angle) * radius, part.position[2] + z];
  };
  const triangle = (a: [number, number, number], b: typeof a, c: typeof a) => {
    for (const value of [a, b, c]) {
      positions.push(...value); colours.push(...part.tint);
      uvs.push(value[0] * 2, value[1] * 2);
    }
  };
  const quad = (a: [number, number, number], b: typeof a, c: typeof a, d: typeof a, reverse = false) => {
    if (reverse) { triangle(a, c, b); triangle(b, c, d); }
    else { triangle(a, b, c); triangle(b, d, c); }
  };
  for (const face of [-1, 1]) for (let a = 0; a < angular; a++) for (let r = 0; r < radial; r++)
    quad(point(a / angular, r / radial, face), point((a + 1) / angular, r / radial, face),
      point(a / angular, (r + 1) / radial, face), point((a + 1) / angular, (r + 1) / radial, face), face > 0);
  for (const r of [0, 1]) for (let a = 0; a < angular; a++)
    quad(point(a / angular, r, -1), point((a + 1) / angular, r, -1),
      point(a / angular, r, 1), point((a + 1) / angular, r, 1), r === 0);
  for (const t of [0, 1]) for (let r = 0; r < radial; r++)
    quad(point(t, r / radial, -1), point(t, (r + 1) / radial, -1),
      point(t, r / radial, 1), point(t, (r + 1) / radial, 1), t === 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const skins = [createRoadQuarrySkin(part, detailed, 1), createRoadQuarrySkin(part, detailed, -1)];
  const merged = mergeGeometries([geometry, ...skins]);
  geometry.dispose(); skins.forEach(skin => skin.dispose());
  if (!merged) throw new Error("Fitted quarry voussoir surface merge failed");
  merged.computeBoundingBox(); merged.computeBoundingSphere(); return merged;
};
