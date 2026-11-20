import { banditCampPlan, banditSiteName } from "../../render-common/buildings/bandit-camp-plan";
import { DMath } from "../math/deterministic-math";
import type { MilitaryStructure } from "./fort-assault-rules";
import type { createSettlementMilitary, SettlementSoldier } from "./settlement-military";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** Idle soldiers within this many tiles of an undefended enemy fort's door attack its walls. */
export const AUTO_ASSAULT_RANGE = 10;

export interface ColonyFortState {
  defenders: number; typeId: number; uid: number;
  /** Wall hit points left and in all; `fallen`: seconds since they reached 0. */
  hp: number; maximum: number; fallen?: number;
}
type SettlementMilitary = ReturnType<typeof createSettlementMilitary>;

const thousands = (value: number) => Math.ceil(value).toLocaleString("en-US");

/** The status shown on a hostile fort: its defenders, its walls under attack, or its fall. */
/** A bandit site's status line: tier, the fort status under the site's own name, and its capacity. */
const hostileSiteStatus = (fort: SettlementBuilding, fortStatus: string) => {
  if (!fort.bandit) return fortStatus;
  const camp = banditCampPlan(fort.bandit);
  const named = fortStatus.replace("Enemy fort", banditSiteName(fort.bandit, fort.enemyCampEnclosure));
  return `${camp.tier} · ${named} · capacity ${camp.capacity}`;
};
export const hostileFortStatus = (defenders: number, structure?: MilitaryStructure) => {
  if (defenders) return `Enemy fort · ${defenders} ${defenders === 1 ? "defender" : "defenders"}`;
  if (structure && structure.hp <= 0) return "Destroyed · burning down";
  if (!structure) return "Undefended";
  return `Undefended · walls ${thousands(structure.hp)} / ${thousands(structure.maximum)}`;
};

const isPlayerTroop = (soldier: SettlementSoldier) => (soldier.combat?.faction ?? 0) === 0 && !soldier.stationed;

/** No order, no target and no siege: a soldier free to attack an empty fort on its own. */
const isIdle = (context: SettlementContext, soldier: SettlementSoldier, fort: SettlementBuilding) => {
  const combat = soldier.combat;
  if (!combat || combat.siege !== undefined || combat.destination || combat.target !== undefined) return false;
  const body = context.actors.find(actor => actor.uid === soldier.actor);
  return body?.phase === "militaryField" &&
    DMath.hypot(body.x - fort.access.x, body.z - fort.access.z) <= AUTO_ASSAULT_RANGE;
};

/** Idle soldiers of every kind near an undefended fort's door turn on its walls. */
const assaultUndefended = (
  context: SettlementContext, military: SettlementMilitary, soldiers: readonly SettlementSoldier[],
  fort: SettlementBuilding
) => {
  const nearby = soldiers.filter(soldier => isPlayerTroop(soldier) && isIdle(context, soldier, fort))
    .map(soldier => soldier.actor);
  if (nearby.length) military.combat.siege(nearby, fort.uid);
};

/** Labels every hostile fort with its defenders or walls; nearby idle soldiers attack empty ones. */
export const watchHostileForts = (
  context: SettlementContext, military: SettlementMilitary, forts: readonly SettlementBuilding[]
): ColonyFortState[] => {
  if (!forts.length) return [];
  const soldiers = military.soldiers();
  const structures = new Map(military.combat.doors().map(door => [door.building, door.structure]));
  return forts.map(fort => {
    const defenders = soldiers.filter(soldier => soldier.building === fort.uid &&
      (soldier.combat?.faction ?? 0) > 0).length;
    const structure = structures.get(fort.uid);
    fort.status = hostileSiteStatus(fort, hostileFortStatus(defenders, structure));
    const standing = !structure || structure.hp > 0;
    if (!defenders && standing) assaultUndefended(context, military, soldiers, fort);
    return { defenders, hp: structure?.hp ?? 0, maximum: structure?.maximum ?? 0, typeId: fort.typeId, uid: fort.uid,
      ...(structure?.fallen !== undefined && { fallen: structure.fallen }) };
  });
};
