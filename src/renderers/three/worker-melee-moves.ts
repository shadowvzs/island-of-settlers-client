import { hasDualTomahawks } from "../../render-common/workers/military-weapon-style";
import type { WorkerFrame, WorkerNation } from "../../render-common/workers/worker-unit";
import { dualTomahawkPose } from "./worker-dual-tomahawk-pose";
import {
  arc, type Keys, type MeleePose, type Move, type Point3, sampleMove, type Stance, stepIn, weaponDirection
} from "./worker-melee-tracks";

export type { MeleePose } from "./worker-melee-tracks";
export { weaponDirection, weaponEdge } from "./worker-melee-tracks";

/**
 * Foot melee moves (model units; +z forward, +x the soldier's left). Every move starts and ends
 * in the guard, winds up by 40 %, lands at 75 % (the simulation's hit) and follows through. The
 * whole body takes part: the front foot steps in, the hips shift forward, drop and turn, the
 * torso bends and twists; the arm IK reaches the hand targets from wherever that left the
 * shoulders. Strikes reach the torso of an enemy at the simulation's approach distance
 * (0.85 x range: torso front about 0.73 for swordsmen, 0.83 for heavy troops).
 */

/** Staggered stance: left foot forward, right foot back (right-handed fighters). */
const SWORD_STANCE: Stance = { back: .1, front: .09, width: .06 };
const HEAVY_STANCE: Stance = { back: .12, front: .1, width: .08 };
/** Torso front of an enemy heavy troop at the approach distance (model units). */
const HEAVY_CONTACT = .83;

const SWORD_MOVES: readonly Move[] = [
  // Overhead cut: the sword comes from above the right shoulder down onto the enemy's chest.
  { bend: arc(0, -.08, .25, .3), hand: [arc(-.16, -.17, -.07, -.02), arc(.66, 1, .78, .6), arc(.2, -.02, .38, .3)],
    pitch: arc(.6, -.5, 1.65, 2.1), sweep: false, twist: arc(.15, -.1, .3, .35), yaw: arc(-.1, -.3, -.05, .05),
    body: { drop: arc(.035, .03, .065, .07), hipYaw: arc(-.25, -.5, .1, .15), shift: arc(0, -.03, .07, .06),
      ...stepIn(.08) } },
  // Horizontal slash from the right: the edge leads across the enemy's chest and follows through.
  { bend: arc(0, 0, .12, .12), hand: [arc(-.16, -.3, -.05, .1), arc(.66, .84, .8, .78), arc(.2, .04, .36, .26)],
    pitch: arc(.6, 1.5, 1.5, 1.5), sweep: true, twist: arc(.15, -.25, .35, .5), yaw: arc(-.1, -1.9, .25, 1.1),
    body: { drop: arc(.035, .04, .06, .06), hipYaw: arc(-.25, -.6, .2, .35), shift: arc(0, -.02, .06, .05),
      ...stepIn(.06) } },
  // Thrust: drawn back to the hip, then a lunge with the point at the enemy's chest.
  { bend: arc(0, -.05, .22, .2), hand: [arc(-.16, -.2, -.07, -.08), arc(.66, .72, .8, .79), arc(.2, -.04, .4, .36)],
    pitch: arc(.6, 1.45, 1.5, 1.5), sweep: false, twist: arc(.15, -.2, .25, .2), yaw: arc(-.1, .1, .05, .05),
    body: { drop: arc(.035, .04, .07, .07), hipYaw: arc(-.25, -.55, .15, .1), shift: arc(0, -.04, .09, .08),
      ...stepIn(.1) } }
];

/** Two-handed swords and the Dane axe: `reach` from the grip hand to the part that strikes. */
const heavyMoves = (reach: number): readonly Move[] => {
  const chopZ = HEAVY_CONTACT - .08 - reach, swingZ = HEAVY_CONTACT - .07 - reach * .97;
  return [
    // Overhead chop from above the right shoulder, the head or blade down onto the chest.
    { bend: arc(0, -.12, .3, .35), hand: [arc(-.06, -.1, -.05, -.02), arc(.72, 1.02, .81, .62),
      arc(.26, -.04, chopZ, chopZ - .06)], pitch: arc(.55, -.45, 1.7, 2.05), sweep: false,
    twist: arc(.2, -.1, .3, .35), yaw: arc(-.1, -.2, 0, .05),
    body: { drop: arc(.04, .03, .08, .09), hipYaw: arc(-.35, -.55, .1, .15), shift: arc(0, -.04, .08, .07),
      ...stepIn(.08) } },
    // Wide swing from behind the right shoulder across the front, the hips leading.
    { bend: arc(0, 0, .15, .15), hand: [arc(-.06, -.26, -.05, .08), arc(.72, .9, .8, .78),
      arc(.26, -.02, swingZ, swingZ - .06)], pitch: arc(.55, 1.3, 1.45, 1.4), sweep: true,
    twist: arc(.2, -.35, .4, .55), yaw: arc(-.1, -2.2, .2, 1.1),
    body: { drop: arc(.04, .05, .07, .07), hipYaw: arc(-.35, -.7, .25, .4), shift: arc(0, -.02, .07, .06),
      ...stepIn(.06) } }
  ];
};
const HEAVY_REACH: Partial<Record<WorkerNation, number>> = { chinese: .6, maya: .4, viking: .55 };
const HEAVY_MOVES = new Map<number, readonly Move[]>();
const movesFor = (nation: WorkerNation | undefined) => {
  const reach = HEAVY_REACH[nation ?? "roman"] ?? .45;
  let moves = HEAVY_MOVES.get(reach);
  if (!moves) HEAVY_MOVES.set(reach, moves = heavyMoves(reach));
  return moves;
};

