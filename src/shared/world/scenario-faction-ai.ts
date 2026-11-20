import {
  arrayOf, boolean, type Check, checkValue, enumOf, guard, integer, objectOf, optional, recordOf
} from "../../../../island-of-settlers-shared/src/validation/index";
import { WARE_IDS } from "../../render-common/wares/ware-catalog";
import {
  FACTION_AI_BONUS_PERCENT_RANGE, FACTION_AI_CAPS, FACTION_AI_LEVELS, FACTION_AI_LIMIT_RANGES,
  FACTION_AI_MAINTAIN_POPULATION, FACTION_AI_MODES, FACTION_AI_STYLES, MAX_START_SETTLERS, MAX_START_STOCK_AMOUNT
} from "./constants";
import { HUMAN_FACTION, MAX_FACTION } from "./scenario-players";
import { type ScenarioStartTroop, validScenarioStartTroops } from "./scenario-start-troops";

/**
 * The map maker's AI choice per computer faction (enemy economy AI plan §2.1). Authored map content: pure,
 * worker-safe and read by nothing in the simulation yet (P0), so a map without it plays exactly as before.
 */
export type FactionAiMode = (typeof FACTION_AI_MODES)[number];
export type FactionAiStyle = (typeof FACTION_AI_STYLES)[number];
export type FactionAiLevel = (typeof FACTION_AI_LEVELS)[number];

/** The faction depot's start: wares and settlers (maintain: repair/rebuild budget; develop: start economy). */
export interface ScenarioFactionAiStart {
  settlers: number;
  soldiers?: ScenarioStartTroop[];
  stock: Record<string, number>;
}
/** Explicit map-maker handicap in percent (100 = none). The only allowed "cheat". */
export interface ScenarioFactionAiBonus {
  construction?: number;
  production?: number;
  training?: number;
}
/** Hard caps (performance and pacing). */
export interface ScenarioFactionAiLimits {
  buildings?: number;
  population?: number;
  soldiers?: number;
}
export interface ScenarioFactionAi {
  /** Absent: no handicap. */
  bonus?: ScenarioFactionAiBonus;
  /** develop: may claim new land with its own military buildings (default true); maintain: never. */
  expand?: boolean;
  /** 1..16, unique in the list. */
  faction: number;
  /** Reaction time and decision quality, never information; absent: the island's difficulty. */
  level?: FactionAiLevel;
  /** Absent: the mode defaults (`FACTION_AI_CAPS` for develop). */
  limits?: ScenarioFactionAiLimits;
  mode: FactionAiMode;
  start?: ScenarioFactionAiStart;
  /** develop only; absent: balanced. */
  style?: FactionAiStyle;
}

const range = ([min, max]: readonly [number, number]) => optional(integer(min, max));
const bonusPercent = range(FACTION_AI_BONUS_PERCENT_RANGE);

const startCheck = objectOf({
  settlers: integer(0, MAX_START_SETTLERS),
  soldiers: guard(validScenarioStartTroops),
  stock: recordOf(integer(0, MAX_START_STOCK_AMOUNT), { key: enumOf(WARE_IDS), maxEntries: WARE_IDS.length })
});

const factionAiCheck: Check = objectOf({
  bonus: optional(objectOf({ construction: bonusPercent, production: bonusPercent, training: bonusPercent })),
  expand: optional(boolean),
  faction: integer(HUMAN_FACTION + 1, MAX_FACTION),
  level: optional(enumOf(FACTION_AI_LEVELS)),
  limits: optional(objectOf({
    buildings: range(FACTION_AI_LIMIT_RANGES.buildings),
    population: range(FACTION_AI_LIMIT_RANGES.population),
    soldiers: range(FACTION_AI_LIMIT_RANGES.soldiers)
  })),
  mode: enumOf(FACTION_AI_MODES),
  start: optional(startCheck),
  style: optional(enumOf(FACTION_AI_STYLES))
});

/** Paths of the structurally invalid fields of a `MapScenario.factionAi` value (strict: unknown fields fail). */
export const factionAiInvalidPaths = (value: unknown, path: string) =>
  checkValue(arrayOf(factionAiCheck, MAX_FACTION), value, path).map(issue => issue.path);

/** The civilians an AI faction may have while it plays `mode`: the authored limit, else the mode's default. */
export const factionAiPopulationLimit = (entry: ScenarioFactionAi, mode: FactionAiMode) => {
  if (entry.limits?.population !== undefined) return entry.limits.population;
  return mode === "develop" ? FACTION_AI_CAPS.population : FACTION_AI_MAINTAIN_POPULATION;
};

/** The soldiers a `develop` faction may have: the map's limit, else `fallback` (the default cap, plan §6.3). */
export const factionAiDevelopSoldierLimit = (entry: ScenarioFactionAi, fallback: number = FACTION_AI_CAPS.soldiers) =>
  entry.limits?.soldiers ?? fallback;

/** The factions an AI plays; `none` entries and factions without an entry keep today's behaviour. */
export const activeFactionAi = (factionAi: readonly ScenarioFactionAi[] | undefined) =>
  (factionAi ?? []).filter(entry => entry.mode !== "none");
