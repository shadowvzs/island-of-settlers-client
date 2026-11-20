import { GARRISON_CAPACITIES, MILITARY_REST_SECONDS_PER_HP } from "../balance/military";
import { militaryHealth } from "./military-combat-rules";
import { STORAGE_IDS } from "./production-rules";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementSaveV1 } from "./settlement-save-state";
import type { SettlementActor, SettlementBuilding } from "./settlement-types";

/** The combat slice that can end a building's resting eligibility. */
interface SavedMilitaryCombat {
  arrows?: readonly { building?: number; wall?: number }[];
  exchanges?: readonly { building: number }[];
}

/** Completed buildings where a player soldier may rest: storages/harbours and military sites. */
const recoveryBuilding = (building: SettlementBuilding | undefined) =>
  Boolean(building && building.construction === 1 && isOwnBuilding(building) &&
    (STORAGE_IDS.has(building.typeId) || GARRISON_CAPACITIES[building.typeId] !== undefined));

/**
 * A stored reserve or a stationed garrison inside its own completed friendly building. The actor
 * phase and physical location are authoritative; an assigned destination alone never qualifies.
 */
const restingInside = (
  soldier: SettlementSoldier, actor: SettlementActor | undefined, building: SettlementBuilding | undefined
) => {
  if (!building || !recoveryBuilding(building) || !actor || actor.job !== "Soldier" || actor.visible ||
    actor.navalOrder !== undefined || actor.demolitionReturning) return false;
  if (actor.phase === "militaryReserve")
    return soldier.building === -1 && !soldier.stationed && actor.building === actor.home &&
      STORAGE_IDS.has(building.typeId);
  if (actor.phase !== "garrison") return false;
  return soldier.stationed && soldier.building === building.uid && actor.building === building.uid &&
    GARRISON_CAPACITIES[building.typeId] !== undefined;
};

/** Buildings with a live doorway exchange or an arrow in flight: their garrison is not resting. */
export const savedMilitaryCombatBuildings = (combat: SavedMilitaryCombat | undefined) => {
  const busy = new Set<number>();
  for (const exchange of combat?.exchanges ?? []) busy.add(exchange.building);
  for (const arrow of combat?.arrows ?? []) {
    if (arrow.building !== undefined) busy.add(arrow.building);
    if (arrow.wall !== undefined) busy.add(arrow.wall);
  }
  return busy;
};

/**
 * Adds eligible resting time to `soldiers` and converts whole minutes into actual HP. Ineligible
 * soldiers keep their partial minute so a later return resumes it. Full or dead soldiers clear it.
 */
export const advanceMilitaryRecovery = (
  soldiers: Iterable<SettlementSoldier>, actors: readonly SettlementActor[], buildings: readonly SettlementBuilding[],
  seconds: number, inCombat: (uid: number) => boolean = () => false
) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const injured: SettlementSoldier[] = [];
  for (const soldier of soldiers) {
    const combat = soldier.combat;
    if (!combat || combat.faction !== 0 || soldier.commanderId) continue;
    const maximum = militaryHealth(combat.type, soldier.rank);
    if (!(combat.hp > 0) || combat.hp >= maximum) { delete soldier.recoverySeconds; continue; }
    injured.push(soldier);
  }
  if (!injured.length) return 0;
  const actorsById = new Map(actors.map(actor => [actor.uid, actor]));
  const buildingsById = new Map(buildings.map(building => [building.uid, building]));
  let recovered = 0;
  for (const soldier of injured) {
    const actor = actorsById.get(soldier.actor);
    const building = actor ? buildingsById.get(actor.building) : undefined;
    if (!building || !restingInside(soldier, actor, building) || inCombat(building.uid)) continue;
    const combat = soldier.combat!;
    const maximum = militaryHealth(combat.type, soldier.rank);
    const elapsed = (soldier.recoverySeconds ?? 0) + seconds;
    const minutes = Math.floor((elapsed + 1e-9) / MILITARY_REST_SECONDS_PER_HP);
    const gained = Math.min(minutes, maximum - combat.hp);
    if (gained > 0) {
      combat.hp = Math.min(maximum, combat.hp + gained);
      recovered += gained;
    }
    if (combat.hp >= maximum - 1e-9) { delete soldier.recoverySeconds; continue; }
    const remainder = elapsed - minutes * MILITARY_REST_SECONDS_PER_HP;
    if (remainder > 1e-9) soldier.recoverySeconds = remainder;
    else delete soldier.recoverySeconds;
  }
  return recovered;
};

/** Applies recovery to a detached save (fast catch-up), using its saved combat state as the busy set. */
export const advanceSavedMilitaryRecovery = (save: SettlementSaveV1, seconds: number) => {
  const military = save.military;
  if (!military) return 0;
  const busy = savedMilitaryCombatBuildings(military.combat);
  return advanceMilitaryRecovery(military.soldiers, save.actors, save.buildings, seconds, uid => busy.has(uid));
};
