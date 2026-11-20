import type { MapScenario } from "../world/map-scenario";
import type { SettlementContext } from "./settlement-types";

/**
 * What the island on screen is to the player (campaign plan item 18, lane C3). It replaces the HQ-type and
 * authored-kind checks: a campaign map is never "home", even though it is an authored settlement.
 */
export type IslandRole = "home" | "colony" | "adventure" | "campaign";

/** The role from the authored kind first, then the live colony/adventure state (read only when needed). */
export const resolveIslandRole = (
  kind: MapScenario["kind"] | undefined, colonyActive: () => boolean, adventureActive: () => boolean
): IslandRole => {
  if (kind === "campaign") return "campaign";
  if (kind === "colony" || colonyActive()) return "colony";
  if (kind === "adventure" || adventureActive()) return "adventure";
  return "home";
};

/** The role of a settlement context (its scenario kind and its colony/adventure systems). */
export const contextIslandRole = (context: SettlementContext): IslandRole =>
  resolveIslandRole(context.options.world.scenario?.kind,
    () => Boolean(context.colony?.save()), () => Boolean(context.adventure?.save()));
