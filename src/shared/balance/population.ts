import { buildingsWithRules } from "@shared/catalog/building-data/rules";

/**
 * Island population (owner decisions 2026-10-20, decision log "Population"). People are idle settlers
 * plus every friendly person on duty (workers, carriers, builders, porters, surveyors, recruits,
 * soldiers); mounts are not people. Each island has its own count and limit.
 */

/** Settlers a new home island starts with in its headquarters; authored scenarios set their own. */
export const START_SETTLERS = 50;
/** People limit of a home island before residences. */
export const POPULATION_BASE_LIMIT = 100;
/** People limit of a colony island (it has no headquarters) before residences. */
export const COLONY_POPULATION_BASE_LIMIT = 50;
/**
 * One settler is born every this many seconds per island, in the completed headquarters (a colony:
 * its harbour), while the island has fewer people than its limit. Adventures have no growth.
 */
export const POPULATION_GROWTH_SECONDS = 60;

/** A residence's people-limit bonus and the seconds it needs per settler before any upgrade. */
export interface ResidenceBalance {
  limit: number;
  growthSeconds: number;
}
/**
 * Residences (POP-02), keyed by building type (rules sidecar `residence`): small 4×4 (57), medium 5×5 (58), big
 * 6×6 (59). A completed residence raises its island's limit and bears settlers into the island's home building
 * while the island is below its limit. Limit bonuses and rates are owner decisions (confirmed 2026-10-20); rates
 * do not change with upgrades (owner 2026-10-20: a future talent speeds growth instead).
 */
export const RESIDENCE_POPULATION: Readonly<Record<number, ResidenceBalance>> = Object.freeze(Object.fromEntries(
  buildingsWithRules().flatMap(({ entry, rules }) => rules.residence ? [[entry.code, rules.residence]] : [])));
