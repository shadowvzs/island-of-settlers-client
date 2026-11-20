import type { ColonyDifficulty, ColonyDifficultyRule } from "../settlement/colony-expedition-rules";
import type { ColonyCounterattackRule, ColonyFootTroop } from "../settlement/colony-island-rules";
import type { MilitaryTroopType } from "../settlement/military-combat-rules";
import type { Goods } from "../settlement/settlement-types";

/**
 * Defender totals retuned 2026-10-24 for the DEC-03 revised recommendation (flowCommander): easy 15,
 * medium 28 (was 26), hard 41. The medium change and the fort mixes below retune the colony only;
 * field combat, soldier statistics and the player roster are untouched. See
 * docs/contracts/colonies-and-adventures.md "Colony balance (2026-10-24)".
 */
export const COLONY_DIFFICULTIES: Readonly<Record<ColonyDifficulty, ColonyDifficultyRule>> = {
  easy: { enemyBuildings: 3, enemyTroops: 15, troopCap: 20 },
  medium: { enemyBuildings: 5, enemyTroops: 28, troopCap: 35 },
  hard: { enemyBuildings: 7, enemyTroops: 41, troopCap: 50 }
};
/** Minimum expedition force as a share of the target's canonical defenders. */
export const EXPEDITION_ENEMY_FORCE_RATIO = .5;
export const COLONY_LIMIT = 3;
/** Builder and carrier sail as settlers; their job starts on the colony island. */
export const COLONY_CREW = 2;
export const COLONY_SUPPLIES: Readonly<Goods> = Object.freeze({
  hammer: 1, planks: 20, shovel: 1, stone: 15
});
export const COLONY_ISLAND_OFFERS = 6;

/** Sailing is 50% faster; saved route durations remain compatible with existing voyages. */
export const SHIP_SAILING_MULTIPLIER = 1.5;
export const COLONY_VOYAGE_SECONDS = 120;
/** Each offered island adds up to this much travel time either side of the base voyage. */
export const COLONY_VOYAGE_SPREAD_SECONDS = 60;
export const SEASONAL_THEME_SHARE = .9;
export const OFF_SEASON_VOYAGE_MULTIPLIER = 1.25;
export const TROOP_DECK_SLOTS: Readonly<Record<MilitaryTroopType, number>> = {
  archer: 1, cavalry: 2, heavy: 1, shield: 1
};
/** Measured: 14 soldiers board in about 95 s (two at a time over the pier). */
export const BOARDING_SECONDS_PER_PASSENGER = 7;
export const MINIMUM_LOADING_SECONDS = 10;

export const COLONY_SUPPLY_SECONDS = 60;
export const COLONY_ORE_SHIP_MS = 60 * 60 * 1000;
/** Ore a fed mine sends home per hour while its island is not on screen. */
export const COLONY_ORE_PER_MINE_HOUR = 60;

/**
 * Fort types and defender ranks per difficulty (one fort per `enemyBuildings`); the defender totals are
 * `enemyTroops`. Tuned to the owner's targets (easy ~12–15 soldiers, medium ~25–30, hard 40+ veterans).
 * The order is the placement order (farthest first), so the last type is the first fort attacked.
 * Easy now has one stronghold and two guardhouses; medium two strongholds and three guardhouses;
 * hard puts a stronghold at each end so the force meets one with its full army and the other last.
 * See docs/contracts/colonies-and-adventures.md "Colony balance (2026-10-24)".
 */
export const COLONY_FORT_TYPES: Readonly<Record<ColonyDifficulty, readonly number[]>> = {
  easy: [9, 2, 2],
  hard: [9, 4, 4, 4, 2, 2, 9],
  medium: [9, 9, 2, 2, 2]
};
export const COLONY_FORT_RANKS: Readonly<Record<ColonyDifficulty, readonly number[]>> = {
  easy: [1],
  hard: [1, 2],
  medium: [0, 1]
};
export const COLONY_FORT_CAPACITY: Readonly<Record<number, number>> = { 1: 2, 2: 3, 4: 6, 9: 9 };
export const COLONY_FORT_DOOR_HP: Readonly<Record<number, number>> = { 1: 120, 2: 150, 4: 200, 9: 260 };
export const COLONY_FORT_DEFENDER_TYPES: readonly ColonyFootTroop[] = ["shield", "archer", "heavy"];
/**
 * Foot defenders of the enclosed camps (towers stay all-archer). Easy keeps the ordinary rotation;
 * medium camps carry fewer bows and hard camps more, so the intended force thresholds survive the
 * wide compounds and the shipped flow-field movement. See "Colony balance (2026-10-24)".
 */
export const COLONY_FORT_COMPOSITIONS: Readonly<Record<ColonyDifficulty, readonly ColonyFootTroop[]>> = {
  easy: ["shield", "archer", "heavy"],
  medium: ["shield", "heavy", "archer", "shield"],
  hard: ["shield", "archer", "archer", "heavy", "shield"]
};
/** Medium guardhouses hold a melee-only garrison; the strongholds keep the difficulty's rotation. */
export const COLONY_FORT_TYPE_COMPOSITIONS: Readonly<
  Partial<Record<ColonyDifficulty, Partial<Record<number, readonly ColonyFootTroop[]>>>>
> = {
  medium: { 2: ["shield", "heavy", "shield"] }
};

/**
 * Counterattacks on forts the player has captured (owner decision 2026-10-13): none on easy; from
 * medium the remaining forts send part of their garrisons over land; on hard, troops also arrive
 * by ship. Seconds between attacks; land parties are drawn from the garrisons, ship troops are new.
 */
export const COLONY_COUNTERATTACKS: Readonly<
  Record<ColonyDifficulty, ColonyCounterattackRule | null>
> = {
  easy: null,
  hard: {
    landInterval: 90,
    landSize: 6,
    ship: {
      interval: 180,
      ranks: [1, 2],
      troops: ["shield", "heavy", "shield", "archer", "heavy", "shield"]
    }
  },
  medium: { landInterval: 120, landSize: 4 }
};
/** A fort keeps at least this many defenders when it sends soldiers to a counterattack. */
export const COUNTERATTACK_GARRISON_MINIMUM = 2;
/** Seconds from the first capture to the first land counterattack and to the first ship. */
export const FIRST_COUNTERATTACK_SECONDS = 45;
export const FIRST_RAID_SHIP_SECONDS = 90;

