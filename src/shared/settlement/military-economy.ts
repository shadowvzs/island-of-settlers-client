import type { Goods } from "./settlement-types";

export const canPayMilitaryCost = (stock: Goods, cost: Goods) =>
  Object.entries(cost).every(([ware, count]) => (stock[ware] ?? 0) >= count);
export const payMilitaryCost = (stock: Goods, cost: Goods) => {
  if (!canPayMilitaryCost(stock, cost)) return false;
  for (const [ware, count] of Object.entries(cost)) stock[ware] = (stock[ware] ?? 0) - count;
  return true;
};
