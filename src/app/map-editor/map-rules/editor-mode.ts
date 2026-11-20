import type { I18n } from "@lingui/core";

import {
  type GameSettings, hasHomeIsland
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { rewardScopeOf } from "../../../shared/campaign/game-mode/reward-scope";
import { translateMessage } from "../../../shared/i18n/translate";
import type { EditorSettingsStatus } from "./editor-game-settings";
import { MAP_RULES_MESSAGES as M } from "./messages";

/**
 * The mode line shared by the map and campaign editors (plan §13.4): mode, reward scope and where the settings
 * came from. Kept apart from the Map rules view model so the campaign editor chunk does not load the map catalog.
 */
export const editorModeView = (i18n: I18n | undefined, settings: GameSettings, status: EditorSettingsStatus) => {
  const scope = rewardScopeOf(settings);
  return {
    mode: translateMessage(i18n, hasHomeIsland(settings) ? M.mode.home : M.mode.noHome),
    notLoaded: status === "pending" ? translateMessage(i18n, M.modeNotLoaded) : "",
    rewards: translateMessage(i18n, M.rewardScope[scope]),
    rewardsHint: translateMessage(i18n, M.rewardScopeHint[scope]),
    source: translateMessage(i18n, M.modeSource[status])
  };
};

export type EditorModeView = ReturnType<typeof editorModeView>;
