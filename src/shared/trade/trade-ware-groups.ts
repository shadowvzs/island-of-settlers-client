import { offerEntries, wareEntries, weaponToolKeys } from "@shared/catalog";
import { BUILDING_MATERIAL_ORDER } from "@shared/catalog/balance";

import { TRADABLE_WARES } from "./trade-values";

/** Category dropdown of the trade office (shares the gem shop's tool and military ware lists). */
export type TradeWareGroupId = "building" | "food" | "foodChain" | "raw" | "tools" | "weapons";
export interface TradeWareGroup { id: TradeWareGroupId; wares: readonly string[] }

/** Wares of the gem shop bundles in one shop tab (catalog `offer.<tab>` category), in shop order. */
const shopTabWares = (tab: string) => offerEntries().filter(entry => entry.category === `offer.${tab}`)
  .map(entry => entry.offer.ware);
/** Tradable wares of catalog ware categories, in catalog order. */
const categoryWares = (...categories: readonly string[]) => wareEntries()
  .filter(entry => categories.includes(entry.category) && TRADABLE_WARES.includes(entry.key)).map(entry => entry.key);
/** Dual-use tools (catalog tags `tool` + `weapon`) are sold as military bundles but listed as tools. */
const WEAPON_TOOLS = weaponToolKeys();
const WEAPON_WARES = shopTabWares("military")
  .filter(ware => !WEAPON_TOOLS.includes(ware) && ware !== "beer");
const TOOL_WARES = [...shopTabWares("tools"), ...WEAPON_TOOLS];
/** Owner 2026-11-11: the food group is the edible food and the drinks (beer and the nation drinks). */
const FOOD_WARES = categoryWares("ware.food", "ware.drink");
/** Food-chain ingredients (grain, flour, water, pig, raw drink ingredients). */
const FOOD_CHAIN_WARES = categoryWares("ware.foodChain");
const grouped = new Set([...BUILDING_MATERIAL_ORDER, ...TOOL_WARES, ...WEAPON_WARES, ...FOOD_WARES,
  ...FOOD_CHAIN_WARES]);

export const TRADE_WARE_GROUPS: readonly TradeWareGroup[] = [
  { id: "building", wares: BUILDING_MATERIAL_ORDER },
  { id: "food", wares: FOOD_WARES },
  { id: "foodChain", wares: FOOD_CHAIN_WARES },
  { id: "tools", wares: TOOL_WARES },
  { id: "weapons", wares: WEAPON_WARES },
  { id: "raw", wares: TRADABLE_WARES.filter(ware => !grouped.has(ware)) }
];
