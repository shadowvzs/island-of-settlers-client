import type { AbandonedHandcart, SettlementBuilding } from "./settlement-types";

/** Saved abandoned carts: unique ids, finite poses, an existing owner, a positive load with its ware. */
export const abandonedHandcartsError = (value: unknown, buildings: readonly SettlementBuilding[]) => {
  if (value === undefined) return false;
  if (!Array.isArray(value) || !value.length) return true;
  const ids = new Set<number>(), owners = new Set(buildings.map(building => building.uid));
  for (const cart of value as AbandonedHandcart[]) {
    if (!cart || !Number.isSafeInteger(cart.id) || ids.has(cart.id) || !owners.has(cart.owner) ||
      ![cart.x, cart.z, cart.yaw].every(Number.isFinite)) return true;
    const loaded = cart.cargo !== undefined || cart.ware !== undefined;
    if (loaded && (!Number.isSafeInteger(cart.cargo) || cart.cargo! <= 0 || typeof cart.ware !== "string"))
      return true;
    ids.add(cart.id);
  }
  return false;
};
