import { ORE, type Ore } from "../../shared/world/world-data";

/** The same rendered resource images used in inventory, mine buttons and survey signs. */
export const ORE_ICON_SOURCES: Partial<Record<Ore, string>> = {
  [ORE.coal]: new URL("../../../assets/ware-icons/coal.png", import.meta.url).href,
  [ORE.gold]: new URL("../../../assets/ware-icons/goldOre.png", import.meta.url).href,
  [ORE.granite]: new URL("../../../assets/ware-icons/stone.png", import.meta.url).href,
  [ORE.iron]: new URL("../../../assets/ware-icons/ironOre.png", import.meta.url).href
};

const MINE_ORES: Readonly<Record<number, Ore>> = {
  10: ORE.granite, 11: ORE.coal, 12: ORE.iron, 13: ORE.gold
};

export const mineOreIconSource = (type: number) => ORE_ICON_SOURCES[MINE_ORES[type]!];
