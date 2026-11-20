import { DMath } from "../math/deterministic-math";
import { catapultAmmoProfile } from "./catapult-ammo-kinds";
import { militaryHealth } from "./military-combat-rules";
import type { MilitaryArrow } from "./military-projectiles";
import type { MilitarySpatialGrid } from "./military-spatial-grid";
import type { CombatHit } from "./settlement-combat-core";
import { getBuilding } from "./settlement-building-index";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementContext } from "./settlement-types";

export const CATAPULT_IMPACT_RADIUS = .75;
/** CAT-5 granite fragments: five pieces, each 35 % damage and half the base impact radius. */
export const GRANITE_FRAGMENTS = 5;
export const GRANITE_FRAGMENT_DAMAGE = .35;
export const GRANITE_FRAGMENT_RADIUS = .5;
/** q=1-distance/R: central80–100% kills;30–80% costs half maximum HP; outer0–30% costs35%. */
export const catapultImpactFraction = (distance: number, radius = CATAPULT_IMPACT_RADIUS) => {
  if (!Number.isFinite(distance) || distance < 0 || distance > radius) return 0;
  const strength = 1 - distance / radius;
  if (strength + 1e-12 >= .8) return 1;
  return strength + 1e-12 >= .3 ? .5 : .35;
};
export interface CatapultImpactTarget { x: number; y: number; z: number; id: number; faction: number }
/** A released shot keeps hurting after its shooter is gone: a stand-in heavy of the shot's faction. */
export const catapultImpactAttacker = (arrow: MilitaryArrow, soldiers: ReadonlyMap<number, SettlementSoldier>) =>
  soldiers.get(arrow.shooter) ?? { actor: arrow.shooter, rank: arrow.rank, stationed: false, building: -3,
    combat: { type: "heavy" as const, faction: arrow.faction, hp: 1, cooldown: 0 } };
/** Full health of a defender (a commander's own maximum), the base of every catapult damage share. */
export const catapultMaximumHp = (context: SettlementContext, defender: SettlementSoldier) => {
  const commander = defender.commanderId ? context.commander?.snapshotAny?.() : undefined;
  return commander?.id === defender.commanderId && commander ? commander.maximumHp :
    militaryHealth(defender.combat!.type, defender.rank);
};
/**
 * Uses one prepared spatial index; released shots keep their faction even after their shooter is removed.
 * A rolling marble shot records its direct-hit victims so the roll never strikes them again.
 */
export const resolveCatapultImpact = (context: SettlementContext, arrow: MilitaryArrow,
  targets: MilitarySpatialGrid<CatapultImpactTarget>, soldiers: ReadonlyMap<number, SettlementSoldier>, hit: CombatHit) => {
  const aim = arrow.boulder!, profile = catapultAmmoProfile(aim.kind);
  const radius = CATAPULT_IMPACT_RADIUS * (aim.fragment ? GRANITE_FRAGMENT_RADIUS : profile.impactRadius);
  const damage = aim.fragment ? GRANITE_FRAGMENT_DAMAGE : profile.damage;
  const attacker = catapultImpactAttacker(arrow, soldiers);
  // The map script names the tower as the damager (owner 2026-11-11), not its operator.
  const tower = context.script && getBuilding(context, arrow.building);
  const scriptSource = tower ? { building: tower, kind: "building" as const } : undefined;
  targets.forEachWithin(aim.x, aim.z, radius,
    body => body.faction !== arrow.faction && (soldiers.get(body.id)?.combat?.hp ?? 0) > 0, body => {
      // A ground impact does not reach a garrison figure several metres above it.
      const distance = DMath.sqrt((body.x - aim.x) * (body.x - aim.x) +
        (body.y - aim.y) * (body.y - aim.y) + (body.z - aim.z) * (body.z - aim.z));
      const fraction = catapultImpactFraction(distance, radius), defender = soldiers.get(body.id);
      if (!fraction || !defender?.combat) return;
      aim.roll?.touched.push(body.id);
      hit(attacker, defender, true, false, 1, false, fraction * damage >= 1,
        catapultMaximumHp(context, defender) * fraction * damage, scriptSource);
    });
};
