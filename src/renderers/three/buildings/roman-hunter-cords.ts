import { AnimationClip, type Object3D,Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";

/** Small gravity-hung pendulums with independent phases; populated slots remain weighted. */
const cordAngle = (time: number, slot: number, strength = .8) => {
  const phase = slot * 1.17;
  return (.055 * Math.sin(time * Math.PI / 3 + phase) + .009 * Math.sin(time * Math.PI * 2 / 3 + phase)) *
    Math.max(.3, Math.min(1.15, strength));
};
const cordRotation = (time: number, slot: number, strength: number | undefined, direction = .35) => {
  const angle = cordAngle(time, slot, strength);
  return new Quaternion().setFromAxisAngle(new Vector3(Math.cos(direction), 0, -Math.sin(direction)), angle);
};

export const createRomanHunterCordWind = (root: Object3D) => {
  const cords: Object3D[] = [];
  root.traverse(object => { if (object.userData.windCordSlot !== undefined) cords.push(object); });
  const times = Array.from({ length: 61 }, (_, index) => index / 10);
  const tracks = cords.map(cord => new QuaternionKeyframeTrack(`${cord.name}.quaternion`, times,
    times.flatMap(time => cordRotation(time, cord.userData.windCordSlot, .8).toArray())));
  return {
    clip: new AnimationClip("ambient_empty_cords", 6, tracks),
    update: (time: number, count: number, strength?: number, direction?: number) => {
      for (const cord of cords) {
        const slot = cord.userData.windCordSlot as number;
        if (slot < count) cord.quaternion.identity();
        else cord.quaternion.copy(cordRotation(time, slot, strength, direction));
      }
    }
  };
};
