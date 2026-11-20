import { GARRISON_CAPACITIES } from "../../shared/balance/military";
import { militaryHealth } from "../../shared/settlement/military-combat-rules";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { isOwnBuilding } from "../../shared/settlement/settlement-home";
import type { SettlementSoldier } from "../../shared/settlement/settlement-military";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { SettlementSoldierDetails } from "../settlement-ui/types";

/** Physical reserves belong to their local storage; assigned troops belong to their garrison.
 * Actors aboard/committed to voyages and hostile/dead soldiers never appear in a local roster. */
export const soldierBelongsToBuilding = (
  building: SettlementBuilding,
  soldier: SettlementSoldier,
  actor: SettlementActor
) => {
  if (
    building.construction < 1 ||
    !isOwnBuilding(building) ||
    (soldier.combat?.faction ?? 0) !== 0 ||
    actor.phase === "militaryDead" ||
    actor.phase === "retired" ||
    (soldier.combat?.hp ?? 1) <= 0 ||
    actor.navalOrder !== undefined
  )
    return false;
  if (STORAGE_IDS.has(building.typeId))
    return (
      actor.phase === "militaryReserve" &&
      actor.home === building.uid &&
      actor.building === building.uid
    );
  return GARRISON_CAPACITIES[building.typeId] !== undefined && soldier.building === building.uid;
};

export const buildingSoldierDetails = (
  simulation: SettlementSimulation,
  building: SettlementBuilding,
  actors: ReadonlyMap<number, SettlementActor>
): SettlementSoldierDetails[] | undefined => {
  if (
    building.construction < 1 ||
    !isOwnBuilding(building) ||
    (!STORAGE_IDS.has(building.typeId) && GARRISON_CAPACITIES[building.typeId] === undefined)
  )
    return undefined;
  return simulation.militarySoldiers().flatMap((soldier) => {
    const actor = actors.get(soldier.actor);
    if (!actor || !soldierBelongsToBuilding(building, soldier, actor)) return [];
    const type = soldier.combat?.type ?? "shield";
    const maximum = militaryHealth(type, soldier.rank);
    const hp = Math.max(0, Math.min(maximum, soldier.combat?.hp ?? maximum));
    const full = hp >= maximum - 1e-9;
    return [
      {
        actor: soldier.actor,
        type,
        rank: soldier.rank,
        // A wounded soldier never rounds up to full health in the grouped storage roster.
        health: full ? Math.ceil(maximum) : Math.max(1, Math.floor(hp)),
        maximumHealth: Math.ceil(maximum),
        phase: actor.phase
      }
    ];
  });
};
