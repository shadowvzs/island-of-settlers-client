import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { HANDCART_LOGISTICS } from "../balance/economy";
import { DMath } from "../math/deterministic-math";
import { emitBuildingDestroyed, emitBuildingGone } from "../script-world/script-building-events";
import { sampleSmooth } from "../world/grid-geometry";
import { bumpBuildRevision } from "../world/save/world-change-journal";
import { updateCatapultWorkerEvacuation } from "./catapult-worker-evacuation";
import { CIVILIAN_ESCAPE_PHASE, planCivilianRefuge } from "./civilian-refuge";
import { refreshCourtyardOccupancy } from "./event-courtyard";
import { releaseFisherBoatTrip } from "./fisher-boat-release";
import { addGood, STORAGE_IDS } from "./production-rules";
import { unindexBuilding } from "./settlement-building-index";
import {
  localDemolitionStores, recoverDemolitionStock, releaseDemolishedSourcePrepayments, storageDemolitionReason
} from "./settlement-demolition-storage";
import { leaveStorageArrival } from "./settlement-door-traffic";
import { canEnterDoor, entrancePath, exitPath, isInOwnDoorPassage } from "./settlement-entrance";
import { rehomeAbandonedHandcarts } from "./settlement-handcart-abandon";
import { hasCartRoom, refundHandcarts } from "./settlement-handcart-ledger";
import { recoverHandcartAfterDemolition } from "./settlement-handcart-recovery";
import {
  findHomeBuilding, isDemolitionProtected, isFoundingAnchor, isOwnBuilding, isOwnHeadquarters
} from "./settlement-home";
import { releaseNextDelivery } from "./settlement-land-transport-claims";
import { civilianOwnerOf, hasEconomy, ownerOf } from "./settlement-ownership";
import { createActor, groundPath, moveActor, setActorPath } from "./settlement-paths";
import { addIdleSettlers, retirePerson } from "./settlement-population";
import { bumpNavigationRevision } from "./settlement-reservations";
import { targetKey } from "./settlement-resources";
import { markRuinOccupancy } from "./settlement-ruins";
import { clearWareTransfer } from "./settlement-stock-transfers";
import {
  isRoadWorkShell, type SettlementActor, type SettlementBuilding, type SettlementContext
} from "./settlement-types";
import { registerStorageAccess, storagePoolAt, storagePoolById } from "./shared-storage";
import { markStrandedScan } from "./stranded-relocation";

/**
 * A displaced or fleeing person walking to a storage whose door raiders now hold picks again when
 * another storage is safe (no switch when every storage is threatened: it keeps its way).
 */
const rerouteFromThreatenedStorage = (context: SettlementContext, actor: SettlementActor) => {
  const threat = context.civilianThreat;
  if (!threat || actor.phase !== "retire" || actor.job === "Mount") return false;
  const home = context.buildingByUid?.get(actor.home) ?? context.buildings.find(b => b.uid === actor.home);
  if (!home || !threat.unsafeRefuge(home)) return false;
  const safe = context.buildings.some(b => b.construction === 1 && STORAGE_IDS.has(b.typeId) &&
    isOwnBuilding(b) && !threat.unsafeRefuge(b));
  if (!safe) return false;
  actor.phase = "demolitionBlocked";
  actor.path = []; actor.pathIndex = 0;
  return true;
};

