import { MAX_TAVERN_ORDER } from "../balance/military";
import { TAVERN_TYPE_ID } from "./building-type-ids";
import type { MilitaryTroopType } from "./military-combat-rules";
import type { SettlementContext } from "./settlement-types";
import { isTavernTroop } from "./tavern-rules";

export interface TavernOrder { count: number; type: MilitaryTroopType }
/** The recruit being prepared: wares arrive ("collect"), the settler walks in, then is equipped. */
export interface TavernBatch {
  type: MilitaryTroopType;
  stage: "collect" | "settler" | "train";
  /** Seconds of equipping left inside the Tavern. */
  timer: number;
  recruit?: number;
}
export interface SettlementTavernSave {
  orders: [number, TavernOrder[]][];
  batches: [number, TavernBatch][];
}

/** Optional save section; worlds saved before the Tavern simply start without orders. */
export const createTavernState = () => {
  const orders = new Map<number, TavernOrder[]>();
  const batches = new Map<number, TavernBatch>();
  return {
    batches, orders,
    save: (): SettlementTavernSave => ({
      batches: [...batches].map(([uid, batch]) => [uid, { ...batch }]),
      orders: [...orders].map(([uid, queue]) => [uid, queue.map(order => ({ ...order }))])
    }),
    restore: (saved?: SettlementTavernSave) => {
      orders.clear(); batches.clear();
      if (!saved) return;
      for (const [uid, queue] of saved.orders) orders.set(uid, queue.map(order => ({ ...order })));
      for (const [uid, batch] of saved.batches) batches.set(uid, { ...batch });
    }
  };
};

const isTavern = (uid: unknown, buildings: SettlementContext["buildings"]) =>
  buildings.some(building => building.uid === uid && building.typeId === TAVERN_TYPE_ID);
/** Orders and batches name an ordinary troop type (cavalry is retired). */
const validOrder = (order: unknown) => {
  const entry = order as TavernOrder | null;
  return Boolean(entry) && isTavernTroop(entry!.type) && Number.isSafeInteger(entry!.count) &&
    entry!.count >= 1 && entry!.count <= MAX_TAVERN_ORDER;
};
const validBatch = (batch: unknown, actors: SettlementContext["actors"]) => {
  const entry = batch as TavernBatch | null;
  if (!entry || !isTavernTroop(entry.type) || !["collect", "settler", "train"].includes(entry.stage) ||
    !Number.isFinite(entry.timer)) return false;
  const recruit = actors.find(actor => actor.uid === entry.recruit);
  return entry.recruit === undefined || recruit?.job === "Recruit";
};

export const validateTavernSave = (
  value: unknown, buildings: SettlementContext["buildings"], actors: SettlementContext["actors"]
): string | null => {
  if (value === undefined) return null;
  const saved = value as SettlementTavernSave | null;
  if (!saved || !Array.isArray(saved.orders) || !Array.isArray(saved.batches)) return "Invalid tavern state";
  for (const entry of saved.orders)
    if (!Array.isArray(entry) || !isTavern(entry[0], buildings) || !Array.isArray(entry[1]) ||
      !entry[1].every(validOrder))
      return "Invalid tavern orders";
  for (const entry of saved.batches)
    if (!Array.isArray(entry) || !isTavern(entry[0], buildings) || !validBatch(entry[1], actors))
      return "Invalid tavern recruit";
  return null;
};
