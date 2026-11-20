import { PLAYER_SUPPORT_MILITARY_TYPE_IDS } from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { isIndestructible } from "./building-destruction";
import type { MilitaryDoor } from "./military-combat-rules";
import { isExposedSupportSite, isPlayerGarrisonSite } from "./military-siege-sites";
import { isOwnBuilding } from "./settlement-home";
import type { SettlementBuilding, SettlementPoint } from "./settlement-types";

/**
 * The one target priority of soldiers choosing a target on their own (owner 2026-11-09, merged list Q-BD1),
 * most urgent first:
 * 1. enemy soldiers: field soldiers within `RAID_NEARBY_RADIUS` of the soldier or of its target
 *    (`nearbyTroop` in settlement-colony-counterattack.ts);
 * 2. military buildings that hold soldiers (garrison buildings, Catapult Towers, captured forts);
 * 3. the Military Academy and the Commander's Lodge once no standing tier-2 building within
 *    `RAID_NEARBY_RADIUS` shields them, and other buildings holding soldiers (a storage or harbour with
 *    reserve soldiers);
 * 4. civilians outdoors (the civilian hunt);
 * 5. every other building, construction sites included (BD1); roads and bridges never.
 * Nearest first within a tier, then the lower uid. It applies to AUTOMATIC target choice only: an explicit
 * order's building target is kept (owner Q-BD8), though nearby enemy soldiers are still fought first. Never
 * targets: the player's own HQ and, until BD3, the landing (home) harbour or founding anchor.
 * Building tiers only count buildings the choosing faction knows (A13: seen now, remembered, or alerted).
 */
export const RAID_TARGET_TIERS = Object.freeze({
  civilian: 4, garrisonBuilding: 2, otherBuilding: 5, soldier: 1, supportBuilding: 3
});

/** What the tiers read besides the buildings themselves. */
export interface RaidSiteSources {
  buildings: readonly SettlementBuilding[];
  doors: ReadonlyMap<number, MilitaryDoor>;
  /** Whether the building holds the player's soldiers outside a garrison (reserves homed there). */
  holdsSoldiers?: (uid: number) => boolean;
  /** Whether the choosing faction knows the building (absent: every building is known). */
  knows?: (site: SettlementBuilding) => boolean;
}

/** A building of the player's tier list with its tier, and whether the choosing faction knows it. */
export interface RaidSiegeSite { known: boolean; site: SettlementBuilding; tier: number }

/** Inclusive tier range of a pick. */
export interface RaidTierRange { from: number; to: number }

const EVERY_BUILDING_TIER: RaidTierRange = Object.freeze({
  from: RAID_TARGET_TIERS.garrisonBuilding, to: RAID_TARGET_TIERS.otherBuilding
});
/** Tiers 2-3: the buildings raiders besiege before they hunt civilians. */
export const URGENT_BUILDING_TIERS: RaidTierRange = Object.freeze({
  from: RAID_TARGET_TIERS.garrisonBuilding, to: RAID_TARGET_TIERS.supportBuilding
});
/** Tier 5: every other building, once no civilian is left in reach. */
export const OTHER_BUILDING_TIERS: RaidTierRange = Object.freeze({
  from: RAID_TARGET_TIERS.otherBuilding, to: RAID_TARGET_TIERS.otherBuilding
});

const isStanding = (site: SettlementBuilding, doors: ReadonlyMap<number, MilitaryDoor>) =>
  (doors.get(site.uid)?.structure?.hp ?? 1) > 0;

/** A player building that may be besieged at all: own, standing, destructible and not a hostile camp. */
const isRaidable = (site: SettlementBuilding, doors: ReadonlyMap<number, MilitaryDoor>) =>
  isOwnBuilding(site) && !isIndestructible(site) && site.bandit === undefined && !site.eventCourtyard &&
  isStanding(site, doors);

const isFinishedSupport = (site: SettlementBuilding) =>
  site.construction === 1 && PLAYER_SUPPORT_MILITARY_TYPE_IDS.has(site.typeId);

/** Priority tier of a player building (2, 3 or 5), or undefined when it is no target now. */
export const raidBuildingTier = (site: SettlementBuilding, sources: RaidSiteSources) => {
  const { buildings, doors } = sources;
  if (!isRaidable(site, doors)) return undefined;
  if (isPlayerGarrisonSite(site)) return RAID_TARGET_TIERS.garrisonBuilding;
  if (isFinishedSupport(site))
    return isExposedSupportSite(site, buildings, doors) ? RAID_TARGET_TIERS.supportBuilding : undefined;
  if (sources.holdsSoldiers?.(site.uid)) return RAID_TARGET_TIERS.supportBuilding;
  return RAID_TARGET_TIERS.otherBuilding;
};

/** The player's buildings a raid may besiege now, each with its tier and whether the raiders know it. */
export const raidSiegeSites = (sources: RaidSiteSources): RaidSiegeSite[] => {
  const sites: RaidSiegeSite[] = [];
  for (const site of sources.buildings) {
    const tier = raidBuildingTier(site, sources);
    if (tier !== undefined) sites.push({ known: sources.knows?.(site) ?? true, site, tier });
  }
  return sites;
};

/**
 * The raid's building target among the known `sites` within `tiers`: the most urgent tier first, then the
 * nearest entrance to `from`, then the lower uid (deterministic).
 */
export const pickRaidSiegeSite = (
  sites: readonly RaidSiegeSite[], from: SettlementPoint, tiers: RaidTierRange = EVERY_BUILDING_TIER
) => {
  let best: { site: SettlementBuilding; span: number; tier: number } | undefined;
  for (const entry of sites) {
    if (!entry.known || entry.tier < tiers.from || entry.tier > tiers.to) continue;
    const span = DMath.hypot(entry.site.access.x - from.x, entry.site.access.z - from.z);
    const better = !best || entry.tier < best.tier || (entry.tier === best.tier &&
      (span < best.span || (span === best.span && entry.site.uid < best.site.uid)));
    if (better) best = { site: entry.site, span, tier: entry.tier };
  }
  return best?.site;
};
