import {
  ATTACK_BANDS,
  CONTACT_DISTANCE,
  DEFEND_BANDS,
  DEFEND_FLANK,
  DEFEND_FRONT,
  DEFEND_OVERWATCH,
  DEFEND_RESERVE,
  FLANK_DISTANCE,
  FLANK_MARGIN,
  HEIGHT_CAP,
  LINE_STEPS,
  OVERWATCH_ANGLES,
  OVERWATCH_BEHIND_FRONT,
  OVERWATCH_RANGE,
  RESERVE_DISTANCES,
  type RoleBand,
  type RolePositionWeights
} from "../../balance/commander-roles";
import { DMath } from "../../math/deterministic-math";
import { INFLUENCE_CELL } from "../military-influence-map";
import type { SettlementPoint } from "../settlement-types";
import { RETARGET } from "./commander-orders";
import type { CommanderRole } from "./commander-types";

/** At most this many candidate points per role group (A14 plan §3.2, the same on every level). */
export const MAX_CANDIDATES = 12;
/** Only the best this many candidates are checked for clear ground (navigation is the costly part). */
export const CLEAR_CHECKS = 3;
/** Fractions of the way to a flank point where the enemy influence is sampled. */
export const RISK_SAMPLES: readonly number[] = [0.25, 0.5, 0.75];

/** Which way a squad's roles are laid out: round the enemy (attack) or round its post (defend). */
export type PositionMode = "attack" | "defend";

/**
 * The geometry a squad's role groups are placed in: `reference` is the enemy centre (attack) or the post
 * (defend); `dirX`/`dirZ` the unit direction from the squad's side towards the enemy centre.
 */
export interface PositionFrame {
  mode: PositionMode;
  reference: SettlementPoint;
  enemyCentre: SettlementPoint;
  /** Attack: lateral extent of the enemy group (offsets along the right angle of the direction, min and max). */
  lateralMin: number;
  lateralMax: number;
  /** Attack: the enemy's ranged group (its archers' centre; the enemy centre without archers) and its depth. */
  flankTarget: SettlementPoint;
  flankDepth: number;
  /** Attack: distance of the squad's steady front group from the enemy centre (0: no front group). */
  frontDistance: number;
  enemyHeight: number;
  home: SettlementPoint;
  dirX: number;
  dirZ: number;
}

/** What a candidate point is scored from (influences as raw strengths, distances in tiles). */
export interface CandidateSample {
  own: number;
  enemy: number;
  /** Height above the enemy centre (world units). */
  heightGain: number;
  /** Distance from the frame's reference point. */
  reach: number;
  /** Distance from the group's centre. */
  travel: number;
  /** Mean enemy influence share on the straight way there (flank only, else 0). */
  risk: number;
  /** Within `RETARGET` of the group's previous point. */
  nearPrevious: boolean;
  /** Whether the role counts the height term (front and overwatch). */
  usesHeight: boolean;
  /** Extra exposure share: the group's current place while it is under unseen fire (plan §6), else 0. */
  alertExposure: number;
}

const RADIANS = Math.PI / 180;
/** Rotations of the overwatch points off the line (cos, sin), computed once. */
const OVERWATCH_TURNS = OVERWATCH_ANGLES.map((angle) => [DMath.cos(angle * RADIANS), DMath.sin(angle * RADIANS)]);

/** The share of a cell's strength that is `part` (0-1; a cell nobody holds is 0). */
export const influenceShare = (part: number, other: number) => part / (part + other + 1);

const inBand = (reach: number, band: RoleBand) => reach >= band[0] && reach <= band[1];

