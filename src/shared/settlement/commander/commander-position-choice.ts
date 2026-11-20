import {
  ALERT_EXPOSURE,
  ALERT_FIRE_RANGE,
  ENEMY_GROUP_RADIUS,
  RANGED_GROUP_RADIUS,
  ROLE_POSITION_WEIGHTS
} from "../../balance/commander-roles";
import { DMath } from "../../math/deterministic-math";
import { probeAccept } from "../faction-vision-probe";
import { enemyInfluence, influenceCellOf, type InfluenceMap, ownInfluence } from "../military-influence-map";
import type { MilitarySpatialGrid } from "../military-spatial-grid";
import type { SettlementPoint } from "../settlement-types";
import {
  bandOf,
  type CandidateSample,
  CLEAR_CHECKS,
  createCandidateBuffer,
  influenceShare,
  isNearPrevious,
  MAX_CANDIDATES,
  type PositionFrame,
  type PositionMode,
  RISK_SAMPLES,
  scoreCandidate,
  writeCandidates
} from "./commander-positions";
import type { CommanderRole, CommanderUnit, MilitaryCommanderOptions, SquadContext } from "./commander-types";

interface PositionChoiceSources {
  heightAt: MilitaryCommanderOptions["heightAt"];
  isClear: MilitaryCommanderOptions["isClear"];
  knowsByAlertOnly: MilitaryCommanderOptions["knowsByAlertOnly"];
  map: InfluenceMap;
  nearbyUnits: MilitarySpatialGrid<CommanderUnit>;
}

/** Below this length (tiles) the squad stands on the enemy centre: no direction to lay roles out on. */
const MIN_DIRECTION = 0.5;
const flat = () => 0;

/**
 * Tactical position choice (A14 plan §3.2): a role group's ≤ 12 candidates are scored on the deciding
 * faction's influence map and the ground height; the best of them is checked for clear ground, at most
 * `CLEAR_CHECKS` in score order (ties: candidate order). Every buffer is reused; a chosen point is new.
 */
