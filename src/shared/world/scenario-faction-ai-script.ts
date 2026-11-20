import type { ScriptFactionAiView } from "../../../../island-of-settlers-shared/src/script/validate";
import { ISLAND_PEOPLE_TARGET, MAX_DEVELOP_FACTIONS } from "./constants";
import type { FactionAiMode, ScenarioFactionAi } from "./scenario-faction-ai";
import { type FactionAiSource, islandAiPeople, validScenarioFactionAi } from "./scenario-faction-ai-issues";
import { HUMAN_FACTION } from "./scenario-players";

/**
 * The computer factions a map script may address with `setFactionAi` / `factionAiPause` (enemy economy AI plan
 * §5.2, lane EAI2c): every saved `factionAi` entry, then each faction that owns authored units or buildings
 * without one, as a `none` entry (so a script can wake an enemy that starts without AI). A home map and a map
 * with a malformed list have none.
 */
const NO_FACTIONS: readonly ScenarioFactionAi[] = Object.freeze([]);
const scriptableByScenario = new WeakMap<FactionAiSource, readonly ScenarioFactionAi[]>();

const listScriptableFactionAi = (scenario: FactionAiSource): readonly ScenarioFactionAi[] => {
  if (scenario.kind === "home" || !validScenarioFactionAi(scenario)) return NO_FACTIONS;
  const saved = (scenario.factionAi ?? []) as readonly ScenarioFactionAi[];
  const known = new Set(saved.map(entry => entry.faction));
  const owners = [...scenario.units ?? [], ...scenario.buildings ?? []].map(entry => entry.faction)
    .filter(faction => faction !== HUMAN_FACTION && !known.has(faction));
  const implicit = [...new Set(owners)].sort((first, second) => first - second)
    .map((faction): ScenarioFactionAi => ({ faction, mode: "none" }));
  return [...saved, ...implicit];
};

/** Cached per scenario object (authored content never changes while a map runs). */
export const scriptableFactionAi = (scenario: FactionAiSource | undefined): readonly ScenarioFactionAi[] => {
  if (!scenario) return NO_FACTIONS;
  let entries = scriptableByScenario.get(scenario);
  if (!entries) scriptableByScenario.set(scenario, entries = listScriptableFactionAi(scenario));
  return entries;
};

/** The map's computer faction AI for the script Ready check: the scriptable factions and the map's own limits. */
export const scriptFactionAiView = (scenario: FactionAiSource | undefined): ScriptFactionAiView => {
  const entries = scriptableFactionAi(scenario);
  const source: FactionAiSource = { ...scenario, factionAi: entries };
  return {
    canDevelop: faction => Boolean(entries.find(entry => entry.faction === faction)?.start?.settlers),
    maxDevelopFactions: MAX_DEVELOP_FACTIONS,
    modes: new Map(entries.map(entry => [entry.faction, entry.mode])),
    peopleTarget: ISLAND_PEOPLE_TARGET,
    peopleWith: (faction, mode) =>
      islandAiPeople(source, entry => (entry.faction === faction ? mode as FactionAiMode : entry.mode))
  };
};
