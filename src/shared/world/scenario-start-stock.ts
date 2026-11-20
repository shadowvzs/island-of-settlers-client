import { starterStockForNation } from "@shared/catalog/balance";

import type { Goods } from "../../../../island-of-settlers-shared/src/goods";

/**
 * A map file's start stock (`MapScenario.stock`, GS-MAP): an empty or absent stock means the nation's catalog
 * default (`starterStockForNation`, e.g. the Indigenous 48 cloth), so a map follows its nation and catalog changes
 * unless the author wrote real amounts. Only positive amounts count as authored.
 */
export const hasAuthoredStock = (stock: Readonly<Record<string, number>> | undefined) =>
  stock !== undefined && Object.values(stock).some(amount => amount > 0);

/** The wares a fresh start of this map puts into the home building: the authored stock or the nation default. */
export const scenarioStartStock = (stock: Readonly<Record<string, number>> | undefined, nation: string): Goods => {
  if (!hasAuthoredStock(stock)) return starterStockForNation(nation);
  return { ...stock };
};
