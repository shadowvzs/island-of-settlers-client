import { AnimationClip, type KeyframeTrack, NumberKeyframeTrack, type QuaternionKeyframeTrack, Vector3 } from "three";

import type { BuildingRecipe } from "../../../render-common/buildings/building-recipe";

type RotationTrack = (name: string, axis: Vector3, times: number[], angles: number[]) => QuaternionKeyframeTrack;

/** Exported clips bind the same moving leaf pivots as live actor-derived openings. */
export const createRomanEntranceAnimation = (recipe: Pick<BuildingRecipe, "doubleDoor" | "tentDoor" | "hideDoor">,
  rotationTrack: RotationTrack, balconyYaw?: number) => {
  const times = [0, .4, 1.4, 2], axis = new Vector3(0, 1, 0);
  const tracks: KeyframeTrack[] = [];
  // Open work areas retain a real empty door Group for clip compatibility, with no moving leaf.
  if (recipe.hideDoor) tracks.push(rotationTrack("door", axis, times, [0, 0, 0, 0]));
  else if (recipe.doubleDoor) {
    tracks.push(rotationTrack("door_left", axis, times, [0, -Math.PI / 2, -Math.PI / 2, 0]),
      rotationTrack("door_right", axis, times, [0, Math.PI / 2, Math.PI / 2, 0]));
  } else if (recipe.tentDoor) {
    tracks.push(new NumberKeyframeTrack("tent_fabric.morphTargetInfluences[0]", times, [0, 1, 1, 0]));
  } else tracks.push(rotationTrack("door", axis, times, [0, -Math.PI / 2, -Math.PI / 2, 0]));
  if (balconyYaw !== undefined) {
    if (recipe.tentDoor)
      tracks.push(new NumberKeyframeTrack("tent_balcony_fabric.morphTargetInfluences[0]", times, [0, 1, 1, 0]));
    else tracks.push(rotationTrack("balcony_door", axis, times,
      [balconyYaw, balconyYaw - 1.45, balconyYaw - 1.45, balconyYaw]));
  }
  return new AnimationClip("door", 2, tracks);
};
