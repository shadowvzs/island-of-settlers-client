import { releaseFisherBoatTrip } from "./fisher-boat-release";
import { releaseDeliveryClaim } from "./settlement-carrier-claims";
import { releaseNextDelivery } from "./settlement-land-transport-claims";
import { targetKey } from "./settlement-resources";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/**
 * A player civilian whose work can be dropped where it stands: never soldiers, horses, cart crews,
 * crews at sea, catapult operators or enemy staff. Stranded relocation and enemy attacks share it.
 */
export const isFreeCivilian = (actor: SettlementActor) => actor.phase !== "retired" && actor.job !== "Soldier" &&
  actor.job !== "Mount" && !actor.handcart && actor.navalOrder === undefined && !actor.catapultOperator &&
  actor.hostileCivilianFaction === undefined;

/** Drops every claim the person held: delivery, next job, resource targets and its workplace seat. */
export const releasePersonWork = (context: SettlementContext, actor: SettlementActor) => {
  releaseFisherBoatTrip(actor, context.buildings.find(building => building.uid === actor.building));
  releaseDeliveryClaim(context, actor);
  releaseNextDelivery(context, actor);
  for (const target of [actor.target, actor.preparedTarget, ...(actor.sowingBatch ?? [])])
    if (target) context.reservations.delete(targetKey(target));
  for (const building of context.buildings) if (building.worker === actor.uid) {
    building.worker = undefined;
    building.working = false;
  }
  // Inputs a worker carried to its bench travel with it and are stored like a demolition's cargo.
  const cargo = actor.phase.startsWith("input") ? { ...actor.consumed } : {};
  Object.assign(actor, { consumed: undefined, delivery: undefined, demolitionCargo: cargo, fieldWork: undefined,
    foresterSeedling: undefined, preparedTarget: undefined, productionInputs: undefined, productionPath: undefined,
    sowingBatch: undefined, target: undefined, wellWork: undefined });
};