/** A candidate's score (higher is better), the A14 plan §3.2 formula over influence shares. */
export const scoreCandidate = (sample: CandidateSample, weights: RolePositionWeights, band: RoleBand) => {
  const height = sample.usesHeight ? Math.min(HEIGHT_CAP, Math.max(0, sample.heightGain)) : 0;
  return (
    weights.support * influenceShare(sample.own, sample.enemy) -
    weights.exposure * (influenceShare(sample.enemy, sample.own) + sample.alertExposure) +
    weights.height * height +
    (inBand(sample.reach, band) ? weights.reach : 0) -
    (weights.travel * sample.travel) / INFLUENCE_CELL -
    weights.flankRisk * sample.risk +
    (sample.nearPrevious ? weights.commitment : 0)
  );
};

/** The attacking overwatch's band moved back behind the front (reused: valid until the next call). */
const behindFrontBand: [number, number] = [0, 0];

/** The role's distance band in the frame's mode (the overwatch's moves back with the front, A14-2). */
export const bandOf = (frame: PositionFrame, role: CommanderRole): RoleBand => {
  if (frame.mode !== "attack") return DEFEND_BANDS[role];
  const band = ATTACK_BANDS[role];
  const shift = role === "overwatch" ? overwatchRange(frame) - OVERWATCH_RANGE : 0;
  if (shift <= 0) return band;
  behindFrontBand[0] = band[0] + shift;
  behindFrontBand[1] = band[1] + shift;
  return behindFrontBand;
};

/** Candidate points of one role group as flat x/z pairs (reused; `count` points are valid). */
export interface CandidateBuffer {
  count: number;
  /** Candidate 0 is the group's current place (not for an attacking flank, which must go round). */
  withCentre: boolean;
  xz: Float64Array;
}

export const createCandidateBuffer = (): CandidateBuffer =>
  ({ count: 0, withCentre: true, xz: new Float64Array(MAX_CANDIDATES * 2) });

const push = (buffer: CandidateBuffer, x: number, z: number) => {
  if (buffer.count >= MAX_CANDIDATES) return;
  buffer.xz[buffer.count * 2] = x;
  buffer.xz[buffer.count * 2 + 1] = z;
  buffer.count++;
};

/** Points along the line through `origin` in the frame's direction, at `distance + step` (step per line step). */
const pushLine = (buffer: CandidateBuffer, frame: PositionFrame, origin: SettlementPoint, distance: number) => {
  for (const step of LINE_STEPS)
    push(buffer, origin.x + frame.dirX * (distance + step), origin.z + frame.dirZ * (distance + step));
};

/** Points at `distance` from `origin`, the frame direction turned by each overwatch angle (`sign` -1: back). */
const pushFan = (
  buffer: CandidateBuffer,
  frame: PositionFrame,
  origin: SettlementPoint,
  distance: number,
  sign: number
) => {
  for (const [cos, sin] of OVERWATCH_TURNS) {
    const x = frame.dirX * cos! - frame.dirZ * sin!,
      z = frame.dirX * sin! + frame.dirZ * cos!;
    push(buffer, origin.x + sign * x * distance, origin.z + sign * z * distance);
  }
};

/** Both sides of `origin`, at right angles to the frame direction. */
const pushSides = (buffer: CandidateBuffer, frame: PositionFrame, origin: SettlementPoint, distance: number) => {
  push(buffer, origin.x - frame.dirZ * distance, origin.z + frame.dirX * distance);
  push(buffer, origin.x + frame.dirZ * distance, origin.z - frame.dirX * distance);
};

/**
 * Attack flank (A14-2): beyond both ends of the enemy line (its lateral extent plus `FLANK_MARGIN`, at least
 * `FLANK_DISTANCE` out), `FLANK_MARGIN` past its ranged group, so the way there goes round the line, not into
 * it, and the strike comes from the archers' side.
 */
