import { Vector3 } from "three";

import type { OrnamentalLimb } from "../../../render-common/plants/ornamental-tree-graph";
import { createOrnamentalShootGeometry } from "./ornamental-shoot-geometry";
import { createOrnamentalWoodGeometry } from "./ornamental-wood-geometry";
import { peachBarkRelief } from "./peach-bark-textures";
import { softenPeachBranchBearing } from "./peach-branch-bearing";

/** Full-width peach maps follow world metres; the model batches mature and young wood separately. */
export const createPeachWoodGeometry = (limb: OrnamentalLimb, detailed: boolean, seed: number, parent?: OrnamentalLimb) => {
  const shoot = limb.role === "twig";
  let geometry;
  if (shoot) geometry = createOrnamentalShootGeometry(limb);
  else geometry = createOrnamentalWoodGeometry(limb, detailed && limb.radius > .035, seed);
  let length = 0;
  for (let index = 1; index < limb.path.length; index++)
    length += new Vector3(...limb.path[index]!).distanceTo(new Vector3(...limb.path[index - 1]!));
  const young = limb.radius <= .045, uv = geometry.getAttribute("uv");
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  // The closed wood factory stores the side rings followed by two separate cap fans.
  let sides = 0;
  while (sides < uv.count && uv.getX(sides) < .999) sides++;
  const surfaceVertices = uv.count - (sides + 2) * 2;
  let maximumV = 0;
  for (let index = 0; index < uv.count; index++) maximumV = Math.max(maximumV, uv.getY(index));
  for (let index = 0; index < uv.count; index++) {
    if (!young && index < surfaceVertices) {
      // Taper relief to zero at bearings so coarse bark cannot open a connected limb joint.
      const along = uv.getY(index) / maximumV;
      const bearing = Math.min(1, along * 12, (1 - along) * 12);
      const depth = (peachBarkRelief(uv.getX(index), uv.getY(index) * .25) - .50) *
        Math.min(.010, limb.radius * .035) * Math.max(0, bearing);
      positions.setXYZ(index, positions.getX(index) + normals.getX(index) * depth,
        positions.getY(index) + normals.getY(index) * depth,
        positions.getZ(index) + normals.getZ(index) * depth);
    }
    const u = uv.getX(index);
    const v = uv.getY(index) * (shoot ? length : .25);
    uv.setXY(index, u, v);
  }
  softenPeachBranchBearing(geometry, limb, parent);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
};
