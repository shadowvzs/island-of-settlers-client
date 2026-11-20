import { type MeleePose, type Point3, track } from "./worker-melee-tracks";

/** Cock below the chest, seat a bolt, shoulder the stock, release at the shared .75 combat hit. */
export const crossbowPose = (progress: number | null): MeleePose => {
  const p = progress ?? 0;
  const aim = track(p, [[0, 0], [.4, 0], [.58, 1], [.8, 1], [1, 0]]);
  const cock = track(p, [[0, 0], [.15, 1], [.4, 1], [.55, 0], [1, 0]]);
  // The draw pulls the hips back; the release at .75 lets the whole body rock back and settle.
  const draw = track(p, [[0, 0], [.15, .2], [.4, .55], [.58, .2], [.75, 0], [1, 0]]);
  const recoil = track(p, [[0, 0], [.72, 0], [.76, .3], [.84, 1], [.94, .25], [1, 0]]);
  const leftHand: Point3 = [.045, .75 + .12 * aim, .32 + .04 * aim];
  const handZ = track(p, [[0, -.18], [.15, .15], [.4, -.115], [.5, -.08], [.58, -.18], [1, -.18]]);
  return {
    bend: .055 * cock - .05 * draw - .16 * recoil, headYaw: .16 * aim - .05 * recoil,
    leftHand, rightHand: [leftHand[0], leftHand[1] - .04 + .07 * cock - .02 * recoil,
      leftHand[2] + handZ],
    pitch: 0, shield: true, sweep: false, twist: -.12 * aim + .04 * recoil, yaw: 0,
    body: { drop: .025 + .015 * recoil, hipYaw: -.15, lift: 0,
      shift: -.015 * draw - .04 * recoil,
      stance: { back: .08, front: .08, width: .08 }, step: 0 }
  };
};

/** Tension and loaded bolt share the aiming/reloading phases, independent of attack speed. */
export const crossbowLoadState = (progress: number | null) => {
  if (progress === null) return { bolt: false, tension: 0 };
  const tension = track(progress, [[0, 0], [.15, 0], [.4, 1], [.7499, 1], [.77, 0], [1, 0]]);
  return { bolt: progress >= .4 && progress < .75, tension };
};