const pushLineEnds = (buffer: CandidateBuffer, frame: PositionFrame) => {
  const rightX = -frame.dirZ, rightZ = frame.dirX;
  const depth = frame.flankDepth + FLANK_MARGIN;
  const depthX = frame.enemyCentre.x + frame.dirX * depth,
    depthZ = frame.enemyCentre.z + frame.dirZ * depth;
  const right = Math.max(FLANK_DISTANCE, frame.lateralMax + FLANK_MARGIN),
    left = Math.min(-FLANK_DISTANCE, frame.lateralMin - FLANK_MARGIN);
  push(buffer, depthX + rightX * right, depthZ + rightZ * right);
  push(buffer, depthX + rightX * left, depthZ + rightZ * left);
};

/**
 * Points behind the post (defend), or straight behind the group itself on the line from the enemy centre through
 * it (attack, A14-2): a reserve steps back out of the fight instead of crossing the squad to a point behind the
 * contact line (that walk through its own ranks was the main stall of the field battles).
 */
const pushReserve = (buffer: CandidateBuffer, frame: PositionFrame, centre: SettlementPoint) => {
  if (frame.mode === "defend") {
    for (const distance of DEFEND_RESERVE)
      push(buffer, frame.home.x - frame.dirX * distance, frame.home.z - frame.dirZ * distance);
    return;
  }
  const awayX = centre.x - frame.enemyCentre.x,
    awayZ = centre.z - frame.enemyCentre.z;
  const length = DMath.hypot(awayX, awayZ);
  const backX = length > 1 ? awayX / length : -frame.dirX,
    backZ = length > 1 ? awayZ / length : -frame.dirZ;
  for (const distance of RESERVE_DISTANCES) {
    const reach = Math.max(distance, length + distance - RESERVE_DISTANCES[0]!);
    push(buffer, frame.enemyCentre.x + backX * reach, frame.enemyCentre.z + backZ * reach);
  }
};

/** The overwatch stands in bow band, but behind its own steady front (it re-forms behind a front that fell back). */
const overwatchRange = (frame: PositionFrame) =>
  Math.max(OVERWATCH_RANGE, frame.frontDistance + OVERWATCH_BEHIND_FRONT);

/** The role's own candidates (attack: round the enemy centre; defend: round the post). */
const pushRolePoints = (
  buffer: CandidateBuffer, frame: PositionFrame, role: CommanderRole, centre: SettlementPoint
) => {
  const attack = frame.mode === "attack";
  if (role === "front") {
    if (attack) pushLine(buffer, frame, frame.enemyCentre, -CONTACT_DISTANCE);
    else pushLine(buffer, frame, frame.home, DEFEND_FRONT);
    return;
  }
  if (role === "overwatch") {
    if (attack) pushFan(buffer, frame, frame.enemyCentre, overwatchRange(frame), -1);
    else pushFan(buffer, frame, frame.home, DEFEND_OVERWATCH, 1);
    return;
  }
  if (role === "flank") {
    if (attack) pushLineEnds(buffer, frame);
    else pushSides(buffer, frame, frame.home, DEFEND_FLANK);
    return;
  }
  pushReserve(buffer, frame, centre);
};

/**
 * Writes a role group's candidates: its current centre (not an attacking flank), its previous point and the
 * role's points
 * (front 3, overwatch 4, flank 2, reserve 2). At most `MAX_CANDIDATES`.
 */
export const writeCandidates = (
  buffer: CandidateBuffer,
  frame: PositionFrame,
  role: CommanderRole,
  centre: SettlementPoint,
  previous: SettlementPoint | undefined
) => {
  buffer.count = 0;
  // An attacking flank never stays where it stands: standing still in front of the line is not a flank.
  buffer.withCentre = role !== "flank" || frame.mode !== "attack";
  if (buffer.withCentre) push(buffer, centre.x, centre.z);
  if (previous) push(buffer, previous.x, previous.z);
  pushRolePoints(buffer, frame, role, centre);
  return buffer;
};

/** Whether a candidate is within `RETARGET` of the previous point. */
export const isNearPrevious = (x: number, z: number, previous: SettlementPoint | undefined) =>
  previous !== undefined && DMath.hypot(x - previous.x, z - previous.z) < RETARGET;
