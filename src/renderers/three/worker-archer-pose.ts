import { commanderBowHandTargets } from "../../render-common/workers/commander-bow-aim";
import { smoothstep01 } from "../../shared/world/noise";
import { HIT, type MeleePose, type Point3 } from "./worker-melee-tracks";

/** Archers stand side-on, feet across the line of the shot (model units, +z towards the target). */
const ARCHER_STANCE = { back: .08, front: .08, width: .1 };
/** The draw reaches full length at 70 % of the shot; the arrow leaves at the hit (75 %). */
const FULL_DRAW = .7, SETTLE = .86;

const mix = (from: Point3, to: Point3, amount: number) =>
  from.map((value, axis) => value + (to[axis]! - value) * amount) as Point3;

/** Bow low in front, the string hand on the string: the ready position between shots. */
const READY = { bow: [.07, .72, .26] as Point3, string: [-.03, .73, .19] as Point3 };
/** Full draw: bow arm pointing at the target, string hand anchored at the jaw. */
const DRAWN = { bow: [.03, .9, .4] as Point3, string: [-.05, .94, .05] as Point3 };
/** After the release the string hand flies back past the ear. */
const RELEASE_FLIGHT: Point3 = [-.04, .02, -.08];

/**
 * An archer's pose (on the field, on a tower or cornered: archers carry only a bow, owner
 * decision 2026-10-12). The body turns side-on while drawing, the head turned back to the
 * target; `progress` null is the ready position.
 */
export const archerPose = (progress: number | null): MeleePose => {
  // After the release the arms settle back to the ready position by the end of the shot.
  const settle = progress !== null && progress > SETTLE ? smoothstep01((progress - SETTLE) / (1 - SETTLE)) : 0;
  const draw = smoothstep01((progress ?? 0) / FULL_DRAW) * (1 - settle);
  const release = progress !== null && progress > HIT ? smoothstep01((progress - HIT) * 8) * (1 - settle) : 0;
  const rightHand = mix(READY.string, DRAWN.string, draw)
    .map((value, axis) => value + RELEASE_FLIGHT[axis]! * release) as Point3;
  const hipYaw = -.5 - .5 * draw, twist = .25 + .25 * draw;
  return {
    bend: 0, body: { drop: .03, hipYaw, lift: 0, shift: 0, stance: ARCHER_STANCE, step: 0 },
    headYaw: -(hipYaw + twist), leftHand: mix(READY.bow, DRAWN.bow, draw), pitch: 0, rightHand,
    shield: true, sweep: false, twist, yaw: 0
  };
};

/** Manual commander parry: real bow forward/left, with the second hand bracing below the grip. */
export const archerGuardPose = (): MeleePose => {
  const ready = archerPose(null);
  return { ...ready, body: ready.body && { ...ready.body, hipYaw: 0 }, headYaw: 0,
    leftHand: [.22, .83, .4], rightHand: [-.1, .73, .2], twist: 0 };
};

/** Manual bow keeps a steady actual grip ahead of the eye, with both hands following validated pitch. */
export const commanderArcherPose = (progress: number | null, pitch: number, guarding = false): MeleePose => {
  const settle = progress !== null && progress > SETTLE ? smoothstep01((progress - SETTLE) / (1 - SETTLE)) : 0;
  const draw = smoothstep01((progress ?? 0) / FULL_DRAW) * (1 - settle);
  const targets = commanderBowHandTargets(pitch, draw, guarding);
  const pose = archerPose(progress);
  return { ...pose, body: pose.body && { ...pose.body, drop: 0, hipYaw: 0 },
    headYaw: 0, leftHand: targets.left, leftPitch: -targets.pitch, pitch: -targets.pitch,
    rightHand: targets.right, twist: 0 };
};
