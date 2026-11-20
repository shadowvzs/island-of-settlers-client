import { COLONY_ISLAND_OFFERS } from "../balance/colonies";
import { selectColonyResourceTier } from "../world/colony-resource-tiers";
import { type ColonyIsland,colonyIslandOffers } from "./colony-expedition-rules";
import { discoverIslandClimate, type DiscoveryCalendar } from "./island-discovery-policy";

export const MAX_COLONY_ROUND = 0xffffffff - COLONY_ISLAND_OFFERS;
/** Legacy saves derive the next identity from extant records; newer saves retain the high-water mark. */
export const normalizeColonyRound = (round: number | undefined, islands: readonly { id: number }[]) =>
  Math.max(round ?? 0, ...islands.map(island => island.id - COLONY_ISLAND_OFFERS + 1), 0);

/** Replace one consumed slot only. Existing offer objects and the committed expedition stay frozen. */
export const replenishColonyOffer = (worldSeed: number, offers: readonly ColonyIsland[], consumed: ColonyIsland,
  round: number, level: number, calendar: DiscoveryCalendar, active: readonly ColonyIsland[] = []) => {
  const index = offers.findIndex(island => island.id === consumed.id);
  if (index < 0) return { offers: offers.slice(), round };
  let cursor = normalizeColonyRound(round, [...offers, ...active]);
  const usedSeeds = new Set([...colonyIslandOffers(worldSeed), ...offers, ...active].map(island => island.seed));
  let id: number, seed: number;
  do {
    if (cursor >= MAX_COLONY_ROUND) throw new Error("Colony discovery identities exhausted");
    id = COLONY_ISLAND_OFFERS + cursor++;
    // Odd multiplication is bijective modulo 2^32: later rounds cannot reuse generated seeds.
    seed = (worldSeed + Math.imul(id, 104729)) >>> 0;
  } while (usedSeeds.has(seed));
  const candidate = colonyIslandOffers(seed)[0]!;
  // Retain the slot's difficulty/ore balance; only its identity, climate and newly discovered
  // advanced pair change. Repeatedly choosing one slot cannot erase the other five categories.
  const island: ColonyIsland = { ...candidate, difficulty: consumed.difficulty, ore: consumed.ore,
    id, seed, resourceTier: selectColonyResourceTier(seed, level),
    ...discoverIslandClimate(seed, candidate.voyageSeconds, calendar) };
  const next = offers.slice(); next[index] = island;
  return { offers: next, round: cursor };
};
