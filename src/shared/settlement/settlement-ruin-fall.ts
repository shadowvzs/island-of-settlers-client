import { ruinSalvage, takeDestroyedSiteSalvage } from "./building-destruction";
import { destroyedStorageShare, loseDestroyedStorageStock } from "./destroyed-storage-loss";
import { removeSettlementBuilding } from "./settlement-demolition";
import { buildingNation } from "./settlement-nation";
import { hasEconomy, ownerOf } from "./settlement-ownership";
import { recordRuin } from "./settlement-ruins";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Whether a fallen building leaves a ruin for the clearing job: its owner runs an economy (the player always;
 * owner Q-BD7: the player's military buildings too). Otherwise it crumbles after the fort ruin time (B6).
 */
export const leavesRuin = (context: Pick<SettlementContext, "options">, site: SettlementBuilding) =>
  hasEconomy(context, ownerOf(site));

/**
 * A fallen building leaves (BD1 removal, BD2 ruin): its commander, Tavern batch, voyages and garrison are
 * released and it is removed like a demolished building (people, workplaces, reservations, stock). An owner
 * with an economy keeps a ruin holding the salvage, and a destroyed storage loses part of its pool after its
 * reserves and promises were released (B8f). Without an economy a construction site returns its salvage share
 * like demolished stock (BD1).
 */
export const removeFallenBuilding = (context: SettlementContext, site: SettlementBuilding) => {
  context.commander?.lodgeDestroyed(site.uid);
  context.tavern?.destroyBuilding?.(site.uid);
  context.naval?.removeBuilding?.(site.uid);
  context.military?.removeBuilding?.(site.uid);
  if (!leavesRuin(context, site)) {
    if (site.construction < 1) site.input = takeDestroyedSiteSalvage(site);
    removeSettlementBuilding(context, site, true);
    context.options.onBuildingDemolished?.(site);
    return;
  }
  const share = destroyedStorageShare(context, site);
  recordRuin(context, site, ruinSalvage(site, buildingNation(context, site)));
  removeSettlementBuilding(context, site, true);
  if (share) loseDestroyedStorageStock(context, share);
  context.options.onBuildingDemolished?.(site);
};
