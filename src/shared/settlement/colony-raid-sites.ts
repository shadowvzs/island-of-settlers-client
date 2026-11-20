import { isVisionProbeActive, probeSiteRead } from "./faction-vision-probe";
import { type RaidSiegeSite, raidSiegeSites, URGENT_BUILDING_TIERS } from "./raid-target-priority";
import { findHomeBuilding } from "./settlement-home";
import type { createSettlementMilitary } from "./settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

type SettlementMilitary = ReturnType<typeof createSettlementMilitary>;

/**
 * The player's buildings as the colony's raiders know them (A14-4b, owner Q3): the raid tier list over the
 * buildings their faction has seen (the known-sites ledger) or sees now, and the places land parties and raid
 * ships head for. A garrison that struck the raiders revealed its building to the ledger by the hit alert.
 */
export const createColonyRaidSites = (context: SettlementContext, military: SettlementMilitary, faction: number) => {
  /** Storages and harbours where the player's reserve soldiers wait (raid tier 3, owner Q-BD1). */
  const reserveHomes = () => {
    const bodies = new Map<number, SettlementActor>(context.actors.map(actor => [actor.uid, actor]));
    const homes = new Set<number>();
    for (const soldier of military.soldiers()) {
      if ((soldier.combat?.faction ?? 0) !== 0 || soldier.stationed) continue;
      const body = bodies.get(soldier.actor);
      if (body?.phase === "militaryReserve") homes.add(body.home);
    }
    return homes;
  };
  const knowsSite = (site: SettlementBuilding) => context.factionKnowledge?.knowsBuilding(faction, site) ?? true;
  const collectSiegeEntries = () => {
    const doors = new Map(military.combat.doors().map(door => [door.building, door]));
    const reserves = reserveHomes();
    return raidSiegeSites({ buildings: context.buildings, doors, holdsSoldiers: uid => reserves.has(uid),
      knows: knowsSite });
  };
  let siteCache: { entries: RaidSiegeSite[]; tick: number } | undefined;
  /**
   * The player's buildings a raid can besiege, with their priority tier (raid-target-priority.ts) and whether
   * the raiders know them; gathered once per tick (plan review B9).
   */
  const siegeEntries = () => {
    const tick = context.clock?.tick();
    if (tick !== undefined && siteCache?.tick === tick) return siteCache.entries;
    const entries = collectSiegeEntries();
    if (tick !== undefined) siteCache = { entries, tick };
    return entries;
  };
  /**
   * A building a raid choice read (probe, tests and benches only): a ledger site is remembered, the start-known
   * home (owner Q3) too; any other read must be in sight now.
   */
  const probeSite = (label: string, site: SettlementBuilding, startKnown = false) => {
    if (!isVisionProbeActive()) return;
    probeSiteRead(label, faction, site,
      startKnown || context.factionKnowledge?.strategic.site(faction, site.uid) !== undefined);
  };
  /**
   * What land parties and raid ships head for: the tier 2-3 buildings the raiders' faction knows, else the
   * player's home (HQ or landing harbour), known from the start.
   */
  const anchors = () => {
    const known = siegeEntries().filter(entry => entry.known && entry.tier <= URGENT_BUILDING_TIERS.to)
      .map(entry => entry.site);
    for (const site of known) probeSite("raid.anchor", site);
    if (known.length) return known;
    const home = findHomeBuilding(context);
    if (home) probeSite("raid.anchor", home, true);
    return home ? [home] : [];
  };
  return { anchors, probeSite, siegeEntries };
};
