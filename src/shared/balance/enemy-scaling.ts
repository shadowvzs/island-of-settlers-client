import type { ColonyDifficulty } from "../settlement/colony-expedition-rules";
import type { DifficultyLevel } from "../settlement/difficulty";
import { FACTION_AI_CAPS } from "../world/constants";
import type { ScenarioStartTroop } from "../world/scenario-start-troops";
import type { CommanderPace } from "./commander-profiles";

/**
 * Enemy scaling table (lane EAI-FINAL, owner rule 2026-11-16: balance is low priority and scales the simple way:
 * a higher enemy soldier tier, more archer towers and more units, so the player has to send more troops to win).
 *
 * Two axes, one place:
 * - the island / map level (easy / medium / hard) sets the base enemy: colony forts and defenders
 *   (`colonies.ts`: 15 / 28 / 41 soldiers), adventure camps (`ADVENTURE_DIFFICULTIES`) and the authored map units;
 * - the global difficulty (Normal / Hard / Very hard, `difficulty.ts`) scales that base with the rows below.
 * The economy AI (`develop`) reads the level it plays at (`commanderPaceOf`: the island or map level moved up by the
 * global difficulty) for its start soldiers and its soldier cap.
 *
 * Normal is an exact no-op everywhere, so every map at Normal (every map today: the global level is not selectable
 * yet) plays as before; the medium `develop` row only adds the start soldiers.
 */

/** The global difficulty's multipliers of numbers the computer side already owns (owner decision 2026-11-08). */
export interface DifficultyProfile {
  startingStock: number;
  soldiers: number;
  productionSpeed: number;
  trainingSpeed: number;
  raidSize: number;
}

/** Named levels; nested objects are frozen so no caller can edit a shared profile. */
export const DIFFICULTY_PROFILES: Readonly<Record<DifficultyLevel, DifficultyProfile>> = Object.freeze({
  normal: Object.freeze({ startingStock: 1, soldiers: 1, productionSpeed: 1, trainingSpeed: 1, raidSize: 1 }),
  hard: Object.freeze({
    productionSpeed: 1.25, raidSize: 1.3, soldiers: 1.4, startingStock: 1.4, trainingSpeed: 1.25
  }),
  veryHard: Object.freeze({
    productionSpeed: 1.5, raidSize: 1.6, soldiers: 1.8, startingStock: 1.8, trainingSpeed: 1.5
  })
});

/** The global difficulty's additions beyond the multipliers: soldier tier and archer towers. */
export interface EnemyDifficultyScaling {
  /** Extra archer towers (two archers each) beside the colony forts and the adventure camps. */
  archerTowers: number;
  /** Ranks added to every computer-side soldier the island or map raises (capped at the top rank). */
  rankBonus: number;
}

export const ENEMY_DIFFICULTY_SCALING: Readonly<Record<DifficultyLevel, EnemyDifficultyScaling>> = Object.freeze({
  normal: Object.freeze({ archerTowers: 0, rankBonus: 0 }),
  hard: Object.freeze({ archerTowers: 1, rankBonus: 1 }),
  // Sweep EAI-FINAL: +2 tiers (every defender a veteran) left even an easy island unwinnable with 2.7x the force.
  veryHard: Object.freeze({ archerTowers: 2, rankBonus: 1 })
});

/**
 * The highest tier the tier bonus lifts a colony's defenders to, per island level (lane EAI-CLOSE: with the bonus an
 * easy island's rank-1 forts and towers were all veterans, and Very hard was not won even with 3.6x the force).
 * A base rank above the cap stays; more units and towers still separate the global levels.
 */
export const COLONY_SCALED_RANK_CAP: Readonly<Record<ColonyDifficulty, number>> = Object.freeze({
  easy: 1, hard: 2, medium: 2
});

/** Archers per extra difficulty tower (the open archer scaffold holds two). */
export const DIFFICULTY_TOWER_ARCHERS = 2;

/** A `develop` faction's soldiers per level it plays at. */
export interface DevelopLevelScaling {
  /** The soldier cap when the map sets no `limits.soldiers` (the map's limit always wins). */
  soldierCap: number;
  /**
   * Reserve soldiers in the depot of a start kit that names none (eai4-followup: towns without a soldier cannot
   * man a new tower, so they never expand). An explicit kit `soldiers` list replaces them.
   */
  startSoldiers: readonly ScenarioStartTroop[];
}

const troops = (shield: number, archer: number, rank: number): readonly ScenarioStartTroop[] => Object.freeze([
  Object.freeze({ count: shield, rank, type: "shield" as const }),
  Object.freeze({ count: archer, rank, type: "archer" as const })
].filter(line => line.count > 0));

const FULL_CAP = FACTION_AI_CAPS.soldiers;

export const DEVELOP_LEVEL_SCALING: Readonly<Record<CommanderPace, DevelopLevelScaling>> = Object.freeze({
  // Owner 2026-11-17: easy raids rarely with about four lowest-tier soldiers (rank-0 swordsmen; was 1 + 1 archer).
  easy: Object.freeze({ soldierCap: FULL_CAP / 2, startSoldiers: troops(4, 0, 0) }),
  medium: Object.freeze({ soldierCap: FULL_CAP, startSoldiers: troops(2, 2, 0) }),
  hard: Object.freeze({ soldierCap: FULL_CAP, startSoldiers: troops(3, 2, 1) }),
  veryHard: Object.freeze({ soldierCap: FULL_CAP, startSoldiers: troops(4, 2, 1) })
});

/**
 * Map building tiers a computer faction loses per level it plays at (owner 2026-11-17: "the difficulty table may
 * lower the AI tier on easy"). Applied only on islands with building availability rules, so every map without
 * them plays exactly as before.
 */
export const AI_BUILDING_TIER_OFFSET: Readonly<Record<CommanderPace, number>> = Object.freeze({
  easy: -1, hard: 0, medium: 0, veryHard: 0
});

const LOWEST_BUILDING_TIER = 1;

/** The highest map tier a computer faction playing at `pace` may build under the map's `mapTier` (never below 1). */
export const aiBuildingTier = (mapTier: number, pace: CommanderPace) =>
  Math.max(LOWEST_BUILDING_TIER, mapTier + AI_BUILDING_TIER_OFFSET[pace]);
