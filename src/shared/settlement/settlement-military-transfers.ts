import { DMath } from "../math/deterministic-math";
import { withMilitaryFootCorridorBatch } from "./military-long-routes";
import type { createMilitaryOrders } from "./military-orders";
import { militaryCrowdPath } from "./military-routing";
import type { createSettlementCombat } from "./settlement-combat";
import type { createCommanderSystem } from "./settlement-commander-state";
import type { EmigratedTroop, SettlementSoldier } from "./settlement-military";
import {
  type createMilitaryStorage, grantAboard, grantFactionReserves, grantReserves
} from "./settlement-military-storage";
import { adoptImmigratedCommanders, emigrateTroop } from "./settlement-military-transport";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** Free foot soldiers of the player among `candidates` that may garrison `site`, nearest first. */
const nearestRecallCandidates = (
  context: SettlementContext, soldiers: Map<number, SettlementSoldier>, candidates: ReadonlySet<number>,
  site: SettlementBuilding
) => [...soldiers.values()].filter(soldier => {
  const actor = context.actors.find(actor => actor.uid === soldier.actor);
  return candidates.has(soldier.actor) && soldier.combat?.faction === 0 &&
    soldier.combat.type !== "cavalry" && actor && actor.navalOrder === undefined &&
    ["militaryField", "militaryReserve", "retire", "militaryReturnBlocked"].includes(actor.phase);
}).sort((a, b) => {
  const first = context.actors.find(actor => actor.uid === a.actor)!;
  const second = context.actors.find(actor => actor.uid === b.actor)!;
  return DMath.hypot(first.x - site.x, first.z - site.z) - DMath.hypot(second.x - site.x, second.z - site.z);
});

export interface MilitaryTransfersDeps {
  combat: ReturnType<typeof createSettlementCombat>;
  commander: ReturnType<typeof createCommanderSystem>;
  militaryBuildings: () => SettlementBuilding[];
  orders: ReturnType<typeof createMilitaryOrders>;
  scanTroops: (building: number) => SettlementSoldier[];
  soldiers: Map<number, SettlementSoldier>;
  storage: ReturnType<typeof createMilitaryStorage>;
  target: (building: SettlementBuilding) => number;
}

/**
 * Soldiers entering and leaving garrisons, storages and the island (ships, colonies, adventures, recalls). Split out
 * of `createSettlementMilitary`.
 */
export const createMilitaryTransfers = (context: SettlementContext, deps: MilitaryTransfersDeps) => {
  const { combat, commander, orders, soldiers, storage } = deps;
  return {
    garrison: (ids: readonly number[], uid: number) => {
      const previouslyAssigned = new Set(ids.filter(id => soldiers.get(id)?.building === uid));
      orders.reclaim(ids);
      const accepted = storage.garrison(ids, uid);
      if (accepted) orders.forgetRallyParticipants(ids.filter(id =>
        !previouslyAssigned.has(id) && soldiers.get(id)?.building === uid));
      return accepted;
    },
    returnToStorage: (ids: readonly number[], storageUid?: number) => withMilitaryFootCorridorBatch(context, () => {
      let accepted = false;
      for (const id of new Set(ids)) {
        if (!combat.returnHome([id], storageUid)) continue;
        orders.forgetRallyParticipants([id]); accepted = true;
      }
      return accepted;
    }),
    prioritizeRecallGarrisons: (ids: readonly number[]) => {
      if (context.options.homeBuilding !== 39) return [];
      const assigned: number[] = [], candidates = new Set(ids);
      for (const site of deps.militaryBuildings()) {
        if (deps.scanTroops(site.uid).length || deps.target(site) < 1) continue;
        for (const soldier of nearestRecallCandidates(context, soldiers, candidates, site)) {
          const actor = context.actors.find(actor => actor.uid === soldier.actor)!;
          if (actor.visible && !militaryCrowdPath(context, actor, site.access)) continue;
          orders.reclaim([soldier.actor]);
          if (!storage.garrison([soldier.actor], site.uid)) continue;
          candidates.delete(soldier.actor); assigned.push(soldier.actor); break;
        }
      }
      return assigned;
    },
    /** A computer economy's reserve waiting in its storage (EAI2b start kit). */
    storeFactionReserves: (troops: readonly EmigratedTroop[], site: SettlementBuilding) =>
      grantFactionReserves(context, soldiers, troops, site),
    storeReturnedTroops: (troops: readonly EmigratedTroop[], site: SettlementBuilding) =>
      grantReserves(context, soldiers, troops, site),
    /** Troops landing at a storage; with a rally banner planted they walk on to it. */
    immigrate: (troops: readonly EmigratedTroop[], site?: SettlementBuilding) => {
      const actorList = grantReserves(context, soldiers, troops, site);
      adoptImmigratedCommanders(context, commander, troops, actorList,
        context.options.homeBuilding === 39 ? "colony" : "home");
      orders.gather(actorList.map(actor => actor.uid));
      context.expeditionCombat?.arrivals(troops);
    },
    /** Monument harbour defenders: stored at the home harbour, not called out to the rally banner. */
    station: (troops: readonly EmigratedTroop[]) => { grantReserves(context, soldiers, troops); },
    /** Adventure landing: field soldiers wait hidden aboard the anchored ship until they walk ashore. */
    immigrateAboard: (troops: readonly EmigratedTroop[], deck: SettlementPoint & { y: number }, phase: string) => {
      const actorList = grantAboard(context, soldiers, troops, deck, phase);
      adoptImmigratedCommanders(context, commander, troops, actorList, "adventure");
      return actorList;
    },
    emigrate: (uid: number): EmigratedTroop | null => emigrateTroop(context, soldiers, commander, uid)
  };
};
