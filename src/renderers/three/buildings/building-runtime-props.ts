import type { Object3D } from "three";

/**
 * Runtime props draw only while the simulation holds them (catapult ammo overlays, delivered
 * ground stones). They are not part of the static building recipe, so the static triangle budget
 * excludes them, as it does live animals; their own caps are tested beside their kits.
 */
export const markBuildingRuntimeProp = (root: Object3D) =>
  root.traverse(object => { object.userData.buildingRuntimeProp = true; });

/** Dynamic geometry outside the static building budget: live animals and runtime props. */
export const isDynamicBuildingGeometry = (object: Object3D) =>
  Boolean(object.userData.liveAnimalGeometry || object.userData.buildingRuntimeProp);
