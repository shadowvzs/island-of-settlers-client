import { OFF_SEASON_VOYAGE_MULTIPLIER, SEASONAL_THEME_SHARE } from "../balance/colonies";
import { createRandom, deriveSeed } from "../world/rng";
import { ADVENTURE_THEMES, type AdventureTheme,isAdventureTheme } from "./adventure-themes";

/** Shared discovery names; adventure costumes remain separate from colony ecology. */
export type ExpeditionTheme = AdventureTheme;
const DISCOVERY_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type DiscoverySeason = (typeof DISCOVERY_SEASONS)[number];
const DISCOVERY_POLICY_VERSION = 1;
export const SEASON_THEME: Readonly<Record<DiscoverySeason, ExpeditionTheme>> = {
  spring: "forest", summer: "desert", autumn: "swamp", winter: "winter"
};
export interface DiscoveryCalendar {
  month: number;
  timeZone: string;
}
export interface DiscoveryOverride { month?: number; theme?: ExpeditionTheme }
export const discoveryOverrideError = (value: DiscoveryOverride | undefined): string | null => {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    (value.month !== undefined && (!Number.isInteger(value.month) || value.month < 1 || value.month > 12)) ||
    (value.theme !== undefined && !isAdventureTheme(value.theme))) return "Invalid discovery override";
  return null;
};
export interface IslandDiscovery {
  policyVersion: 1;
  season: DiscoverySeason;
  month: number;
  timeZone: string;
  /** Final voyageSeconds lives on the island; this original duration is never multiplied again. */
  baseVoyageSeconds: number;
  debug?: DiscoveryOverride;
}
export interface DiscoveredIsland {
  theme?: ExpeditionTheme;
  voyageSeconds: number;
  discovery?: IslandDiscovery;
}
const MIN_VOYAGE = 60, MAX_BASE_VOYAGE = 180;

export const discoverySeasonForMonth = (month: number): DiscoverySeason => {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Invalid discovery month");
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  return month >= 9 && month <= 11 ? "autumn" : "winter";
};

export const isDiscoveryTimeZone = (zone: unknown): zone is string => {
  if (typeof zone !== "string" || !zone.length || zone.length > 100) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; }
  catch { return false; }
};

/**
 * The UTC calendar of the game clock: the season rolls over at UTC midnight (owner 2026-10-22, no time zones
 * in rules). No calendar work runs in the frame loop: callers invoke this only when committing an offer batch.
 */
export const createDiscoveryCalendar = (now: () => number) =>
  (): DiscoveryCalendar => ({ month: new Date(now()).getUTCMonth() + 1, timeZone: "UTC" });

/** Independent draws leave offer difficulty, resources, terrain seeds and rewards untouched. */
export const selectDiscoveryTheme = (preferred: ExpeditionTheme, branch: number, alternative: number): ExpeditionTheme => {
  if (![branch, alternative].every(value => Number.isFinite(value) && value >= 0 && value < 1))
    throw new Error("Invalid discovery random draw");
  if (branch < SEASONAL_THEME_SHARE) return preferred;
  const others = ADVENTURE_THEMES.filter(theme => theme !== preferred);
  return others[Math.floor(alternative * others.length)]!;
};

export const discoverIslandClimate = (
  seed: number, baseVoyageSeconds: number, calendar: DiscoveryCalendar, override?: DiscoveryOverride
) => {
  if (!Number.isFinite(baseVoyageSeconds) || baseVoyageSeconds < MIN_VOYAGE || baseVoyageSeconds > MAX_BASE_VOYAGE)
    throw new Error("Invalid discovery voyage duration");
  if (!isDiscoveryTimeZone(calendar.timeZone)) throw new Error("Invalid discovery timezone");
  const month = override?.month ?? calendar.month, season = discoverySeasonForMonth(month);
  if (override?.theme !== undefined && !isAdventureTheme(override.theme)) throw new Error("Invalid discovery theme");
  const random = createRandom(deriveSeed(seed, `island-discovery-policy:${DISCOVERY_POLICY_VERSION}`));
  const theme = override?.theme ?? selectDiscoveryTheme(SEASON_THEME[season], random(), random());
  const voyageSeconds = Math.ceil(baseVoyageSeconds * (theme === SEASON_THEME[season] ? 1 : OFF_SEASON_VOYAGE_MULTIPLIER));
  const discovery: IslandDiscovery = { policyVersion: DISCOVERY_POLICY_VERSION, season, month,
    timeZone: calendar.timeZone, baseVoyageSeconds,
    ...(override && (override.month !== undefined || override.theme !== undefined) ? { debug: { ...override } } : {}) };
  return { theme, voyageSeconds, discovery };
};

export const isOffSeasonDiscovery = (island: DiscoveredIsland) => Boolean(island.discovery &&
  island.theme !== SEASON_THEME[island.discovery.season]);

/** Pre-policy records have no metadata and retain their existing theme/duration exactly. */
export const islandDiscoveryError = (island: DiscoveredIsland): string | null => {
  const discovery = island.discovery;
  if (discovery === undefined) return null;
  if (!discovery || discovery.policyVersion !== DISCOVERY_POLICY_VERSION) return "Unsupported island discovery policy";
  if (!isAdventureTheme(island.theme) || !Number.isInteger(discovery.month) || discovery.month < 1 || discovery.month > 12 ||
    discovery.season !== discoverySeasonForMonth(discovery.month) || !isDiscoveryTimeZone(discovery.timeZone) ||
    !Number.isFinite(discovery.baseVoyageSeconds) || discovery.baseVoyageSeconds < MIN_VOYAGE ||
    discovery.baseVoyageSeconds > MAX_BASE_VOYAGE) return "Invalid island discovery metadata";
  if (discovery.debug !== undefined && (!discovery.debug || typeof discovery.debug !== "object" ||
    Array.isArray(discovery.debug) ||
    (discovery.debug.month !== undefined && discovery.debug.month !== discovery.month) ||
    (discovery.debug.theme !== undefined && discovery.debug.theme !== island.theme))) return "Invalid discovery override";
  const expected = Math.ceil(discovery.baseVoyageSeconds * (isOffSeasonDiscovery(island) ? OFF_SEASON_VOYAGE_MULTIPLIER : 1));
  return island.voyageSeconds === expected ? null : "Invalid saved discovery voyage duration";
};

/** Offer/snapshot consumers get their own nested metadata instead of mutating a committed discovery. */
export const cloneDiscoveredIsland = <T extends DiscoveredIsland>(island: T): T => ({ ...island,
  ...(island.discovery ? { discovery: { ...island.discovery,
    ...(island.discovery.debug ? { debug: { ...island.discovery.debug } } : {}) } } : {}) });