export const createPositionChooser = ({
  heightAt = flat,
  isClear,
  knowsByAlertOnly,
  map,
  nearbyUnits
}: PositionChoiceSources) => {
  const buffer = createCandidateBuffer(),
    scores = new Float64Array(MAX_CANDIDATES),
    tried = new Uint8Array(MAX_CANDIDATES);
  const point: SettlementPoint = { x: 0, z: 0 };
  const frame: PositionFrame = {
    dirX: 1,
    dirZ: 0,
    enemyCentre: { x: 0, z: 0 },
    enemyHeight: 0,
    flankDepth: 0,
    flankTarget: { x: 0, z: 0 },
    frontDistance: 0,
    home: { x: 0, z: 0 },
    lateralMax: 0,
    lateralMin: 0,
    mode: "attack",
    reference: { x: 0, z: 0 }
  };
  const sample: CandidateSample = {
    alertExposure: 0,
    enemy: 0,
    heightGain: 0,
    nearPrevious: false,
    own: 0,
    reach: 0,
    risk: 0,
    travel: 0,
    usesHeight: false
  };
  let sumX = 0,
    sumZ = 0,
    count = 0;
  let isEnemy = (_unit: CommanderUnit) => false;
  let isUnseenShooter = (_unit: CommanderUnit) => false;
  /** The group at `centre` is shot at by an enemy its faction knows only by the hit alert. */
  const underUnseenFire = (centre: SettlementPoint) =>
    knowsByAlertOnly !== undefined && nearbyUnits.anyWithin(centre.x, centre.z, ALERT_FIRE_RANGE, isUnseenShooter);
  const addEnemy = (unit: CommanderUnit) => {
    sumX += unit.x;
    sumZ += unit.z;
    count++;
  };
  let rangedX = 0,
    rangedZ = 0,
    ranged = 0;
  const isEnemyArcher = (unit: CommanderUnit) => isEnemy(unit) && unit.type === "archer";
  const lateralRight: SettlementPoint = { x: 0, z: 0 };
  const addLateral = (unit: CommanderUnit) => {
    const lateral = (unit.x - frame.enemyCentre.x) * lateralRight.x + (unit.z - frame.enemyCentre.z) * lateralRight.z;
    frame.lateralMin = Math.min(frame.lateralMin, lateral);
    frame.lateralMax = Math.max(frame.lateralMax, lateral);
  };
  /** Reused: the enemy's archers of this decision (the flank's prey). */
  const archers: CommanderUnit[] = [];
  const addRanged = (unit: CommanderUnit) => {
    rangedX += unit.x;
    rangedZ += unit.z;
    ranged++;
    archers.push(unit);
  };
  /**
   * The flank's prey: the enemy archer nearest the flank group (at the end of the line it went round, so
   * cornered against its own line); ties lower uid. The ranged group's centre without archers. A new point.
   */
  const strikeTarget = (from: SettlementPoint): SettlementPoint => {
    let best: CommanderUnit | undefined,
      bestDistance = Infinity;
    for (const archer of archers) {
      const distance = DMath.hypot(archer.x - from.x, archer.z - from.z);
      if (distance < bestDistance || (distance === bestDistance && best && archer.uid < best.uid)) {
        best = archer;
        bestDistance = distance;
      }
    }
    return best ? { x: best.x, z: best.z } : { x: frame.flankTarget.x, z: frame.flankTarget.z };
  };
  /** Attack: the enemy line's lateral extent and its ranged group (the flank's way round and its prey). */
  const layOutFlank = () => {
    const rightX = -frame.dirZ,
      rightZ = frame.dirX,
      centre = frame.enemyCentre;
    frame.lateralMin = 0;
    frame.lateralMax = 0;
    lateralRight.x = rightX;
    lateralRight.z = rightZ;
    rangedX = rangedZ = ranged = 0;
    archers.length = 0;
    // The whole line within reach of the ranged group's radius sets the extent, not only the nearest part of it.
    nearbyUnits.forEachWithin(centre.x, centre.z, RANGED_GROUP_RADIUS, isEnemy, addLateral);
    nearbyUnits.forEachWithin(centre.x, centre.z, RANGED_GROUP_RADIUS, isEnemyArcher, addRanged);
    frame.flankTarget.x = ranged ? rangedX / ranged : centre.x;
    frame.flankTarget.z = ranged ? rangedZ / ranged : centre.z;
    frame.flankDepth = (frame.flankTarget.x - centre.x) * frame.dirX + (frame.flankTarget.z - centre.z) * frame.dirZ;
  };

  /** Mean enemy influence share on the straight way from `from` to the point. */
  const riskTo = (faction: number, from: SettlementPoint, x: number, z: number) => {
    let risk = 0;
    for (const share of RISK_SAMPLES) {
      point.x = from.x + (x - from.x) * share;
      point.z = from.z + (z - from.z) * share;
      const cell = influenceCellOf(map, point);
      risk += influenceShare(enemyInfluence(map, faction, cell), ownInfluence(map, faction, cell));
    }
    return risk / RISK_SAMPLES.length;
  };
  const scoreAt = (
    index: number,
    faction: number,
    role: CommanderRole,
    centre: SettlementPoint,
    previous?: SettlementPoint
  ) => {
    const x = buffer.xz[index * 2]!,
      z = buffer.xz[index * 2 + 1]!;
    sample.risk = role === "flank" ? riskTo(faction, centre, x, z) : 0;
    point.x = x;
    point.z = z;
    const cell = influenceCellOf(map, point);
    sample.own = ownInfluence(map, faction, cell);
    sample.enemy = enemyInfluence(map, faction, cell);
    sample.usesHeight = role === "front" || role === "overwatch";
    sample.heightGain = sample.usesHeight ? heightAt(point) - frame.enemyHeight : 0;
    sample.reach = DMath.hypot(x - frame.reference.x, z - frame.reference.z);
    sample.travel = DMath.hypot(x - centre.x, z - centre.z);
    sample.nearPrevious = isNearPrevious(x, z, previous);
    return scoreCandidate(sample, ROLE_POSITION_WEIGHTS[role], bandOf(frame, role));
  };
  /** Scores every candidate of the role; returns the best score. */
  const scoreAll = (faction: number, role: CommanderRole, centre: SettlementPoint, previous?: SettlementPoint) => {
    writeCandidates(buffer, frame, role, centre, previous);
    // Candidate 0 is the group's current place.
    const exposedHere = underUnseenFire(centre) ? ALERT_EXPOSURE : 0;
    let best = -Infinity;
    for (let index = 0; index < buffer.count; index++) {
      sample.alertExposure = index === 0 && buffer.withCentre ? exposedHere : 0;
      scores[index] = scoreAt(index, faction, role, centre, previous);
      tried[index] = 0;
      if (scores[index]! > best) best = scores[index]!;
    }
    return best;
  };
  /** The untried candidate with the highest score (ties: the first), or -1. */
  const nextBest = () => {
    let best = -1;
    for (let index = 0; index < buffer.count; index++)
      if (!tried[index] && (best < 0 || scores[index]! > scores[best]!)) best = index;
    return best;
  };

  /** Binds the enemy filters (and their probe sites) to the faction that decides now; once per decision. */
  const begin = (faction: number) => {
    isEnemy = probeAccept("commander.position", faction, (enemy: CommanderUnit) => enemy.faction !== faction);
    isUnseenShooter = probeAccept(
      "commander.alertFire",
      faction,
      (enemy: CommanderUnit) => enemy.faction !== faction && knowsByAlertOnly!(faction, enemy)
    );
  };
  /**
   * Lays the frame of a squad decision out: round the known enemy group near the squad's nearest enemy
   * (attack) or round the squad's post facing it (defend). False when no direction can be taken.
   */
  const setFrame = (mode: PositionMode, context: SquadContext) => {
    const nearest = context.nearest;
    if (!nearest) return false;
    sumX = sumZ = count = 0;
    nearbyUnits.forEachWithin(nearest.x, nearest.z, ENEMY_GROUP_RADIUS, isEnemy, addEnemy);
    if (!count) addEnemy(nearest);
    frame.enemyCentre.x = sumX / count;
    frame.enemyCentre.z = sumZ / count;
    const origin = mode === "attack" ? context.centre : context.home;
    const dx = frame.enemyCentre.x - origin.x,
      dz = frame.enemyCentre.z - origin.z;
    const length = DMath.hypot(dx, dz);
    if (length < MIN_DIRECTION) return false;
    frame.mode = mode;
    frame.dirX = dx / length;
    frame.dirZ = dz / length;
    frame.home.x = context.home.x;
    frame.home.z = context.home.z;
    const reference = mode === "attack" ? frame.enemyCentre : context.home;
    frame.reference.x = reference.x;
    frame.reference.z = reference.z;
    frame.enemyHeight = heightAt(frame.enemyCentre);
    if (mode === "attack") layOutFlank();
    frame.frontDistance = 0;
    return true;
  };
  /** The squad's steady front (its front group's centre; undefined: none) for the overwatch to stand behind. */
  const setFront = (front: SettlementPoint | undefined) => {
    frame.frontDistance = front && frame.mode === "attack"
      ? DMath.hypot(front.x - frame.enemyCentre.x, front.z - frame.enemyCentre.z) : 0;
  };
  /** The best clear candidate of the role (a new point), or undefined when none of the best few is clear. */
  const choose = (faction: number, role: CommanderRole, centre: SettlementPoint, previous?: SettlementPoint) => {
    scoreAll(faction, role, centre, previous);
    for (let check = 0; check < CLEAR_CHECKS; check++) {
      const index = nextBest();
      if (index < 0) return undefined;
      tried[index] = 1;
      const candidate = { x: buffer.xz[index * 2]!, z: buffer.xz[index * 2 + 1]! };
      if (isClear(candidate)) return candidate;
    }
    return undefined;
  };
  /** An enemy archer the faction knows within `radius` of `centre` (the strike's prey is still there). */
  const hasPreyNear = (centre: SettlementPoint, radius: number) =>
    nearbyUnits.anyWithin(centre.x, centre.z, radius, isEnemyArcher);
  return {
    begin, choose, frame: frame as Readonly<PositionFrame>, hasPreyNear, setFront, setFrame, strikeTarget
  };
};

export type PositionChooser = ReturnType<typeof createPositionChooser>;
