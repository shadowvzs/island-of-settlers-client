import { addGood, STORAGE_IDS } from "./production-rules";
import { addIdleSettlers, retirePerson } from "./settlement-population";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/** Military identities and pack animals never become anonymous idle settlers. */
const NON_CIVILIAN_JOBS = new Set(["Soldier", "Commander", "Mount"]);

/**
 * Any civilian worker resting inside a completed storehouse, HQ or harbour is not doing a job
 * there. Return the tool it carries to that storage and turn the person back into an idle settler.
 * Production workers inside their own building are deliberately excluded: that is their work site.
 */
const reclaimIdleStorageWorker = (context: SettlementContext, actor: SettlementActor) => {
  if (NON_CIVILIAN_JOBS.has(actor.job) || actor.phase !== "inside" || actor.visible ||
    actor.delivery || actor.nextDelivery || actor.handcart || actor.ware || actor.wareTransfer ||
    actor.navalOrder !== undefined || actor.demolitionReturning || actor.target || actor.preparedTarget ||
    actor.productionInputs?.length || actor.productionOutput || actor.productionSeconds !== undefined ||
    Object.values(actor.consumed ?? {}).some(count => count > 0) ||
    Object.values(actor.demolitionCargo ?? {}).some(count => count > 0) ||
    context.buildings.some(building => building.worker === actor.uid)) return false;
  const storage = context.buildings.find(building => building.uid === actor.building);
  if (!storage || storage.construction !== 1 || !STORAGE_IDS.has(storage.typeId)) return false;
  if (actor.tool) addGood(storage.inventory, actor.tool);
  actor.job = "Settler";
  retirePerson(context, actor);
  actor.action = "idle";
  actor.visible = false;
  actor.building = storage.uid;
  actor.home = storage.uid;
  actor.tool = undefined;
  actor.ware = null;
  actor.wareUnits = undefined;
  actor.wareScale = undefined;
  actor.consumed = undefined;
  actor.productionInputs = undefined;
  actor.productionOutput = undefined;
  actor.productionSeconds = undefined;
  actor.path = [];
  actor.pathIndex = 0;
  actor.timer = 0;
  actor.queueTarget = undefined;
  actor.queueKind = undefined;
  actor.queueWait = 0;
  actor.stockBuilding = undefined;
  actor.stockContact = undefined;
  actor.storageArrivalBuilding = undefined;
  actor.storageArrivalOrder = undefined;
  actor.workerMovementPlan = undefined;
  actor.workerHandlingPlan = undefined;
  actor.navigationRecovery = undefined;
  actor.navigationReturnCargo = undefined;
  addIdleSettlers(context, storage);
  return true;
};

/** Idle carriers and other civilian workers inside storage are available settlers, not occupations. */
export const reclaimIdleCarriers = (context: SettlementContext) => {
  for (const actor of context.actors) reclaimIdleStorageWorker(context, actor);
};
