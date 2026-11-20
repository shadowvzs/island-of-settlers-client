import {
  adventureCampRanks, ADVENTURE_DIFFICULTIES, ADVENTURE_OFFERS,
  adventureForce as difficultyForce, type AdventureForce, adventureLootGoods, adventureReward, adventuresPerLevel
} from "@shared/catalog/balance";

import { type AdventureTheme,adventureThemeFor, isAdventureTheme } from "./adventure-themes";
import { type ColonyDifficulty, isColonyDifficulty, nextOfferRandom, rollVoyageSeconds } from "./colony-expedition-rules";
import { EXPEDITION_ISLAND_SIZE } from "./colony-island-rules";
import { type DifficultyLevel, difficultyRank, difficultyScaled } from "./difficulty";
import { debugFlagError, type DebugTimedIsland } from "./expedition-debug-rules";
import { discoverIslandClimate, type DiscoveryCalendar, type IslandDiscovery,islandDiscoveryError } from "./island-discovery-policy";
import { type MilitaryTroopType, ORDINARY_TROOP_TYPES } from "./military-combat-rules";

export type AdventureDifficulty = ColonyDifficulty;
export interface AdventureIsland extends DebugTimedIsland {
  kind: "adventure";
  id: number;
  name: string;
  difficulty: AdventureDifficulty;
  seed: number;
  voyageSeconds: number;
  /** Square map side in cells: 96 for new offers; saves from before 2026-10-13 keep 64 or 128. */
  size: number;
  /** New offers keep one coherent island theme; older saves omit it. */
  theme?: AdventureTheme;
  discovery?: IslandDiscovery;
}
export interface AdventureCampPlan { troops: MilitaryTroopType[]; ranks: number[] }
export interface AdventureEnemyPlan { camps: AdventureCampPlan[] }

/** Every new adventure island has this side; older saves keep their 64 or 128 cells. */
export const ADVENTURE_WORLD_SIZE = EXPEDITION_ISLAND_SIZE;
const SAVED_ADVENTURE_SIZES: readonly number[] = [64, ADVENTURE_WORLD_SIZE, 128];
const OFFER_DIFFICULTIES: readonly AdventureDifficulty[] = ["easy", "medium", "hard"];
const BONUS_DIFFICULTIES: readonly AdventureDifficulty[] = ["medium", "hard"];
/** Ordinary cavalry is retired (HORSE-RETIREMENT-01); adventure camps field foot troops only. */
const CAMP_TROOPS: readonly MilitaryTroopType[] = ORDINARY_TROOP_TYPES;
const ADVENTURE_NAMES = [
  "Raven Skerry", "Wolfstone", "Black Gull Isle", "Smuggler's Cay", "Ironfang", "Ember Holm",
  "Grey Warden", "Stormcairn", "Shipwreck Reef", "Red Banner Isle", "Hollow Crag", "Bandit Shoal"
] as const;
/** Offer ids of different rounds never collide. */
const ROUND_ID_STRIDE = 100;

export const isAdventureIsland = (island: unknown): island is AdventureIsland =>
  Boolean(island) && (island as AdventureIsland).kind === "adventure";

const offerDifficulties = (roll: (range: number) => number) => {
  const order = OFFER_DIFFICULTIES.slice();
  while (order.length < ADVENTURE_OFFERS) order.push(BONUS_DIFFICULTIES[roll(BONUS_DIFFICULTIES.length)]!);
  return order;
};

/** Seeded adventure offers; `round` counts finished adventures, so each round brings new islands. */
export const adventureOffers = (worldSeed: number, round = 0, calendar?: DiscoveryCalendar): AdventureIsland[] => {
  let state = nextOfferRandom((worldSeed ^ Math.imul(round + 1, 0x85ebca6b)) >>> 0);
  const roll = (range: number) => { state = nextOfferRandom(state); return state % range; };
  const names = ADVENTURE_NAMES.slice();
  return offerDifficulties(roll).map((difficulty, index) => {
    const name = names.splice(roll(names.length), 1)[0]!;
    const voyageSeconds = rollVoyageSeconds(roll);
    const seed = nextOfferRandom(state ^ index);
    return { difficulty, id: round * ROUND_ID_STRIDE + index, kind: "adventure" as const, name,
      seed, size: ADVENTURE_WORLD_SIZE, voyageSeconds, theme: adventureThemeFor(seed),
      ...(calendar ? discoverIslandClimate(seed, voyageSeconds, calendar) : {}) };
  });
};

const campPlans = (sizes: readonly number[], ranks: readonly number[]): AdventureCampPlan[] => {
  let next = 0;
  return sizes.map(size => {
    const troops = Array.from({ length: size }, () => CAMP_TROOPS[next++ % CAMP_TROOPS.length]!);
    return { ranks: adventureCampRanks(size, ranks), troops };
  });
};

/**
 * Deterministic mixed field rosters; optional defences garrison troops from this same roster.
 * `level` scales the computer side's camp sizes and tier only (difficulty.ts); rewards and UI counts keep
 * calling the canonical plan without it.
 */
export const adventureEnemyPlan = (
  difficulty: AdventureDifficulty, level: DifficultyLevel = "normal"
): AdventureEnemyPlan => {
  const rule = ADVENTURE_DIFFICULTIES[difficulty];
  const camps = rule.camps.map(size => difficultyScaled(size, "soldiers", level));
  return { camps: campPlans(camps, rule.ranks.map(rank => difficultyRank(rank, level))) };
};

/** The enemy force for rewards: every camp unit. */
export const adventureForce = (island: Pick<AdventureIsland, "difficulty">): AdventureForce =>
  difficultyForce(island.difficulty);

export const adventureEnemyCount = (difficulty: AdventureDifficulty) =>
  adventureEnemyPlan(difficulty).camps.reduce((sum, camp) => sum + camp.troops.length, 0);

/** What winning pays at the player's level, plus how many such wins fill that level. */
export const adventureRewardFor = (island: AdventureIsland, level: number) => {
  const force = adventureForce(island);
  return { ...adventureReward(force, level), perLevel: adventuresPerLevel(force, level) };
};

/**
 * Coins and wares the reward ship brings home after a victory (independent of the player's level);
 * `lootBonus` is the adventure loot talent's share, rounded per ware.
 */
export const adventureRewardGoods = (island: Pick<AdventureIsland, "difficulty">, lootBonus = 0) =>
  adventureLootGoods(island.difficulty, lootBonus);

const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/** Saved adventure islands come from offers; anything else is rejected before loading. */
export const adventureIslandError = (island: unknown) => {
  const value = island as AdventureIsland;
  if (!isAdventureIsland(value) || !count(value.id) || !count(value.seed) || typeof value.name !== "string" ||
    !isColonyDifficulty(value.difficulty) || !(value.voyageSeconds > 0) || debugFlagError(value) ||
    (value.theme !== undefined && !isAdventureTheme(value.theme)))
    return "Invalid adventure island";
  return !SAVED_ADVENTURE_SIZES.includes(value.size) ? "Invalid adventure island size" : islandDiscoveryError(value);
};
