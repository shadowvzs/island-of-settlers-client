import {
  MORALE_ARCHER_COVER_RADIUS, MORALE_BROKEN, MORALE_FALL_BACK_DISTANCE, MORALE_GROUP_FALL_BACK_PERCENT,
  MORALE_GROUP_RADIUS, MORALE_ORDER_GRACE_TICKS, MORALE_WAVERING
} from "../../balance/morale";
import { DMath } from "../../math/deterministic-math";
import { fightingType, type MilitaryCombatant, type MilitaryTroopType } from "../military-combat-rules";
import { PLAYER_FACTION } from "../player-fog";
import type { CombatCore, FieldMemory } from "../settlement-combat-core";
import type { SettlementActor, SettlementPoint } from "../settlement-types";

/** How the morale layer moves soldiers: through the ordinary retreat order (routs: `military-rout-route.ts`). */
export interface MoraleEffectSources {
  isClear: (point: SettlementPoint) => boolean;
  /** Issues a `retreat` march for `ids` of `faction`; returns the ids that took it. */
  retreat: (ids: readonly number[], point: SettlementPoint, faction: number) => readonly number[];
  /** Soldiers the player steers directly (the hero's escort): their order is the player's. */
  directlyControlled: (uid: number) => boolean;
}

/** A body this near (tiles) a point of the way back crowds it. */
const CROWD_RADIUS = 1;
/** Headings tried for a way back, straight away from the enemy first (radians). */
const AWAY_OFFSETS: readonly number[] = [0, 0.6, -0.6, 1.2, -1.2];

/** Shares of the way back where the crowd is counted. */
const CROWD_SAMPLES: readonly number[] = [0.33, 0.66, 1];

/**
 * A clear point `distance` tiles from `from`, away from `enemy` (undefined: no clear way or no direction). With
 * `crowdAt` (bodies near a point) the least crowded way back wins (ties: straighter first), so a fall-back does
 * not walk into its own ranks.
 */
export const awayPoint = (
  from: SettlementPoint, enemy: SettlementPoint, distance: number, isClear: (point: SettlementPoint) => boolean,
  crowdAt?: (point: SettlementPoint) => number
) => {
  if (from.x === enemy.x && from.z === enemy.z) return undefined;
  const heading = DMath.atan2(from.z - enemy.z, from.x - enemy.x);
  let best: SettlementPoint | undefined, bestCrowd = Infinity;
  for (const offset of AWAY_OFFSETS) {
    const cos = DMath.cos(heading + offset), sin = DMath.sin(heading + offset);
    const point = { x: from.x + cos * distance, z: from.z + sin * distance };
    if (!isClear(point)) continue;
    if (!crowdAt) return point;
    let crowd = 0;
    for (const share of CROWD_SAMPLES)
      crowd += crowdAt({ x: from.x + cos * distance * share, z: from.z + sin * distance * share });
    if (crowd < bestCrowd) { best = point; bestCrowd = crowd; }
    if (!crowd) break;
  }
  return best;
};

/**
 * Morale effects (A14 plan §4.2) on a state change, never per tick (each returns the soldiers it ordered): a
 * wavering soldier falls back (with its role group when half of it wavers) along the least crowded way back; a
 * broken one's rout (`military-rout-route.ts`) uses `awayFrom` when it has no rally point. A player soldier
 * ordered in the last 3 s skips the fall-back (owner Q1).
 */
