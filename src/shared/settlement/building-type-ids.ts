import { BuildingType } from "../../../../island-of-settlers-shared/src/building-types";

export { BuildingType };

/**
 * Building type ids the client special-cases by name. Saves store these ids: never renumber them.
 * The canonical enum lives in the top-level shared package so the API can validate the same ids.
 */
export const HEADQUARTERS_TYPE_ID = BuildingType.Headquarters;
/** The Vineyard: each nation's drink producer (the Nubian palm grove). */
export const DRINK_PRODUCER_TYPE_ID = BuildingType.Vineyard;
/** The Winery: each nation's drink maker. */
export const DRINK_MAKER_TYPE_ID = BuildingType.Winery;
export const WOODCUTTER_TYPE_ID = BuildingType.Woodcutter;
/** The Quarry (stonemason). */
export const QUARRY_TYPE_ID = BuildingType.Quarry;
export const FORESTER_TYPE_ID = BuildingType.Forester;
export const ARMORY_TYPE_ID = BuildingType.Armory;
export const MILL_TYPE_ID = BuildingType.Mill;
/** The Sawmill; it also crafts carts in its hand-cart production mode (owner, 2026-10-13). */
export const SAWMILL_TYPE_ID = BuildingType.Sawmill;
export const SHIPYARD_TYPE_ID = BuildingType.Shipyard;
export const FARM_TYPE_ID = BuildingType.Farm;
/** The Flax Farm: plots and hand-pulls flax for the Weaver. */
export const FLAX_FARM_TYPE_ID = BuildingType.FlaxFarm;
/** The Weaver: consumes flax and produces sail-ready cloth. */
export const WEAVER_TYPE_ID = BuildingType.Weaver;
/** The Commander's Lodge: home, recruitment and resting place of the player's commander. */
export const COMMANDER_LODGE_TYPE_ID = BuildingType.CommandersLodge;
export const HARBOUR_TYPE_ID = BuildingType.Harbour;
/** The Fishery: rod fishing from the shore, or boat fishing with a net (FISHER-BOAT). */
export const FISHERY_TYPE_ID = BuildingType.Fishery;
export const STOREHOUSE_TYPE_ID = BuildingType.Storehouse;
export const TAVERN_TYPE_ID = BuildingType.MilitaryAcademy;
