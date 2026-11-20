import { catapultAmmoChoice, type CatapultAmmoKind, isCatapultAmmoKind } from "./catapult-ammo-kinds";
import { nextTransferReservations } from "./settlement-land-transport-claims";
import { type EconomyContext, economyOwnerOf } from "./settlement-ownership";
import type { SettlementContext } from "./settlement-types";
import { isSharedStorageWare } from "./shared-storage";

type TransferQueue = Pick<SettlementContext, "nextTransferId" | "transfers"> & {
  actors?: SettlementContext["actors"];
  military?: Pick<NonNullable<SettlementContext["military"]>, "buildingStanding">;
  options?: EconomyContext["options"];
  buildings: readonly {
    catapultAmmo?: CatapultAmmoKind; construction?: number; militaryFaction?: number;
    required?: Readonly<Record<string, number>>; storagePoolId?: number; typeId?: number; uid: number;
  }[];
};

/** Stable manual-order identity keeps two identical requests distinct through a future-job claim. */
export const queueWareTransfer = (context: TransferQueue, source: number, destination: number,
  ware: string, count = 1) => {
  if (!context.buildings.some(building => building.uid === source) ||
    !context.buildings.some(building => building.uid === destination) || !Number.isFinite(count) || count < 1 ||
    source === destination)
    return false;
  const receiver = context.buildings.find(building => building.uid === destination)!;
  const sender = context.buildings.find(building => building.uid === source)!;
  // An order never crosses economies (EAI1a D9): a carrier serves only its own faction.
  if (economyOwnerOf(context, sender) !== economyOwnerOf(context, receiver)) return false;
  if (receiver.typeId === 16 && receiver.construction === 1 &&
    context.military?.buildingStanding?.(receiver.uid) === false) return false;
  if (receiver.typeId === 16 && ware !== catapultAmmoChoice(receiver) &&
    (receiver.construction === 1 || !(receiver.required?.[ware] ?? 0))) return false;
  const sourcePool = sender.storagePoolId;
  const destinationPool = receiver.storagePoolId;
  if (isSharedStorageWare(ware) && sourcePool !== undefined && sourcePool === destinationPool) return false;
  let id = context.nextTransferId ?? 0;
  for (const order of context.transfers) if (order.id !== undefined) id = Math.max(id, order.id + 1);
  if (!Number.isSafeInteger(id) || id < 0 || id >= Number.MAX_SAFE_INTEGER) return false;
  context.transfers.push({ id, source, destination, ware, count: Math.floor(count) });
  context.nextTransferId = id + 1;
  return true;
};

/**
 * A kind switch cancels only queued, not-yet-dispatched manual transfers of another ammo kind.
 * Claimed units remain in their order and arrive as their original kind.
 */
export const cancelQueuedAmmoTransfers = (
  context: TransferQueue, destination: number, kind: CatapultAmmoKind
) => {
  for (const order of context.transfers.slice()) {
    if (order.destination !== destination || !isCatapultAmmoKind(order.ware) || order.ware === kind) continue;
    const reserved = order.id === undefined ? 0 : nextTransferReservations(context.actors ?? [], order.id);
    const queued = order.count - reserved;
    if (queued <= 0) continue;
    if (reserved <= 0) context.transfers = context.transfers.filter(entry => entry !== order);
    else order.count -= queued;
  }
};
