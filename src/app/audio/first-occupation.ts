import { GARRISON_CAPACITIES } from "../../shared/balance/military";
import { isOwnBuilding } from "../../shared/settlement/settlement-home";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";

export type OccupationSite = Pick<SettlementBuilding, "uid" | "typeId" | "construction" | "militaryFaction" | "territoryClaimed">;
const claimedGarrison = (site: OccupationSite) => site.construction === 1 &&
  GARRISON_CAPACITIES[site.typeId] !== undefined && site.territoryClaimed === true;
const occupied = (site: OccupationSite) => claimedGarrison(site) && isOwnBuilding(site);

/** One island's complete building collection; territoryClaimed makes a recreated/load observer silent. */
export const createFirstOccupationObserver = (initial: readonly OccupationSite[], play: () => void) => {
  const heard = new Set(initial.filter(claimedGarrison).map(site => site.uid));
  const observe = (sites: readonly OccupationSite[]) => {
    const active = new Set(sites.map(site => site.uid));
    for (const uid of heard) if (!active.has(uid)) heard.delete(uid);
    for (const site of sites) {
      if (!occupied(site) || heard.has(site.uid)) continue;
      heard.add(site.uid); play();
    }
  };
  return Object.assign(observe, { dispose: () => heard.clear() });
};

export const occupationTrumpetGain = (enabled: boolean, master: number, effects: number) =>
  enabled ? Math.max(0, Math.min(1, master)) * Math.max(0, Math.min(1, effects)) * .35 : 0;
