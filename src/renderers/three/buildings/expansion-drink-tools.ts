import { type Object3D, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from "three";

import { DRINK_MOTION_SECONDS, sampleExpansionDrinkMotion } from "../../../render-common/buildings/expansion-drink-motion";
import type { BuildingFirstNation } from "../../../render-common/workers/worker-nation";

/** The exported clip and live renderer animate the same authored tool around its own centre. */
export const createExpansionDrinkTools = (root: Object3D) => {
  const tools: { object: Object3D; base: Vector3; nation: BuildingFirstNation }[] = [];
  root.traverse(object => {
    if (object.userData.drinkTool) tools.push({ object, base: object.position.clone(), nation: object.userData.drinkTool });
  });
  const times = Array.from({ length: 41 }, (_, index) => index * DRINK_MOTION_SECONDS / 40);
  const rotation = new Quaternion(), xAxis = new Vector3(1, 0, 0), yAxis = new Vector3(0, 1, 0);
  const quaternion = (nation: BuildingFirstNation, time: number) => {
    const motion = sampleExpansionDrinkMotion(nation, time);
    return rotation.setFromAxisAngle(nation === "persian" ? yAxis : xAxis,
      nation === "persian" ? motion.rotation[1] : motion.rotation[0]);
  };
  const tracks = tools.flatMap(({ base, nation, object }) => [
    new VectorKeyframeTrack(`${object.name}.position`, times, times.flatMap(time => {
      const { offset } = sampleExpansionDrinkMotion(nation, time);
      return [base.x + offset[0], base.y + offset[1], base.z + offset[2]];
    })),
    new QuaternionKeyframeTrack(`${object.name}.quaternion`, times,
      times.flatMap(time => quaternion(nation, time).toArray()))
  ]);
  return { tracks, update: (elapsed: number) => {
    for (const { base, nation, object } of tools) {
      const { offset } = sampleExpansionDrinkMotion(nation, elapsed);
      object.position.set(base.x + offset[0], base.y + offset[1], base.z + offset[2]);
      object.quaternion.copy(quaternion(nation, elapsed));
    }
  } };
};
