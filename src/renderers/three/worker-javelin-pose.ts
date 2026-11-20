import { HIT, type MeleePose, type Point3,track } from "./worker-melee-tracks";

const READY: Point3 = [-.2, .69, .15];
const DRAWN: Point3 = [-.29, 1.08, -.18];
const RELEASE: Point3 = [-.15, 1.08, .4];
const FOLLOW: Point3 = [-.08, .76, .43];
const handTrack = (ready: Point3, drawn: Point3, release: Point3, follow: Point3, p: number): Point3 =>
  ready.map((value, axis) => track(p, [[0, value], [.5, drawn[axis]!], [.64, drawn[axis]!],
    [HIT, release[axis]!], [.86, follow[axis]!], [1, value]])) as Point3;

/** Overarm throw: point forward, draw above the shoulder, drive forward, release and follow through. */
export const javelinPose = (progress: number | null): MeleePose => {
  const p = progress ?? 0;
  const windup = track(p, [[0, 0], [.5, 1], [.64, 1], [HIT, 0], [1, 0]]);
  const drive = track(p, [[0, 0], [.64, 0], [HIT, 1], [.86, 1], [1, 0]]);
  return {
    bend: -.08 * windup + .2 * drive,
    headYaw: .35 * windup,
    leftHand: handTrack([.2, .66, .16], [.18, .94, .42], [.23, .84, .23], [.28, .68, .07], p),
    rightHand: handTrack(READY, DRAWN, RELEASE, FOLLOW, p),
    rightElbow: [-.8, .35, -.4],
    // The point faces the target throughout the draw; never swing the spear like a sword.
    pitch: track(p, [[0, .25], [.35, 1.4], [.64, 1.4], [HIT, 1.52], [.86, 1.65], [1, .25]]),
    yaw: 0, shield: true, sweep: false,
    twist: -.35 * windup + .3 * drive,
    body: { drop: .025, hipYaw: -.18 * windup + .12 * drive, lift: 0, shift: .055 * drive,
      stance: { back: .1, front: .12, width: .1 }, step: .06 * drive }
  };
};

/** Release shares the simulation's archer hit time; the next spear appears after recovery. */
export const javelinHeld = (progress: number | null) => progress === null || progress < HIT || progress >= .96;
