import {
  isPlayerItemAvailableForPurchase, playerItemDefinition, type PlayerItemId
} from "../../../../island-of-settlers-shared/src/player-inventory";
import type { PlayerProgress } from "./player-progress";

/** Shared local personal-item rules mirror the server transaction; each definition owns its own limit. */
export const purchasePersonalItem = (progress:PlayerProgress,item:PlayerItemId,ownedOutsideInventory = 0) => {
  const definition=playerItemDefinition(item);
  if (!definition || !isPlayerItemAvailableForPurchase(item)) return { ok: false as const, reason: "This item is not available for purchase" };
  if (!Number.isSafeInteger(ownedOutsideInventory) || ownedOutsideInventory < 0 ||
      (progress.inventory?.[item] ?? 0) + ownedOutsideInventory >= definition.maxHeld)
    return { ok:false as const,reason:"You already own the maximum number of this item" };
  if (progress.gems < definition.price)
    return { ok:false as const,reason:`Needs ${definition.price-progress.gems} more gems` };
  return { ok:true as const,progress:{ ...progress,gems:progress.gems-definition.price,
    inventory:{ ...progress.inventory,[item]:(progress.inventory?.[item] ?? 0)+1 } } };
};

/** A successful domain action consumes one unit. A refused action must never call this helper. */
export const consumePersonalItem = (progress:PlayerProgress,item:PlayerItemId) => {
  const held=progress.inventory?.[item] ?? 0;
  if (held < 1) return null;
  const inventory={ ...progress.inventory };
  if (held === 1) delete inventory[item];
  else inventory[item]=held-1;
  return { ...progress,inventory };
};
