import type { MapScenario } from "../../shared/world/map-scenario";
import { MAP_EDITOR_MESSAGES as M } from "./messages";

/**
 * A home scenario is a peaceful settlement start. Both `isMapScenario` (home definitions may not
 * hold units or buildings) and `initializeMapScenario` (home returns before spawning enemies)
 * enforce that rule at the data and Play layers, so the editor refuses the same combinations
 * while authoring instead of saving a map that Play has to reject or ignore.
 */
export const areEnemiesBlocked = (scenario: Pick<MapScenario, "kind"> | undefined) =>
  (scenario?.kind ?? "home") === "home";

/** An adventure or colony scenario cannot become a peaceful home while it keeps authored enemies. */
export const hasAuthoredEnemies = (scenario: Pick<MapScenario, "buildings" | "units"> | undefined) =>
  scenario !== undefined && (scenario.units.length > 0 || scenario.buildings.length > 0);

/** Shown in the Units tab while the current scenario kind keeps the island peaceful. */
export const PEACEFUL_HOME_NOTE = M.scenario.peacefulHomeNote;

/** A click on enemy placement while the current scenario kind is home. */
export const ENEMIES_NEED_SCENARIO_HINT = M.hints.scenarioEnemiesNeed;

/** Refused scenario-kind change: home cannot keep the units and camps authored so far. */
export const HOME_KIND_BLOCKED_HINT = M.hints.scenarioHomeBlocked;
