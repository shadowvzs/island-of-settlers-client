import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { lerp } from "../../shared/world/noise";
import { arc, type MeleePose, type Point3, track } from "./worker-melee-tracks";

/**
 * A rider's sword cut (rider model units from the saddle; +z forward, +x the rider's left). While
 * engaged the horse turns its head away so the target stands by its right shoulder
 * (MOUNTED_ENGAGE, three-mounts.ts); the rider raises the sword behind the head, then leans out
 * and cuts down past the horse's right shoulder onto the target's chest, the rein hand staying
 * on the reins. At rest the sword is held upright beside the rein hand.
 */
const MOUNTED_CUT = {
  bend: arc(0, -.05, .2, .2), lean: arc(0, .05, .3, .3), pitch: arc(.45, -.6, 2.16, 2.6),
  twist: arc(0, -.3, .25, .2), yaw: arc(-.3, -.5, -.79, -1.1),
  hand: [arc(-.14, -.2, -.38, -.36), arc(.2, .62, .2, .05), arc(.14, -.06, .2, .08)]
} as const;

/** The curved khopesh needs a raised shoulder wind-up and an outward chopping arc. */
const KHOPESH_CUT = {
  bend: arc(0, -.08, .24, .2), lean: arc(0, .08, .36, .3), pitch: arc(.35, -.85, 2.05, 2.55),
  twist: arc(0, -.4, .3, .25), yaw: arc(-.45, -.75, -.9, -1.15),
  hand: [arc(-.22, -.3, -.48, -.4), arc(.35, .78, .26, .12), arc(.12, -.12, .3, .16)]
} as const;

/**
 * The rider's parry (no shield): the sword hand comes up in front of the face, the blade lies
 * across above the head, edge up, tilted towards the rein side, and the torso sits back and turns
 * into the blow. Blended in by MountFrame.guard.
 */
const MOUNTED_PARRY = { bend: -.08, hand: [-.06, .7, .26], lean: -.04, pitch: 1.3, twist: .18, yaw: 1.25 } as const;

/**
 * Turn (radians, left) and advance (cells) of an engaged horse: they bring a target standing at
 * the simulation's mounted approach distance (1.5 x .85 cells straight ahead) beside the horse's
 * right shoulder, within the rider's reach.
 */
export const MOUNTED_ENGAGE = { advance: .36, turn: .8 } as const;

/** The rest pose eased towards the parry by `guard` (0..1). */
const MANUAL_PARRY = { ...MOUNTED_PARRY, hand: [-.28, .48, .4], pitch: .85, yaw: 1.1 } as const;
const guardPose = (guard: number, cut: typeof MOUNTED_CUT, manual: boolean) => {
  const parry = manual ? MANUAL_PARRY : MOUNTED_PARRY;
  const rest = (keys: readonly (readonly [number, number])[]) => keys[0]![1];
  return { bend: lerp(rest(cut.bend), parry.bend, guard),
    lean: lerp(rest(cut.lean), parry.lean, guard),
    pitch: lerp(rest(cut.pitch), parry.pitch, guard),
    rightHand: cut.hand.map((keys, axis) => lerp(rest(keys), parry.hand[axis]!, guard)) as Point3,
    twist: lerp(rest(cut.twist), parry.twist, guard),
    yaw: lerp(rest(cut.yaw), parry.yaw, guard) };
};

/** `progress`: through a cut (null at rest); `guard`: 0..1 into the parry while at rest. */
export const cavalrySwordPose = (progress: number | null, guard = 0, nation?: WorkerNation, manual = false): MeleePose => {
  const cut = nation === "nubian" ? KHOPESH_CUT : MOUNTED_CUT;
  const shared = { leftHand: [0, 0, 0] as Point3, shield: false, sweep: false };
  if (progress === null) return { ...shared, ...guardPose(guard, cut, manual) };
  const at = (keys: readonly (readonly [number, number])[]) => track(progress, keys);
  return { ...shared, bend: at(cut.bend), lean: at(cut.lean), pitch: at(cut.pitch),
    rightHand: cut.hand.map(at) as Point3, twist: at(cut.twist), yaw: at(cut.yaw) };
};