/** Nubian spear: the rear (right) hand pushes, the front hand guides; a low and an overhand thrust. */
const SPEAR_BODY = { drop: arc(.04, .05, .07, .07), hipYaw: arc(-.45, -.65, -.05, -.1),
  shift: arc(0, -.05, .09, .08), ...stepIn(.1) };
const SPEAR_MOVES: readonly Move[] = [
  { bend: arc(0, -.08, .22, .2), hand: [arc(-.13, -.15, -.08, -.09), arc(.7, .68, .74, .74), arc(0, -.14, -.08, -.1)],
    pitch: arc(.9, 1.45, 1.5, 1.5), sweep: false, twist: arc(.25, -.1, .3, .25), yaw: arc(.1, .12, .05, .05),
    body: SPEAR_BODY },
  { bend: arc(0, -.05, .28, .25), hand: [arc(-.13, -.14, -.08, -.08), arc(.7, 1, .95, .93), arc(0, -.12, -.1, -.12)],
    pitch: arc(.9, 1.6, 1.75, 1.75), sweep: false, twist: arc(.25, -.2, .3, .25), yaw: arc(.1, .1, .05, .05),
    body: SPEAR_BODY }
];
/** Left hand on a two-handed shaft: below the grip hand, or ahead of it on a spear. */
const SHAFT_HANDS = -.15, SPEAR_HANDS = .28;
/** A blocking shaft lies across the chest, clear of the face. */
const BLOCK_PITCH = Math.PI / 2;

export const MELEE_VARIANTS = {
  heavy: movesFor("roman").length, shield: SWORD_MOVES.length, spear: SPEAR_MOVES.length
} as const;

const still = (value: number): Keys => [[0, value]];
const block = (move: Move, hand: Point3, pitch: number, yaw: number, hipYaw: number): Move => ({
  ...move, bend: still(-.04), hand: [still(hand[0]), still(hand[1]), still(hand[2])], pitch: still(pitch),
  twist: still(.2), yaw: still(yaw),
  body: { drop: still(.05), hipYaw: still(hipYaw), lift: still(0), shift: still(-.03), step: still(0) }
});

const swordPose = (progress: number | null, variant: number, defending: boolean): MeleePose => {
  const move = SWORD_MOVES[variant % SWORD_MOVES.length]!;
  // Block: the shield comes up in front of the chest, the sword is drawn back to the hip.
  if (progress === null && defending)
    return { ...sampleMove(block(move, [-.2, .7, .05], .4, -.2, -.3), 0, SWORD_STANCE), leftHand: [.12, .92, .3],
      shield: true };
  return { ...sampleMove(move, progress ?? 0, SWORD_STANCE), leftHand: [.2, .64, .16], shield: true };
};

/** Two-handed weapons (axe, long sword, spear): both hands on the grip or haft. */
const twoHandedPose = (progress: number | null, variant: number, defending: boolean, nation?: WorkerNation) => {
  const spear = nation === "nubian", leftAlong = spear ? SPEAR_HANDS : SHAFT_HANDS;
  const moves = spear ? SPEAR_MOVES : movesFor(nation), move = moves[variant % moves.length]!;
  // Block: the shaft held diagonally across the chest, each hand on its own side, the head up to
  // the right (the spear's up to the left, as its front hand is the left one).
  const blocking = progress === null && defending;
  const sampled = blocking
    ? sampleMove(block(move, [spear ? -.12 : -.1, .86, .27], BLOCK_PITCH,
      spear ? Math.PI / 2 : -Math.PI / 2, -.35), 0, HEAVY_STANCE)
    : sampleMove(move, progress ?? 0, HEAVY_STANCE);
  const direction = weaponDirection(sampled.pitch, sampled.yaw);
  const leftHand = sampled.rightHand.map((value, axis) => value + direction[axis]! * leftAlong) as Point3;
  return { ...sampled, leftAlong, leftHand, shield: false };
};

/**
 * The melee pose of a soldier on foot this frame (archers fight with the bow only: null).
 * Heavy troops swing their two-handed weapon; the Nubian spear thrusts instead of chopping.
 * Dismounted cavalry fight like swordsmen.
 */
export const meleePose = (
  frame: Pick<WorkerFrame, "combat"> & Partial<Pick<WorkerFrame, "nation">>
): MeleePose | null => {
  const combat = frame.combat;
  if (!combat || combat.type === "archer") return null;
  const variant = combat.variant ?? 0, defending = Boolean(combat.defending);
  if (frame.nation && hasDualTomahawks(frame.nation, combat.type))
    return dualTomahawkPose(combat.attackProgress, variant, defending);
  if (combat.type !== "heavy") {
    const chopping = frame.nation === "indigenous" || frame.nation === "maya";
    const pose = swordPose(combat.attackProgress, chopping ? variant % 2 : variant, defending);
    return combat.manualGuard && defending && combat.attackProgress === null
      ? { ...pose, leftHand: [.22, .83, .4] } : pose;
  }
  return twoHandedPose(combat.attackProgress, variant, defending, frame.nation);
};

export { cavalrySwordPose } from "./worker-mounted-cut";
