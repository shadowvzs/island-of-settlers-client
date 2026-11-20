import { createMapScenario, type MapScenario } from "../../src/shared/world/map-scenario";
import type { FactionAiMode, ScenarioFactionAi } from "../../src/shared/world/scenario-faction-ai";

/** The map's faction AI entries that give `factions` an economy (mode `maintain` by default, other fields absent). */
export const maintainFactionAi = (factions: readonly number[] = [], mode: FactionAiMode = "maintain"):
  ScenarioFactionAi[] => factions.map(faction => ({ faction, mode }));

/** A scenario stub carrying only the faction AI, for bare helper contexts without an authored map. */
export const economyScenario = (factions?: readonly number[]) =>
  ({ factionAi: maintainFactionAi(factions) }) as unknown as MapScenario;

/**
 * An authored map with no objects whose `factions` run an economy (`maintain` by default), for full simulations: a
 * campaign map, or a colony map (which refuses the base producers to the player only).
 */
export const economyCampaignScenario = (
  factions: readonly number[], mode: FactionAiMode = "maintain", kind: "campaign" | "colony" = "campaign"
): MapScenario => ({ ...createMapScenario(), factionAi: maintainFactionAi(factions, mode), kind });
