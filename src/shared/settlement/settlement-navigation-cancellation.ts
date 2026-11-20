import { DMath } from "../math/deterministic-math";
import { addGood, countGoods, STORAGE_IDS } from "./production-rules";
import { getBuilding } from "./settlement-building-index";
import { releaseDeliveryClaim } from "./settlement-carrier-claims";
import { entrancePath } from "./settlement-entrance";
import { releaseNextDelivery } from "./settlement-land-transport-claims";
import { groundPath, setActorPath } from "./settlement-paths";
import { targetKey } from "./settlement-resources";
import { stockContact } from "./settlement-stock-transfers";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";
import { outputStockPath } from "./settlement-worker-stock-paths";

/** Abort before irreversible work, keeping paid dispatch receipts distinct from reserved output. */
export const cancelUnreachableTask = (context: SettlementContext, actor: SettlementActor) => {
  if (
    actor.handcart !== undefined ||
    actor.navalOrder !== undefined ||
    actor.job === "Mount" ||
    actor.demolitionReturning ||
    actor.wareTransfer
  )
    return false;
  if (actor.job === "Carrier") return cancelCarrier(context, actor);
  if (actor.phase === "outputWalk") return retargetOutputWalk(context, actor);
  if (
    actor.phase !== "outbound" ||
    actor.treeFellingStarted ||
    actor.foresterSeedling ||
    actor.boatWork !== undefined
  )
    return false;
  const building = context.buildings.find((entry) => entry.uid === actor.building);
  if (!building || building.typeId === 28) return false;
  const path = groundPath(context, actor, building.access, building.uid);
  if (!path) return false;
  for (const target of [actor.target, actor.preparedTarget, ...(actor.sowingBatch ?? [])]) {
    if (target) context.reservations.delete(targetKey(target));
  }
  for (const [ware, count] of Object.entries(actor.consumed ?? {}))
    addGood(building.input, ware, count);
  actor.consumed = undefined;
  actor.productionInputs = undefined;
  actor.productionPath = undefined;
  actor.preparedTarget = undefined;
  actor.target = undefined;
  actor.sowingBatch = undefined;
  actor.fieldWork = undefined;
  actor.ware = null;
  actor.wareScale = undefined;
  actor.navigationRecovery = undefined;
  building.working = false;
  building.status = "Resource unreachable; returning";
  setActorPath(actor, [...path, ...entrancePath(building)], "enterRest");
  return true;
};
const isSameSpot = (a: SettlementPoint, b?: SettlementPoint) => !!b && DMath.hypot(a.x - b.x, a.z - b.z) < 1e-6;
/**
 * The worker's shelf slot was filled while it walked there (e.g. by the "Fill all outputs" tool), so
 * the crates now cover its approach. It carries a finished product: walk to the current free slot
 * instead of standing frozen in its own stock court (TRAFFIC-01).
 */
const retargetOutputWalk = (context: SettlementContext, actor: SettlementActor) => {
  const building = getBuilding(context, actor.building);
  if (!actor.ware || actor.foresterSeedling || !building || actor.stockBuilding !== building.uid ||
    building.typeId === 28) return false;
  const contact = stockContact(context, building, "output", actor.ware, countGoods(building.output));
  if (isSameSpot(contact.approach, actor.stockContact?.approach)) return false;
  const path = outputStockPath(context, actor, building, contact.approach, false);
  if (!path) return false;
  actor.stockContact = contact;
  actor.navigationRecovery = undefined;
  setActorPath(actor, path, "outputWalk");
  return true;
};
const cancelCarrier = (context: SettlementContext, actor: SettlementActor) => {
  const delivery = actor.delivery;
  if (!delivery) return false;
  const home = context.buildings.find((entry) => entry.uid === actor.home);
  const source = context.buildings.find((entry) => entry.uid === delivery.source);
  const destination = context.buildings.find((entry) => entry.uid === delivery.destination);
  if (!home || !source || !destination) return false;
  const path = groundPath(context, actor, home.access, actor.stockBuilding ?? actor.building);
  if (!path) return false;
  // The shared release keeps the reserved/unreserved source rule and the held-cargo rule identical
  // to lease expiry, so an interruption cannot refund or claim twice.
  releaseDeliveryClaim(context, actor);
  releaseNextDelivery(context, actor);
  // Keep the source courtyard permission until the returning carrier has physically left it.
  actor.navigationRecovery = undefined;
  setActorPath(actor, path, "home");
  return true;
};

/** Repair old cancelled returns without changing cargo, identities or unrelated blocked tasks. */
export const restoreCancelledCarrierExits = (context: SettlementContext) => {
  for (const actor of context.actors) {
    if (actor.job !== "Carrier" || actor.phase !== "home" || actor.delivery ||
      !actor.navigationReturnCargo || actor.stockBuilding !== undefined) continue;
    const yard = context.buildings.find(building => !STORAGE_IDS.has(building.typeId) &&
      Math.abs(actor.x - building.x) <= building.width / 2 &&
      Math.abs(actor.z - building.z) <= building.depth / 2);
    const home = context.buildings.find(building => building.uid === actor.home);
    if (!yard || !home) continue;
    const path = groundPath(context, actor, home.access, yard.uid);
    if (!path) continue;
    actor.stockBuilding = yard.uid;
    actor.navigationRecovery = undefined;
    setActorPath(actor, path, "home");
  }
};