/** Displaced crews walk to the closest completed storage and return their cargo and tools there. */
export const updateDemolitionReturn = (
  context: SettlementContext,
  actor: SettlementActor,
  dt: number
) => {
  if (!actor.demolitionReturning) return false;
  if (updateCatapultWorkerEvacuation(actor, dt)) return true;
  // A hostile civilian of a faction without an economy has no storage to return to. Keep the survivor
  // and its cargo at their actual position, rather than depositing them in the player recruitment pool.
  const owner = civilianOwnerOf(actor);
  if (owner > 0 && !hasEconomy(context, owner)) return true;
  if (actor.phase === "demolitionBlocked") {
    // A storage whose walls are down is no destination, raiders or not (BD1).
    const stores = context.buildings.filter((b) => b.construction === 1 && STORAGE_IDS.has(b.typeId) &&
      ownerOf(b) === owner && !context.civilianThreat?.fallen(b));
    // Raiders at a storage door: the person seeks a safe storage or runs (MIL-ASSAULT 2026-11-09).
    if (planCivilianRefuge(context, actor, stores, dt)) return true;
    // Demolition is not a trip home: every displaced crew goes to the closest completed storage
    // to where it stands, deposits what it carries there, and only then retires.
    stores.sort(
      (a, b) =>
        DMath.hypot(a.access.x - actor.x, a.access.z - actor.z) -
        DMath.hypot(b.access.x - actor.x, b.access.z - actor.z) || a.uid - b.uid
    );
    for (const home of stores) {
      // Do not exclude `stockBuilding` here: it can be the surviving destination storage itself
      // (for example when the demolished building was the carrier's source).
      const path = groundPath(context, actor, home.access);
      if (!path) continue;
      actor.home = home.uid;
      actor.building = home.uid;
      actor.stockBuilding = undefined;
      actor.stockContact = undefined;
      setActorPath(actor, path, "retire");
      break;
    }
    return true;
  }
  if (rerouteFromThreatenedStorage(context, actor)) return true;
  if (!moveActor(context, actor, dt)) return true;
  // An escape run ends: the person looks for a safe storage again.
  if (actor.phase === CIVILIAN_ESCAPE_PHASE) { actor.phase = "demolitionBlocked"; return true; }
  const home = context.buildings.find((b) => b.uid === actor.home);
  if (!home) {
    actor.phase = "demolitionBlocked";
    return true;
  }
  if (["retire", "assigned"].includes(actor.phase) && actor.job !== "Mount") {
    if (!STORAGE_IDS.has(home.typeId)) {
      actor.phase = "demolitionBlocked";
      return true;
    }
    if (canEnterDoor(context, actor, home)) setActorPath(actor, entrancePath(home), "enterRetire");
    return true;
  }
  if (actor.ware) addGood(home.inventory, actor.ware, actor.wareUnits ?? 1);
  if (actor.tool) addGood(home.inventory, actor.tool);
  for (const [ware, count] of Object.entries(actor.demolitionCargo ?? {}))
    if (count > 0) addGood(home.inventory, ware, count);
  actor.demolitionCargo = undefined;
  actor.ware = null; actor.catapultStoneCargo = undefined;
  actor.tool = undefined;
  actor.demolitionReturning = false;
  actor.action = "idle";
  actor.path = [];
  if (actor.job === "Mount") {
    actor.building = home.uid;
    setActorPath(actor, [home.access], "home");
    return true;
  }
  retirePerson(context, actor);
  actor.visible = false;
  addIdleSettlers(context, home);
  return true;
};
const displace = (
  context: SettlementContext,
  actor: SettlementActor,
  removed: SettlementBuilding
) => {
  leaveStorageArrival(context, actor);
  releaseNextDelivery(context, actor);
  if (actor.target) context.reservations.delete(targetKey(actor.target));
  if (actor.preparedTarget) context.reservations.delete(targetKey(actor.preparedTarget));
  for (const target of actor.sowingBatch ?? []) context.reservations.delete(targetKey(target));
  actor.sowingBatch = undefined;
  const delivery = actor.delivery;
  if (delivery) {
    const destination = context.buildings.find((b) => b.uid === delivery.destination);
    if (destination && (destination.incoming[delivery.ware] ?? 0) > 0)
      addGood(destination.incoming, delivery.ware, -(actor.wareUnits ?? 1));
    if (delivery.upgrade && destination?.workshopUpgrade?.incoming)
      addGood(destination.workshopUpgrade.incoming, delivery.ware, -1);
    // A warehouse already paid for cargo even when its carrier is still walking to pickup.
    if (!delivery.reserved && !actor.ware) actor.ware = delivery.ware;
  }
  releaseFisherBoatTrip(actor, actor.building === removed.uid ? removed
    : context.buildings.find(building => building.uid === actor.building));
  actor.demolitionCargo = actor.phase.startsWith("input") ? { ...actor.consumed } : {};
  if (actor.ware && actor.demolitionCargo[actor.ware])
    addGood(actor.demolitionCargo, actor.ware, -1);
  for (const building of context.buildings)
    if (building.worker === actor.uid) building.worker = undefined;
  const oldHome = context.buildings.find((b) => b.uid === actor.home && b.uid !== removed.uid);
  let passageUid: number | undefined;
  if (actor.phase === "exitLoaded") passageUid = delivery?.source;
  else if (["assigned", "pickup", "retire", "enterRetire", "enterHome"].includes(actor.phase))
    passageUid = actor.home;
  const exitSurvivingHome =
    oldHome && passageUid === oldHome.uid && (!actor.visible || isInOwnDoorPassage(context, actor));
  const oldWorkBuilding = context.buildings.find(
    (b) => b.uid === actor.building && b.uid !== removed.uid
  );
  let exitBuilding = exitSurvivingHome ? oldHome : undefined;
  if (!exitBuilding && !actor.visible) exitBuilding = oldWorkBuilding;
  const wasVisible = actor.visible;
  actor.delivery = undefined;
  actor.target = undefined;
  actor.preparedTarget = undefined;
  actor.productionInputs = undefined;
  actor.productionPath = undefined;
  actor.consumed = undefined;
  clearWareTransfer(actor);
  actor.stockBuilding = oldWorkBuilding?.uid;
  actor.stockContact = undefined;
  actor.queueTarget = undefined;
  actor.queueWait = 0;
  actor.wellWork = undefined;
  actor.foresterSeedling = undefined;
  if (actor.catapultEvacuation) {
    actor.demolitionReturning = true; actor.phase = "catapultEvacuate";
    actor.action = "idle"; actor.path = []; actor.pathIndex = 0;
    return;
  }
  if (!actor.visible) {
    // A removed door cannot own a future exit or storage turn. Release trapped people at its real threshold.
    let point = removed.hasDoor ? removed.doorThreshold : removed.access;
    if (exitBuilding) point = exitBuilding.doorThreshold;
    actor.x = point.x;
    actor.z = point.z;
  }
  actor.visible = exitBuilding ? wasVisible : true;
  actor.demolitionReturning = true;
  if (actor.job !== "Mount" && actor.hostileCivilianFaction === undefined) actor.job = "Settler";
  actor.phase = "demolitionBlocked";
  actor.action = "idle";
  actor.path = [];
  actor.pathIndex = 0;
  if (exitBuilding) {
    actor.home = exitBuilding.uid;
    actor.building = exitBuilding.uid;
    setActorPath(actor, exitPath(exitBuilding), "assigned");
  }
};
/** Shelved carts move to storages with room; the rest are dismantled into the home's stock. */
const rehomeShelvedCarts = (
  context: SettlementContext, building: SettlementBuilding, stores: SettlementBuilding[]
) => {
  for (; building.handcarts; building.handcarts--) {
    const storage = stores.find(candidate => hasCartRoom(context, candidate));
    if (storage) storage.handcarts = (storage.handcarts ?? 0) + 1;
    else {
      const pool = storagePoolById(context, building.storagePoolId) ?? storagePoolAt(context, building.access);
      if (pool) for (const [ware, amount] of Object.entries(HANDCART_LOGISTICS.cost)) addGood(pool.available, ware, amount);
      else if (stores[0]) refundHandcarts(stores[0], 1);
    }
  }
};

