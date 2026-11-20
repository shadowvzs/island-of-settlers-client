import { STORAGE_IDS } from "./production-rules";
import { ownerOf } from "./settlement-ownership";
import { createActor } from "./settlement-paths";
import { availableIdleSettlers, takeIdleSettler } from "./settlement-population";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { noteSettlerDemand } from "./settler-relocation";

/**
 * Settlers are born in the headquarters, not in harbours (POP-01), so passengers, colony crews and
 * scouts leave from any friendly storage whose idle settlers can walk to the harbour: the harbour first.
 */
const helperStorages = (context: SettlementContext, harbour: SettlementBuilding) => {
  const others: { length: number; storage: SettlementBuilding }[] = [];
  for (const storage of context.buildings) {
    if (storage === harbour || !STORAGE_IDS.has(storage.typeId) || ownerOf(storage) > 0 ||
      availableIdleSettlers(context, storage) < 1) continue;
    const route = context.options.roads.route(storage.access, harbour.access);
    if (route) others.push({ length: route.length, storage });
  }
  // Nearest first (POP-03), so helpers never cross the island when a closer storage has someone.
  others.sort((a, b) => a.length - b.length || a.storage.uid - b.storage.uid);
  const storages = others.map(entry => entry.storage);
  return availableIdleSettlers(context, harbour) > 0 ? [harbour, ...storages] : storages;
};

/** Idle settlers that could walk to the harbour now. */
export const harbourHelperSupply = (context: SettlementContext, harbour: SettlementBuilding) => {
  let supply = 0;
  for (const storage of helperStorages(context, harbour)) supply += availableIdleSettlers(context, storage);
  return supply;
};

/** Takes `count` idle settlers (the caller checked the supply); each is homed at the storage it left. */
export const createHarbourHelpers = (context: SettlementContext, harbour: SettlementBuilding, count: number) => {
  const helpers: SettlementActor[] = [];
  if (count > availableIdleSettlers(context, harbour)) noteSettlerDemand(context, harbour);
  for (const storage of helperStorages(context, harbour))
    while (helpers.length < count && availableIdleSettlers(context, storage) > 0)
      helpers.push(createActor(context, "Settler", storage.uid));
  return helpers;
};

/** `count` idle settlers leave the island for good (the caller checked the supply); returns how many left. */
export const takeHarbourHelpers = (context: SettlementContext, harbour: SettlementBuilding, count: number) => {
  let taken = 0;
  for (const storage of helperStorages(context, harbour))
    while (taken < count && takeIdleSettler(context, storage)) taken++;
  return taken;
};
