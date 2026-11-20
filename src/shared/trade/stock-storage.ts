import { addGood, STORAGE_IDS } from "../settlement/production-rules";
import { isHomeBuilding, isOwnBuilding, isOwnHeadquarters } from "../settlement/settlement-home";
import type { Goods, SettlementBuilding } from "../settlement/settlement-types";
import { isSharedStorageWare } from "../settlement/shared-storage";
import type { StockDirection } from "./stock-move";

/** Live storage views only: the API has already committed this delta at the returned revision. */
export type StockStorageBuilding = Pick<SettlementBuilding, "construction" | "inventory" | "typeId"> &
  Partial<Pick<SettlementBuilding, "colonyHome" | "militaryFaction" | "storagePoolId">>;

const homeStorage = (buildings: readonly StockStorageBuilding[]) => {
  const complete = buildings.filter(building => building.construction === 1 &&
    STORAGE_IDS.has(building.typeId) && isOwnBuilding(building));
  return complete.find(isOwnHeadquarters) ?? complete.find(isHomeBuilding);
};
const totals = (home: StockStorageBuilding): Goods => Object.fromEntries(Object.entries(home.inventory)
  .filter(([ware, count]) => isSharedStorageWare(ware) && count > 0)
  .sort(([a], [b]) => a.localeCompare(b)));
const validGoods = (goods: Readonly<Goods>) => Object.entries(goods).every(([ware, count]) =>
  isSharedStorageWare(ware) && Number.isSafeInteger(count) && count > 0);

/** Apply a server move once to the same actual home pool; equipment and overseas pools remain local. */
export const applyStockStorageMove = (
  buildings: readonly StockStorageBuilding[],
  move: { direction: StockDirection; goods: Readonly<Goods> }
): { ok: true; storage: Goods } | { ok: false; reason: string } => {
  if (!validGoods(move.goods)) return { ok: false, reason: "Stock amounts must be positive safe integers" };
  const home = homeStorage(buildings);
  if (!home) return { ok: false, reason: "The island has no completed home storage for stock moves" };
  for (const [ware, count] of Object.entries(move.goods)) {
    const held = home.inventory[ware] ?? 0;
    if (!Number.isSafeInteger(held) || held < 0)
      return { ok: false, reason: "The island storage has invalid stock" };
    if (move.direction === "deposit" && held < count)
      return { ok: false, reason: `The island storage has only ${held} ${ware}; ${count} were deposited` };
    if (move.direction === "withdraw" && !Number.isSafeInteger(held + count))
      return { ok: false, reason: "The island storage is too large" };
  }
  for (const [ware, count] of Object.entries(move.goods))
    addGood(home.inventory, ware, move.direction === "deposit" ? -count : count);
  return { ok: true, storage: totals(home) };
};
