import type { BufferGeometry } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";

/** Inward-facing walls get a gentle baked shadow; no lights, shadow maps or additional meshes. */
export const applyBuildingInteriorShade = (geometry: BufferGeometry, part: BuildingPart) => {
  if (!part.interiorShade) return;
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const colours = geometry.getAttribute("color");
  if (!normals || !colours) return;
  const roundRoom = part.shape === "persian-room" || !!part.persianWindows?.length;
  const originX = roundRoom ? part.position[0] : 0, originZ = roundRoom ? part.position[2] : 0;
  for (let index = 0; index < positions.count; index++) {
    const dot = (positions.getX(index) - originX) * normals.getX(index) +
      (positions.getZ(index) - originZ) * normals.getZ(index);
    if (dot >= -.015) continue;
    // Nearly tangential jambs fade smoothly into the full interior tone.
    const strength = Math.min(1, (-dot - .015) / .15);
    for (let axis = 0; axis < 3; axis++) colours.setComponent(index, axis,
      colours.getComponent(index, axis) * (1 + (part.interiorShade[axis]! - 1) * strength));
  }
};