export const createMoraleEffects = (
  { grid, memories, sieges, soldiers }: CombatCore, { directlyControlled, isClear, retreat }: MoraleEffectSources
) => {
  /** Reused: the role group of the soldier falling back. */
  const members: SettlementActor[] = [], ids: number[] = [];
  let groupFaction = 0, groupType: MilitaryTroopType = "shield";
  const isGroupMember = (other: SettlementActor) => {
    const state = soldiers.get(other.uid)?.combat;
    return state?.faction === groupFaction && fightingType(state) === groupType && other.phase === "militaryField" &&
      state.siege === undefined && !sieges.isDefender(other.uid) && !directlyControlled(other.uid);
  };
  const collect = (other: SettlementActor) => { members.push(other); };
  /** Field soldiers within `CROWD_RADIUS` of a point (the way back's crowding). */
  let crowd = 0;
  const countOne = () => { crowd++; };
  const anyone = () => true;
  const crowdAt = (point: SettlementPoint) => {
    crowd = 0;
    grid.forEachWithin(point.x, point.z, CROWD_RADIUS, anyone, countOne);
    return crowd;
  };
  const followsOrder = (uid: number, faction: number, tick: number) => {
    const ordered = memories.get(uid)?.orderedTick;
    return faction === PLAYER_FACTION && ordered !== undefined && tick - ordered < MORALE_ORDER_GRACE_TICKS;
  };
  const wavers = (uid: number) => (memories.get(uid)?.moraleState ?? 0) >= MORALE_WAVERING;

  /** The ids that fall back: the whole group when half of it wavers, else the soldier alone. */
  const fallingBack = (body: SettlementActor, faction: number, tick: number) => {
    let wavering = 0;
    for (const member of members) if (wavers(member.uid)) wavering++;
    ids.length = 0;
    if (wavering * 100 < MORALE_GROUP_FALL_BACK_PERCENT * members.length) {
      ids.push(body.uid);
      return ids;
    }
    for (const member of members)
      if (!followsOrder(member.uid, faction, tick) && memories.get(member.uid)?.moraleState !== MORALE_BROKEN)
        ids.push(member.uid);
    return ids;
  };

  /**
   * A14-3 "archers check first" (plan §4.2): when a melee group falls back, its side's archers standing behind it
   * (within `MORALE_ARCHER_COVER_RADIUS`, farther from the enemy: in its way back) step back the same distance
   * first, so the front does not end up behind its own bows. Archers farther back (an overwatch post) stay, as do
   * the routing, the directly steered and the freshly ordered ones.
   */
  const archers: SettlementActor[] = [], archerIds: number[] = [];
  let groupX = 0, groupZ = 0, enemyX = 0, enemyZ = 0, archerTick = 0;
  const isCoveringArcher = (other: SettlementActor) => {
    const state = soldiers.get(other.uid)?.combat;
    if (state?.faction !== groupFaction || fightingType(state) !== "archer" || other.phase !== "militaryField")
      return false;
    if (state.siege !== undefined || sieges.isDefender(other.uid) || directlyControlled(other.uid)) return false;
    if (memories.get(other.uid)?.moraleState === MORALE_BROKEN || followsOrder(other.uid, groupFaction, archerTick))
      return false;
    return (other.x - groupX) * (groupX - enemyX) + (other.z - groupZ) * (groupZ - enemyZ) > 0;
  };
  const collectArcher = (other: SettlementActor) => { archers.push(other); };
  const archersFirst = (enemy: SettlementPoint, tick: number) => {
    archers.length = 0;
    archerIds.length = 0;
    enemyX = enemy.x; enemyZ = enemy.z; archerTick = tick;
    grid.forEachWithin(groupX, groupZ, MORALE_ARCHER_COVER_RADIUS, isCoveringArcher, collectArcher);
    if (!archers.length) return 0;
    let x = 0, z = 0;
    for (const archer of archers) { x += archer.x; z += archer.z; archerIds.push(archer.uid); }
    const point = awayPoint({ x: x / archers.length, z: z / archers.length }, enemy, MORALE_FALL_BACK_DISTANCE,
      isClear, crowdAt);
    return point ? retreat(archerIds, point, groupFaction).length : 0;
  };

  const fallBack = (
    body: SettlementActor, state: MilitaryCombatant, _memory: FieldMemory, enemy: SettlementPoint, tick: number
  ) => {
    if (directlyControlled(body.uid) || followsOrder(body.uid, state.faction, tick)) return 0;
    members.length = 0;
    groupFaction = state.faction;
    groupType = fightingType(state);
    grid.forEachWithin(body.x, body.z, MORALE_GROUP_RADIUS, isGroupMember, collect);
    const leaving = fallingBack(body, state.faction, tick);
    let x = 0, z = 0;
    for (const uid of leaving) {
      const member = members.find(entry => entry.uid === uid) ?? body;
      x += member.x; z += member.z;
    }
    groupX = x / leaving.length; groupZ = z / leaving.length;
    const covered = leaving.length > 1 && groupType !== "archer" ? archersFirst(enemy, tick) : 0;
    const point = awayPoint({ x: groupX, z: groupZ }, enemy, MORALE_FALL_BACK_DISTANCE, isClear, crowdAt);
    return covered + (point ? retreat(leaving, point, state.faction).length : 0);
  };

  /** The least crowded clear point `distance` tiles away from `enemy` (the rout's fallback goal). */
  const awayFrom = (from: SettlementPoint, enemy: SettlementPoint, distance: number) =>
    awayPoint(from, enemy, distance, isClear, crowdAt);
  return { awayFrom, fallBack };
};
