import { AI_GOALS, AI_LEVELS, AI_MODES, AI_STYLES } from "../../../../island-of-settlers-shared/src/script/constants";

/** Map-file start soldiers (`MapScenario.startTroops`, GS-MAP): lines, soldiers in total and the highest rank. */
export const START_TROOP_LIMITS = Object.freeze({
  lines: 32,
  maxRank: 2,
  total: 200
});

/** The highest amount of one ware in a map file's start stock (`MapScenario.stock`). */
export const MAX_START_STOCK_AMOUNT = 100_000;

/** The highest start settler count of a map file (`MapScenario.settlers`). */
export const MAX_START_SETTLERS = 10_000;

/**
 * What the AI of a computer faction does (`ScenarioFactionAi`, enemy economy AI plan §2.1); `none`: today's play.
 * One list each for the map's field and the script's `setFactionAi`.
 */
export const FACTION_AI_MODES = AI_MODES;
export const FACTION_AI_STYLES = AI_STYLES;
/** The strategic goals a map script may give a computer faction (`setFactionGoal`, EAI4c). */
export const FACTION_AI_GOALS = AI_GOALS;
/** The `ColonyDifficulty` values: one list for the map's AI level and the script's level actions. */
export const FACTION_AI_LEVELS = AI_LEVELS;

/** The issue path root of `MapScenario.factionAi`. */
export const FACTION_AI_PATH = "factionAi";

/** Each `ScenarioFactionAi.bonus` percentage: 100 is no handicap (enemy economy AI plan §2.2). */
export const FACTION_AI_BONUS_PERCENT_RANGE = [100, 300] as const;
/** A bonus percentage that changes nothing (the lower end of the range). */
export const NO_BONUS_PERCENT = FACTION_AI_BONUS_PERCENT_RANGE[0];

/** People (civilians and soldiers of every faction) one island is planned for (plan D-AI2, owner 2026-11-13). */
export const ISLAND_PEOPLE_TARGET = 600;

/** The highest authored building count of a map file (`MapScenario.buildings`). */
export const MAX_SCENARIO_BUILDINGS = 128;

/**
 * The owner's caps of one `develop` faction (plan §6.3, owner answers 2026-11-13: "caps 150/80/60 and 600 per
 * island"): civilians, soldiers and buildings. They are its limits without authored `limits`.
 */
export const FACTION_AI_CAPS = Object.freeze({ buildings: 60, population: 150, soldiers: 80 } as const);

/** The allowed `ScenarioFactionAi.limits` values, inclusive: authored limits only lower the caps. */
export const FACTION_AI_LIMIT_RANGES = Object.freeze({
  buildings: [1, FACTION_AI_CAPS.buildings],
  population: [0, FACTION_AI_CAPS.population],
  soldiers: [0, FACTION_AI_CAPS.soldiers]
} as const);

/**
 * A `maintain` faction keeps its authored buildings and soldiers plus its start reserve, so without authored
 * `limits` only its civilian depot reserve has a number (plan §6.3).
 */
export const FACTION_AI_MAINTAIN_POPULATION = 20;

/** v1 allows this many `develop` factions per map, beside any number of `maintain` factions (plan §9 Q10). */
export const MAX_DEVELOP_FACTIONS = 1;

/** A `develop` faction on a map with fewer cells than this side squared is a Ready warning (plan §2.2). */
export const FACTION_AI_DEVELOP_MIN_MAP_SIDE = 128;
