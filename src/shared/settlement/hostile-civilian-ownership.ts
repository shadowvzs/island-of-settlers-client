import { ownerOf } from "./settlement-ownership";
import type { SettlementActor, SettlementBuilding } from "./settlement-types";

/** An economy faction's person works at, or lives in, a building of that faction. */
const belongsToEconomy = (
  actor: SettlementActor, sites: ReadonlyMap<number, SettlementBuilding>, economyFaction: (faction: number) => boolean
) => {
  const faction = actor.hostileCivilianFaction!;
  if (!economyFaction(faction)) return false;
  const ownedBy = (site: SettlementBuilding | undefined) => site !== undefined && ownerOf(site) === faction;
  return ownedBy(sites.get(actor.home)) || ownedBy(sites.get(actor.building));
};

/**
 * The saved civilian is employed by its real faction tower, displaced with its own cargo, or (for a
 * faction running an economy) attached to a building of its faction.
 */
export const hostileCivilianEmployerError = (
  actors: readonly SettlementActor[], buildings: readonly SettlementBuilding[],
  economyFaction: (faction: number) => boolean = () => false
) => {
  const sites = new Map(buildings.map(site => [site.uid, site]));
  for (const actor of actors) {
    const site = sites.get(actor.building);
    if (site?.enemyCatapultVariant !== undefined && ownerOf(site) > 0 &&
      site.worker === actor.uid && actor.hostileCivilianFaction !== site.militaryFaction)
      return "Invalid hostile civilian employer";
    if (actor.hostileCivilianFaction === undefined) continue;
    const employed = site?.enemyCatapultVariant !== undefined && site.worker === actor.uid &&
      site.militaryFaction === actor.hostileCivilianFaction;
    const displaced = actor.demolitionReturning === true &&
      ["demolitionBlocked", "catapultEvacuate"].includes(actor.phase);
    if (!employed && !displaced && !belongsToEconomy(actor, sites, economyFaction))
      return "Invalid hostile civilian employer";
  }
  return undefined;
};
