import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { ownerOf, PLAYER_FACTION } from "../../shared/settlement/settlement-ownership";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { isSharedStorageWare } from "../../shared/settlement/shared-storage";
import { islandStorageCapacity } from "../../shared/settlement/storage-capacity";

/**
 * Serialized depot inventories contain local equipment; count shared and unpaid pickup custody once. `owner`: the
 * economy whose pools are counted (a computer economy's own storages, EAI5b).
 */
export const offlineStorageCapacity = (
  save: GameSaveV1, slots: readonly SettlementBuilding[], talentBonus = 0, owner = PLAYER_FACTION
) => {
  const pools = new Set(slots.map(slot => slot.storagePoolId));
  const members = save.settlement.buildings.filter(building => building.storagePoolId !== undefined &&
    pools.has(building.storagePoolId) && building.construction === 1 && ownerOf(building) === owner);
  const snapshot = islandStorageCapacity(members, talentBonus, owner);
  const sites = new Set(members.map(slot => slot.uid));
  const add = (ware: string, amount: number) => {
    if (isSharedStorageWare(ware)) snapshot.stored[ware] = (snapshot.stored[ware] ?? 0) + amount;
  };
  for (const pool of save.settlement.storagePools.pools) if (pools.has(pool.id))
    for (const [ware, amount] of Object.entries(pool.available)) add(ware, amount);
  for (const actor of save.settlement.actors) {
    const delivery = actor.delivery;
    if (delivery && sites.has(delivery.source) && !delivery.reserved && !actor.ware)
      add(delivery.ware, actor.wareUnits ?? 1);
    const trip = actor.handcart?.trip;
    if (trip && sites.has(trip.source)) add(trip.ware, trip.prepaid);
  }
  return snapshot;
};
