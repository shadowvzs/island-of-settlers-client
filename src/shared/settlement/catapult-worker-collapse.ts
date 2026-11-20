import { prepareCatapultWorkerEvacuation } from "./catapult-worker-evacuation";
import { detachCatapultPorter } from "./military-catapult-resupply";
import type { MilitaryDeathEffect } from "./military-combat-rules";
import { ownerOf } from "./settlement-ownership";
import { retirePerson } from "./settlement-population";
import { clearWareTransfer } from "./settlement-stock-transfers";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** Local structure casualty policy; this does not make ordinary civilians field combatants. */
export const collapseCatapultWorker = (
  context: SettlementContext, site: SettlementBuilding, onDeath: (effect: MilitaryDeathEffect) => void
) => {
  const actor = context.actors.find(body => body.uid === site.worker);
  if (!actor || actor.job !== "Carrier") return;
  const elevated = actor.phase === "catapultResupply" && actor.y > site.y + 1e-8;
  if (!elevated) prepareCatapultWorkerEvacuation(site, actor);
  detachCatapultPorter(site); site.worker = undefined;
  clearWareTransfer(actor); actor.stockBuilding = undefined; actor.stockContact = undefined;
  actor.path = []; actor.pathIndex = 0; actor.action = "idle";
  const hostile = site.enemyCatapultVariant !== undefined && ownerOf(site) > 0;
  // Ground staff already outside retain their person and cargo; the collapsed enemy workplace
  // cannot turn them into a player recruit. Hidden indoor staff share the structure casualty.
  if (elevated || hostile && !actor.visible) {
    onDeath({ age: 0, faction: ownerOf(site), id: actor.uid,
      x: actor.x, y: actor.y, z: actor.z });
    // The person and their held ammunition are destroyed by the collapsing structure, as with
    // a fallen soldier's equipment. Neither an idle settler nor a remote stock refund is created.
    actor.ware = null; actor.wareUnits = undefined; actor.catapultStoneCargo = undefined; actor.tool = undefined;
    retirePerson(context, actor); actor.visible = false;
    context.actors.splice(context.actors.indexOf(actor), 1);
    return;
  }
  actor.demolitionReturning = true;
  if (actor.catapultEvacuation) { actor.phase = "catapultEvacuate"; return; }
  actor.phase = "demolitionBlocked"; actor.visible = true;
};
