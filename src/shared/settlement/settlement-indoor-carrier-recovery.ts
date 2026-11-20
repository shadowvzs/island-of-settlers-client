import { DMath } from "../math/deterministic-math";
import { addGood, STORAGE_IDS } from "./production-rules";
import { leaveStorageArrival } from "./settlement-door-traffic";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/** A crew still at its own indoor origin has no road return to make, including its expired cargo. */
export const recoverUndepartedCarrier = (context: SettlementContext, actor: SettlementActor) => {
  const strandedLoadedReturn = actor.visible && actor.phase === "returnBlockedCarrier" &&
    actor.navigationReturnCargo && actor.ware;
  if (actor.job !== "Carrier" || (!strandedLoadedReturn && (actor.phase !== "home" || actor.visible)) ||
    actor.delivery || actor.handcart || !!actor.ware !== !!actor.navigationReturnCargo) return false;
  const home = context.buildings.find(building => building.uid === actor.home &&
    building.construction === 1 && STORAGE_IDS.has(building.typeId));
  if (!home || DMath.hypot(actor.x - home.doorThreshold.x, actor.z - home.doorThreshold.z) > .1) return false;
  if (actor.ware) {
    addGood(home.inventory, actor.ware, actor.wareUnits ?? 1);
    actor.ware = null;
    actor.wareScale = undefined;
    actor.wareUnits = undefined;
    actor.navigationReturnCargo = undefined;
  }
  leaveStorageArrival(context, actor);
  setActorPath(actor, [], "inside");
  actor.building = home.uid;
  actor.visible = false;
  actor.stockBuilding = undefined;
  actor.stockContact = undefined;
  actor.navigationRecovery = undefined;
  actor.action = "idle";
  actor.timer = 0;
  return true;
};
