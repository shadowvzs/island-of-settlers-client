import { MILITARY_RECRUIT_COSTS } from "../balance/military";
import {
  isOrdinaryTroopType, type MilitaryTroopType, ORDINARY_TROOP_TYPES, type OrdinaryTroopType
} from "./military-combat-rules";
import type { Goods } from "./settlement-types";

/** Ordinary soldiers the Tavern may still recruit; ordinary cavalry is retired (HORSE-RETIREMENT-01). */
export const TAVERN_TROOPS: readonly OrdinaryTroopType[] = ORDINARY_TROOP_TYPES;

/**
 * Owner recipes (2026-10-12): every soldier needs a settler, armour and beer besides its weapons.
 * The settler is the last carrier and is not a ware.
 */
const withArmour = (type: OrdinaryTroopType): Readonly<Goods> => Object.freeze({ ...MILITARY_RECRUIT_COSTS[type], armor: 1 });
export const TAVERN_RECIPES: Readonly<Record<OrdinaryTroopType, Readonly<Goods>>> = Object.freeze({
  archer: withArmour("archer"), heavy: withArmour("heavy"), shield: withArmour("shield")
});
/** The wares a batch has collected; only ordinary troops are recruited. */
export const tavernCarriedWares = (type: MilitaryTroopType): Goods =>
  isOrdinaryTroopType(type) ? { ...TAVERN_RECIPES[type] } : {};

export const isTavernTroop = (value: unknown): value is OrdinaryTroopType => isOrdinaryTroopType(value);

/** What the road-connected storages hold for recruiting: wares and idle settlers. */
export interface TavernSupplies { goods: Readonly<Goods>; settlers: number }

/**
 * Ingredients still missing to recruit `count` troops of a type, in recipe order; an empty list
 * means the order can be accepted. "settler" stands for the free settler each soldier needs.
 */
export const missingTavernIngredients = (type: OrdinaryTroopType, count: number, supplies: TavernSupplies) => {
  const missing: { count: number; ware: string }[] = [];
  if (supplies.settlers < count) missing.push({ count: count - supplies.settlers, ware: "settler" });
  for (const [ware, each] of Object.entries(TAVERN_RECIPES[type])) {
    const shortfall = each * count - (supplies.goods[ware] ?? 0);
    if (shortfall > 0) missing.push({ count: shortfall, ware });
  }
  return missing;
};
