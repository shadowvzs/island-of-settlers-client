import {
  COMMANDER_PROFILES, type CommanderLevel, type CommanderPace, DEFAULT_COMMANDER_LEVEL, HARDER_COMMANDER_LEVEL,
  VERY_HARD_COMMANDER_PROFILE
} from "../../balance/commander-profiles";
import type { DifficultyLevel } from "../difficulty";
import type { SettlementContext } from "../settlement-types";
import type { CommanderProfile } from "./commander-types";

/** Where a computer faction's commander level may come from (A14 plan §7), most specific first. */
export interface CommanderLevelSources {
  /** The map script's `setCommanderLevel` for the faction, else its `setFactionAi` level. */
  script?: CommanderLevel;
  /** `MapScenario.factionAi[faction].level`: one field for the economy AI and the commander. */
  map?: CommanderLevel;
  /** The colony or adventure island's difficulty. */
  island?: CommanderLevel;
  /** The global difficulty (`difficulty.ts`); absent is Normal. */
  global?: DifficultyLevel;
}

/**
 * The level a faction plays at (A14 plan §7, the first match wins): 1 the script's level, exactly as authored; else
 * 2 the map's level, else 3 the island's, else medium, which 4 the global difficulty moves: Normal keeps it, Hard
 * and Very hard play one level up (Very hard also plays faster, see `resolveCommanderProfile`).
 */
const resolveCommanderLevel = (sources: Readonly<CommanderLevelSources>): CommanderLevel => {
  if (sources.script) return sources.script;
  const level = sources.map ?? sources.island ?? DEFAULT_COMMANDER_LEVEL;
  if (sources.global === "veryHard") return "hard";
  return sources.global === "hard" ? HARDER_COMMANDER_LEVEL[level] : level;
};

/** The profile of `resolveCommanderLevel`'s level; Very hard plays hard at a faster pace. */
export const resolveCommanderProfile = (sources: Readonly<CommanderLevelSources>): CommanderProfile => {
  if (!sources.script && sources.global === "veryHard") return VERY_HARD_COMMANDER_PROFILE;
  return COMMANDER_PROFILES[resolveCommanderLevel(sources)];
};

const mapLevelOf = (context: SettlementContext, faction: number) =>
  context.options.world.scenario?.factionAi?.find(entry => entry.faction === faction)?.level;

const islandLevelOf = (context: SettlementContext) =>
  context.colony?.save()?.island.difficulty ?? context.adventure?.save()?.island.difficulty;

/** Fills `sources` with the island's level sources of `faction`, most specific first. */
const readLevelSources = (context: SettlementContext, faction: number, sources: CommanderLevelSources) => {
  sources.script = context.commanderLevels?.of(faction) ?? context.factionAi?.scriptLevel(faction);
  sources.map = sources.script ? undefined : mapLevelOf(context, faction);
  sources.island = sources.script || sources.map ? undefined : islandLevelOf(context);
  sources.global = context.difficulty;
  return sources;
};

/** The level `faction` plays at now (the economy AI's strategic intents scale by it, lane EAI4b). */
export const commanderLevelOf = (context: SettlementContext, faction: number) =>
  resolveCommanderLevel(readLevelSources(context, faction, {}));

/** Reused: the level sources of `commanderPaceOf` (economy AI decisions read it once per due layer). */
const paceSources: CommanderLevelSources = {};

/**
 * The pace `faction` plays at now: its level, or Very hard (the hard level at the faster pace) under the global
 * Very hard difficulty without a script level, as `resolveCommanderProfile` picks the profile (lane EAI5a).
 */
export const commanderPaceOf = (context: SettlementContext, faction: number): CommanderPace => {
  readLevelSources(context, faction, paceSources);
  if (!paceSources.script && paceSources.global === "veryHard") return "veryHard";
  return resolveCommanderLevel(paceSources);
};

/**
 * The commander's `profile(faction)` input over the island's state, resolved at every call (a faction's
 * commander and director read it once per decision), so a level change acts from the next decision.
 */
export const createCommanderProfileSource = (context: SettlementContext) => {
  /** Reused: the sources of the faction being resolved. */
  const sources: CommanderLevelSources = {};
  return (faction: number): CommanderProfile => resolveCommanderProfile(readLevelSources(context, faction, sources));
};
