import {
  STAGING_CANDIDATES, STAGING_CLEAR_CHECKS, STAGING_SAMPLE_RADIUS
} from "../../balance/commander-director";
import { MILITARY_PROFILES } from "../../balance/military";
import { MORALE_BASE, MORALE_BROKEN, MORALE_WAVERING } from "../../balance/morale";
import { DMath } from "../../math/deterministic-math";
import type { SettlementPoint } from "../settlement-types";
import { strengthOf } from "./commander-squads";
import type { CommanderUnit } from "./commander-types";
import type { DirectorMember } from "./director-types";

/** A force's aggregate state at a decision (integer strengths ×100, scout left out of centre and spread). */
export interface ForceView {
  centre: SettlementPoint;
  spread: number;
  strength: number;
  /** Members able to take orders (not wavering or broken). */
  ready: number[];
  brokenShare: number;
  moraleMean: number;
  members: number;
}

export const strengthPoints = (unit: Pick<CommanderUnit, "health" | "moraleState" | "rank" | "type">) =>
  Math.floor(strengthOf(unit) * 100);

export const distance = (a: SettlementPoint, b: SettlementPoint) => DMath.hypot(a.x - b.x, a.z - b.z);

/** The force's view over its present members; `skip` (the scout) counts for strength only. */
export const viewForce = (members: readonly DirectorMember[], skip?: number): ForceView => {
  let x = 0, z = 0, counted = 0, strength = 0, broken = 0, morale = 0;
  const ready: number[] = [];
  for (const member of members) {
    strength += strengthPoints(member);
    if (member.moraleState === MORALE_BROKEN) broken++;
    morale += member.morale ?? MORALE_BASE;
    if ((member.moraleState ?? 0) < MORALE_WAVERING) ready.push(member.uid);
    if (member.uid === skip) continue;
    x += member.x; z += member.z; counted++;
  }
  const centre = counted ? { x: x / counted, z: z / counted } : { x: 0, z: 0 };
  let spread = 0;
  for (const member of members) if (member.uid !== skip) spread = Math.max(spread, distance(member, centre));
  return { brokenShare: members.length ? broken / members.length : 0, centre,
    members: members.length, moraleMean: members.length ? morale / members.length : MORALE_BASE, ready,
    spread, strength };
};

/** Own minus known enemy strength (×100) within the sample radius of `point`, over a faction's perception. */
const balanceAt = (faction: number, view: readonly CommanderUnit[], point: SettlementPoint) => {
  let balance = 0;
  for (const unit of view) {
    if (distance(unit, point) > STAGING_SAMPLE_RADIUS) continue;
    balance += unit.faction === faction ? strengthPoints(unit) : -strengthPoints(unit);
  }
  return balance;
};

interface ScoredPoint { point: SettlementPoint; score: number; order: number }

/**
 * The staging point (plan §5.1): the candidate on the line from `home` towards `towards` (≤ 20 tiles out) with
 * the best own-minus-enemy strength balance, nearer home on ties; only the best 3 are checked for clear
 * ground. Without a direction, or when none is clear, the force stages at home.
 */
export const chooseStaging = (
  faction: number, view: readonly CommanderUnit[], home: SettlementPoint, towards: SettlementPoint | undefined,
  isClear: (point: SettlementPoint) => boolean
): SettlementPoint => {
  if (!towards) return { x: home.x, z: home.z };
  const span = distance(home, towards);
  if (span < 1) return { x: home.x, z: home.z };
  const dx = (towards.x - home.x) / span, dz = (towards.z - home.z) / span;
  const scored: ScoredPoint[] = STAGING_CANDIDATES.map(([along, side], order) => {
    const reach = Math.min(along, span);
    const point = { x: home.x + dx * reach - dz * side, z: home.z + dz * reach + dx * side };
    return { order, point, score: balanceAt(faction, view, point) };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  for (let index = 0; index < Math.min(STAGING_CLEAR_CHECKS, scored.length); index++)
    if (isClear(scored[index]!.point)) return scored[index]!.point;
  return { x: home.x, z: home.z };
};

/** The fastest member (plan Q10: the computer scout is its fastest soldier), the lower uid on ties. */
export const fastestOf = (members: readonly DirectorMember[], ready: readonly number[]) => {
  let best: DirectorMember | undefined;
  for (const member of members) {
    if (!ready.includes(member.uid)) continue;
    if (!best || MILITARY_PROFILES[member.type].speed > MILITARY_PROFILES[best.type].speed) best = member;
  }
  return best;
};
