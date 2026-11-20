import { MAX_PLAYER_LEVEL } from "../../../../../island-of-settlers-shared/src/catalog/balance/levels";
import {
  AUTOSAVE_MINUTES_RANGE, TITLE_BACKGROUND_FILE, TITLE_MUSIC_FILE
} from "../../../../../island-of-settlers-shared/src/game-settings/constants";
import type {
  GameSettingsPresetId, OnlineFeatureKey, SimFeatureKey, TitleScreenFiles
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { ADMIN_MESSAGES as M } from "../messages";

/** Online switches in the plan's §5.5 order (Market · Shop · Chat · Friends · Guilds). */
export const ONLINE_SWITCH_ORDER: readonly OnlineFeatureKey[] = ["market", "shop", "chat", "friends", "guilds"];
export const ONLINE_SWITCH_KEYS: ReadonlySet<string> = new Set(ONLINE_SWITCH_ORDER);

/** Features in the §5.5 order; the simulation rules (fog of war, player troop sight) close the group. */
export const FEATURE_SWITCH_KEYS: readonly (SimFeatureKey | "fogOfWar" | "playerTroopsSightOnly")[] = [
  "trade", "colonies", "adventures", "settlementExpeditions", "explorationExpeditions", "fogOfWar",
  "playerTroopsSightOnly"
];

/** Tooltips of the switches whose effect the label alone does not explain. */
export const SWITCH_HINTS = {
  menuBeforePlay: M.fields.menuBeforePlayHint,
  playerTroopsSightOnly: M.fields.playerTroopsSightOnlyHint
} as const;

export const AUTOSAVE_MINUTES_LIMITS = Object.freeze({
  max: AUTOSAVE_MINUTES_RANGE[1], min: AUTOSAVE_MINUTES_RANGE[0]
});
export const MAX_FIXED_LEVEL = MAX_PLAYER_LEVEL;

export const TITLE_FILE_PATTERNS: Readonly<Record<keyof TitleScreenFiles, RegExp>> = {
  background: TITLE_BACKGROUND_FILE, music: TITLE_MUSIC_FILE
};

export const PRESET_IDS: readonly GameSettingsPresetId[] = ["onlineSettlement", "offlineSettlement", "story"];
export const PRESET_NAMES = {
  offlineSettlement: M.footer.presetOfflineSettlement,
  onlineSettlement: M.footer.presetOnlineSettlement,
  story: M.footer.presetStory
} as const;

/** The conventional names the title page probes when a field is empty (GS3b). */
export const TITLE_FILE_PLACEHOLDERS: Readonly<Record<keyof TitleScreenFiles, string>> = {
  background: "title-background.*", music: "title-music.*"
};

export const TITLE_FILE_TEXTS = {
  background: { hint: M.fields.titleBackgroundHint, label: M.fields.titleBackground },
  music: { hint: M.fields.titleMusicHint, label: M.fields.titleMusic }
} as const;