const relocateIdleSettlers = (
  context: SettlementContext, building: SettlementBuilding, local: SettlementBuilding | undefined,
  fallback: SettlementBuilding
) => {
  if (!STORAGE_IDS.has(building.typeId)) return;
  if (local) {
    local.idleSettlers = (local.idleSettlers ?? 0) + (building.idleSettlers ?? 0);
    building.idleSettlers = 0;
    return;
  }
  // A destroyed offshore depot cannot teleport its finite people to the distant headquarters.
  for (let remaining = building.idleSettlers ?? 0; remaining > 0; remaining--) {
    const actor = createActor(context, "Settler", building.uid);
    Object.assign(actor, { home: fallback.uid, building: fallback.uid, x: building.access.x, z: building.access.z,
      y: sampleSmooth(context.options.world, context.options.world.heights, building.access.x, building.access.z),
      visible: true, phase: "demolitionBlocked", action: "idle", demolitionReturning: true, path: [], pathIndex: 0 });
  }
};
/** Removes a building and displaces its people and stock, without the demolition visual. */
/** `destroyed`: a fallen ruin is cleared (the map script's gone reason "died"), not a demolition. */
export const removeSettlementBuilding = (
  context: SettlementContext, building: SettlementBuilding, destroyed = false
) => {
  const uid = building.uid;
  if (context.script) emitBuildingGone(context, building, destroyed);
  registerStorageAccess(context, building);
  const storage = findHomeBuilding(context)!;
  const localStores = localDemolitionStores(context, building);
  relocateIdleSettlers(context, building, localStores[0], storage);
  const prepaidCarriers = releaseDemolishedSourcePrepayments(context, building);
  recoverDemolitionStock(context, building, localStores[0]);
  // A commander's lodge removal keeps the roster identity and mount; only its home is lost.
  context.commander?.beforeBuildingRemoved(uid);
  const cartCrews = context.actors.filter(actor => actor.handcart);
  for (const actor of context.actors) if (actor.nextDelivery &&
    (actor.nextDelivery.source === uid || actor.nextDelivery.destination === uid ||
      actor.home === uid || actor.handcart?.owner === uid)) releaseNextDelivery(context, actor);
  for (const actor of context.actors) {
    if (actor.phase === "retired" || actor.handcart) continue;
    if (
      actor.building === uid ||
      actor.home === uid ||
      actor.delivery?.source === uid ||
      actor.delivery?.destination === uid ||
      prepaidCarriers.has(actor.uid) ||
      actor.stockBuilding === uid
    )
      displace(context, actor, building);
  }
  context.fieldCycles?.removeBuilding(uid);
  context.factionKnowledge?.forgetBuilding(uid);
  context.transfers = context.transfers.filter(
    (order) => order.source !== uid && order.destination !== uid
  );
  context.buildings.splice(context.buildings.indexOf(building), 1);
  unindexBuilding(context, building);
  context.roadDecorations?.changedBuilding(building);
  bumpNavigationRevision(context);
  // Carts are settled once the building is gone, so no refund can land in demolished stock.
  rehomeShelvedCarts(context, building, localStores);
  rehomeAbandonedHandcarts(context, building, localStores);
  for (const actor of cartCrews)
    if (recoverHandcartAfterDemolition(context, actor, building)) displace(context, actor, building);
  context.occupied.fill(0);
  for (const remaining of context.buildings) {
    // Road work shells never claimed occupancy when they were created (see road-work-shell.ts).
    if (isRoadWorkShell(remaining)) continue;
    for (let z = remaining.z - remaining.depth / 2; z < remaining.z + remaining.depth / 2; z++)
      for (let x = remaining.x - remaining.width / 2; x < remaining.x + remaining.width / 2; x++)
        context.occupied[z * context.options.world.cellsX + x] = 1;
    if (!isOpenArcherTower(remaining)) context.occupied[
      Math.floor(remaining.access.z) * context.options.world.cellsX + Math.floor(remaining.access.x)
    ] = 2;
    if (remaining.eventCourtyard) refreshCourtyardOccupancy(context, remaining);
  }
  markRuinOccupancy(context);
  bumpBuildRevision(context.options.world, null);
  // Its people may be left on land without any storage: they go home over the next steps.
  markStrandedScan(context);
  context.naval?.shippingDemandChanged?.(uid);
};
/** The home refuses demolition under its own name: the headquarters, a colony harbour, or a founding anchor. */
const homeDemolitionReason = (building: Pick<SettlementBuilding, "foundingAnchor" | "typeId">) => {
  if (isFoundingAnchor(building))
    return "This founding harbour is essential to the settlement and cannot be demolished";
  if (isOwnHeadquarters(building)) return "The headquarters is your settlement's home and cannot be demolished";
  return "The harbour is this island's home and cannot be demolished";
};
export const settlementDemolitionReason = (context: SettlementContext, building: SettlementBuilding) => {
  if (isDemolitionProtected(building)) return homeDemolitionReason(building);
  if (context.relief?.protectsBuilding(building.uid))
    return "This building holds paid relief aid; wait for the collection ship to depart";
  if (context.naval?.rewardShipBound?.(building.uid))
    return "A reward ship is sailing to this harbour; wait until it has unloaded";
  return storageDemolitionReason(context, building);
};
export const demolishSettlementBuilding = (context: SettlementContext, uid: number) => {
  const building = context.buildings.find((b) => b.uid === uid);
  if (!building) return { ok: false, reason: "Building no longer exists" };
  const reason = settlementDemolitionReason(context, building);
  if (reason) return { ok: false, reason };
  if (context.script) emitBuildingDestroyed(context, building, "demolished");
  removeSettlementBuilding(context, building);
  context.options.onBuildingDemolished?.(building);
  return { ok: true };
};
