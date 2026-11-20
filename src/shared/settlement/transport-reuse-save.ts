import { isForbiddenKey } from "../../../../island-of-settlers-shared/src/validation/index";
import { isSaveInteger, isSaveObject } from "./save-validation";
import type { SettlementNextDelivery } from "./settlement-types";

const CLAIM_KEYS = new Set(["source", "destination", "ware", "units", "mode", "capacity", "upgrade",
  "sourceInput", "transferId", "leaseStartedTick", "leaseDeadlineTick"]);

const validClaim = (next: unknown, ids: ReadonlySet<number>, nowTick: number): next is SettlementNextDelivery => {
  if (!isSaveObject(next) || Object.keys(next).some(key => !CLAIM_KEYS.has(key)) ||
    !isSaveInteger(next.source) || !ids.has(next.source) || !isSaveInteger(next.destination) ||
    !ids.has(next.destination) || next.source === next.destination || typeof next.ware !== "string" ||
    !next.ware || next.ware.length > 64 || isForbiddenKey(next.ware) ||
    !isSaveInteger(next.units, 1) || !["carrier", "handcart"].includes(next.mode as string) ||
    !isSaveInteger(next.leaseStartedTick) || !isSaveInteger(next.leaseDeadlineTick, next.leaseStartedTick) ||
    next.leaseStartedTick > nowTick || next.leaseDeadlineTick === next.leaseStartedTick ||
    (next.transferId !== undefined && !isSaveInteger(next.transferId)) ||
    (next.upgrade !== undefined && next.upgrade !== true) ||
    (next.sourceInput !== undefined && next.sourceInput !== true) || (next.upgrade && next.sourceInput))
    return false;
  return true;
};

const availableClaimOwner = (actor: Record<string, unknown>) => actor.job === "Carrier" &&
  actor.navalOrder === undefined && actor.demolitionReturning !== true && actor.navigationReturnCargo !== true;

/** A next delivery is only an unload-linked job preference, never a second cargo or payment. */
export const validateNextDelivery = (actor: Record<string, unknown>, ids: ReadonlySet<number>, nowTick: number) => {
  if (actor.nextDelivery === undefined) return null;
  const next = actor.nextDelivery;
  if (!availableClaimOwner(actor) || !validClaim(next, ids, nowTick)) return "Invalid next transport claim";
  const cart = isSaveObject(actor.handcart) ? actor.handcart : undefined;
  const trip = cart && isSaveObject(cart.trip) ? cart.trip : undefined;
  const delivery = isSaveObject(actor.delivery) ? actor.delivery : undefined;
  if (next.mode === "handcart") {
    if (!trip || trip.destination !== next.source || !isSaveInteger(next.capacity, 1) || next.units > next.capacity)
      return "Invalid next handcart claim";
  } else if (cart || !delivery || delivery.destination !== next.source || next.units !== 1 ||
    (next.capacity !== undefined && next.capacity !== 1)) return "Invalid next carrier claim";
  return null;
};

/** Manual requests keep unique identities so two identical queued requests cannot share a next-job claim. */
export const validateTransferOrderClaims = (orders: readonly unknown[], actors: readonly unknown[], nextId: unknown) => {
  if (nextId !== undefined && !isSaveInteger(nextId)) return "Invalid next transfer identity";
  const byId = new Map<number, Record<string, unknown>>();
  for (const order of orders) {
    if (!isSaveObject(order) || order.id === undefined) continue;
    if (!isSaveInteger(order.id) || byId.has(order.id) ||
      (typeof nextId === "number" && order.id >= nextId)) return "Invalid transfer identity";
    byId.set(order.id, order);
  }
  const claimed = new Map<number, number>();
  for (const actor of actors) {
    if (!isSaveObject(actor) || !isSaveObject(actor.nextDelivery) || actor.nextDelivery.transferId === undefined) continue;
    const next = actor.nextDelivery, id = next.transferId;
    if (!isSaveInteger(id) || !isSaveInteger(next.units, 1)) return "Invalid next transfer claim";
    const order = byId.get(id);
    if (!order || order.source !== next.source || order.destination !== next.destination || order.ware !== next.ware ||
      next.upgrade || next.sourceInput) return "Invalid next transfer claim";
    const amount = (claimed.get(id) ?? 0) + next.units;
    if (!Number.isSafeInteger(amount) || typeof order.count !== "number" || amount > order.count)
      return "Duplicate next transfer claim";
    claimed.set(id, amount);
  }
  return null;
};
