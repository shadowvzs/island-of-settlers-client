import type { CampaignMap } from "../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import type { GameSettings } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  formatSettingsChangeConsequence, settingsChangeConsequences
} from "../../../../../island-of-settlers-shared/src/game-settings/settings-change-consequences";
import { mapRecordModeIssues } from "../../../shared/campaign/game-mode/map-mode-checks";

/**
 * The mode-change confirmation (owner Q2, plan §13.1): the ordered consequences of a save and how many campaign
 * maps gain mode warnings. An empty list saves without asking.
 */
export interface ChangeLine {
  id: string;
  text: string;
}

export const changeLines = (before: GameSettings, after: GameSettings): ChangeLine[] =>
  settingsChangeConsequences(before, after).map(entry => ({
    id: entry.id, text: formatSettingsChangeConsequence(entry)
  }));

/** Maps that show more mode warnings (`mapRecordModeIssues`) after the change than before it. */
export const mapsGainingWarnings = (
  maps: readonly CampaignMap[], before: GameSettings, after: GameSettings
) => maps.filter(map => mapRecordModeIssues(map, after).length > mapRecordModeIssues(map, before).length).length;
