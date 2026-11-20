import { CONTACT_RADIUS, DEFENCE_RADIUS, DEFEND_RADIUS } from "../../balance/commander-director";
import { probeUnitRead } from "../faction-vision-probe";
import type { SettlementPoint } from "../settlement-types";
import type { CommanderProfile, CommanderUnit } from "./commander-types";
import { distance, type ForceView, strengthPoints } from "./director-forces";
import type { MacroInputs, MacroTarget } from "./director-macros";
import type { DirectorForce, DirectorTarget } from "./director-types";

/**
 * The director's reads of one force's surroundings (A14 plan §5.1, §6), all over the faction's perception
 * (own soldiers, enemies known now, remembered enemies) and its known targets. No hidden information.
 */

/** The most urgent known target (lowest tier), nearest to `from`, lower uid on ties. */
export const pickTarget = (targets: readonly DirectorTarget[], from: SettlementPoint) => {
  let best: DirectorTarget | undefined, bestSpan = Infinity;
  for (const target of targets) {
    const span = distance(target, from);
    if (!best || target.tier < best.tier || (target.tier === best.tier && span < bestSpan)) {
      best = target;
      bestSpan = span;
    }
  }
  return best;
};

/**
 * Own strength over the target's known defence (plan §6 uncertainty margin): known enemies within 12 tiles of
 * the target, remembered ones raising the margin `u = remembered / (seen + remembered)` by the level's
 * `uncertaintyMargin`.
 */
export const targetRatio = (
  faction: number, perception: readonly CommanderUnit[], target: SettlementPoint, strength: number,
  uncertaintyMargin: number
) => {
  let seen = 0, remembered = 0;
  for (const unit of perception) {
    if (unit.faction === faction || distance(unit, target) > DEFENCE_RADIUS) continue;
    if (unit.remembered) remembered += strengthPoints(unit);
    else seen += strengthPoints(unit);
  }
  const defence = seen + remembered;
  if (!defence) return strength > 0 ? Infinity : 0;
  return strength / (defence * (1 + uncertaintyMargin * remembered / defence));
};

/** The nearest enemy the faction knows now within `radius` of `point` (remembered ones never count). */
const knownEnemyNear = (
  faction: number, perception: readonly CommanderUnit[], point: SettlementPoint, radius: number
) => {
  let best: CommanderUnit | undefined, bestSpan = radius;
  for (const unit of perception) {
    if (unit.faction === faction || unit.remembered) continue;
    const span = distance(unit, point);
    if (span <= bestSpan && (!best || span < bestSpan || unit.uid < best.uid)) {
      best = unit;
      bestSpan = span;
    }
  }
  return best;
};

export interface ForceReads {
  inputs: MacroInputs;
  threat?: SettlementPoint;
  candidate?: DirectorTarget;
}

/** Everything one force's macro choice reads, gathered once per decision. */
export const readForce = (
  faction: number, force: DirectorForce, view: ForceView, perception: readonly CommanderUnit[],
  targets: readonly DirectorTarget[], scoutable: boolean, profile: CommanderProfile
): ForceReads => {
  const current = targets.find(entry => entry.uid === force.target);
  const candidate = current ?? pickTarget(targets, view.centre);
  const threat = knownEnemyNear(faction, perception, force.home, force.radius ?? DEFEND_RADIUS);
  const contact = knownEnemyNear(faction, perception, view.centre, CONTACT_RADIUS);
  if (threat) probeUnitRead("director.threat", faction, threat);
  if (contact) probeUnitRead("director.contact", faction, contact);
  const target: MacroTarget | undefined = candidate && force.kind !== "wave"
    ? { ratio: targetRatio(faction, perception, candidate, view.strength, profile.uncertaintyMargin),
      tier: candidate.tier }
    : undefined;
  return {
    candidate,
    inputs: { attackRatio: profile.weights.attackRatio, brokenShare: view.brokenShare,
      contact: contact !== undefined, current: force.macro, goal: force.goal !== undefined, kind: force.kind,
      members: view.members, moraleMean: view.moraleMean, raidRatio: profile.raidRatio, scoutable,
      spread: view.spread, start: force.start, strength: view.strength, target, threat: threat !== undefined },
    threat: threat && { x: threat.x, z: threat.z }
  };
};
