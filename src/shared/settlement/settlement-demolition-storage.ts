import { DMath } from "../math/deterministic-math";
import { catapultGroundGoods } from "./catapult-ammo-kinds";
import { clearCatapultGround } from "./military-catapult-resupply";
import { recoverFisherBoat } from "./fisher-boat-release";
import { addGood, STORAGE_IDS } from "./production-rules";
import { releaseDeliveryClaim } from "./settlement-carrier-claims";
import { closeLoading } from "./settlement-handcart-ledger";
import { economyOwnerOf, ownerOf } from "./settlement-ownership";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import {
  creditStorageAt, isSharedStorageWare, storagePoolAt, storagePoolById, strandLocalEquipment
} from "./shared-storage";
import { stockLandAt } from "./stock-lands";

/** Completed storages on the removed building's land that belong to its economy (`economyOwnerOf`). */
export const localDemolitionStores = (context: SettlementContext, removed: SettlementBuilding) => {
  const land = stockLandAt(context, removed.access), owner = economyOwnerOf(context, removed);
  return context.buildings.filter(building => building !== removed && building.construction === 1 &&
    ownerOf(building) === owner && STORAGE_IDS.has(building.typeId) && land >= 0 &&
    stockLandAt(context, building.access) === land).sort((a, b) =>
    DMath.hypot(a.access.x - removed.access.x, a.access.z - removed.access.z) -
      DMath.hypot(b.access.x - removed.access.x, b.access.z - removed.access.z) || a.uid - b.uid);
};

/** A source is still present here: unpaid hands/cart beds refund their original physical pool. */
export const releaseDemolishedSourcePrepayments = (context: SettlementContext, removed: SettlementBuilding) => {
  const released = new Set<number>();
  if (!storagePoolById(context, removed.storagePoolId)) return released;
  for (const actor of context.actors) {
    const delivery = actor.delivery;
    if (delivery?.source === removed.uid && !delivery.reserved && !actor.ware &&
      isSharedStorageWare(delivery.ware)) {
      releaseDeliveryClaim(context, actor); released.add(actor.uid);
    }
    const trip = actor.handcart?.trip;
    if (trip?.source === removed.uid && trip.prepaid > 0 && isSharedStorageWare(trip.ware)) closeLoading(context, trip);
  }
  return released;
};

/** Pooled balances survive an access loss; only this building's genuinely local goods are salvaged. */
export const recoverDemolitionStock = (
  context: SettlementContext, removed: SettlementBuilding, local?: SettlementBuilding
) => {
  // Enemy ammunition has no player loot grant. It remains with the ruined site until removal;
  // a surviving hostile carrier keeps its separately owned hand cargo.
  if (removed.enemyCatapultVariant !== undefined && ownerOf(removed) > 0) return;
  recoverFisherBoat(removed);
  const ownPool = storagePoolById(context, removed.storagePoolId);
  const pool = ownPool ?? storagePoolAt(context, removed.access);
  const activeBoats = Math.min(removed.inventory.boat ?? 0, context.naval?.localBoatClaims?.(removed.uid) ?? 0);
  if (local && activeBoats > 0) {
    const idleBoats = (removed.inventory.boat ?? 0) - activeBoats;
    if (idleBoats) removed.inventory.boat = idleBoats;
    else delete removed.inventory.boat;
  }
  if (!local) {
    for (const [ware, amount] of Object.entries(removed.output)) if (!isSharedStorageWare(ware) && amount > 0) {
      addGood(removed.inventory, ware, amount); delete removed.output[ware];
    }
    strandLocalEquipment(context, removed, activeBoats);
  }
  const groundAmmo = catapultGroundGoods(removed.catapultSupply);
  if (removed.catapultSupply) clearCatapultGround(removed.catapultSupply);
  for (const goods of [removed.inventory, removed.input, removed.output,
    removed.workshopUpgrade?.reserved ?? {}, groundAmmo])
    for (const [ware, amount] of Object.entries(goods)) {
      if (amount <= 0 || (goods === removed.inventory && ownPool && isSharedStorageWare(ware))) continue;
      if (isSharedStorageWare(ware)) {
        if (pool) addGood(pool.available, ware, amount);
        else if (!creditStorageAt(context, removed.access, ware, amount) && local) addGood(local.inventory, ware, amount);
      } else if (local) addGood(local.inventory, ware, amount);
    }
};

/** Losing the last access voluntarily must not strand free stock, commitments or finite equipment. */
export const storageDemolitionReason = (context: SettlementContext, building: SettlementBuilding) => {
  if (localDemolitionStores(context, building).length) return undefined;
  const equipment = (building.handcarts ?? 0) > 0 || Object.entries(building.inventory).some(([ware, count]) =>
    !isSharedStorageWare(ware) && count > 0) || Object.entries(building.output).some(([ware, count]) =>
    !isSharedStorageWare(ware) && count > 0);
  if (equipment) return "Move the local boats and hand carts before removing this last storage access";
  const pool = storagePoolById(context, building.storagePoolId) ??
    (STORAGE_IDS.has(building.typeId) ? storagePoolAt(context, building.access) : undefined);
  if (STORAGE_IDS.has(building.typeId) && building.construction === 1 &&
    Object.entries(building.inventory).some(([ware, count]) => isSharedStorageWare(ware) && count > 0))
    return "Empty the local storage pool and finish its transport commitments before removing its last access";
  if (!pool) return undefined;
  if (Object.values(pool.available).some(count => count > 0) ||
    Object.values(building.incoming).some(count => count > 0) ||
    Object.values(building.shipReserve ?? {}).some(count => count > 0) || (building.idleSettlers ?? 0) > 0 ||
    context.actors.some(actor => actor.home === building.uid || actor.handcart?.owner === building.uid ||
      actor.delivery?.source === building.uid || actor.delivery?.destination === building.uid ||
      actor.nextDelivery?.source === building.uid || actor.nextDelivery?.destination === building.uid ||
      actor.handcart?.trip?.source === building.uid || actor.handcart?.trip?.destination === building.uid))
    return "Empty the local storage pool and finish its transport commitments before removing its last access";
  return undefined;
};
