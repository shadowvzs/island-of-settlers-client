import { DEFAULT_AUTOSAVE_MINUTES } from "../../../../../island-of-settlers-shared/src/game-settings/constants";
import {
  cloneGameSettings, fogOfWarEnabled, GAME_SETTINGS_PRESETS, type GameSettings, type GameSettingsPresetId,
  hasHomeIsland, menuBeforePlayStored, type OnlineFeatureKey, optionalFeatureEnabled, playerTroopsSightOnlyEnabled,
  type SimFeatureKey, type TitleScreenFiles
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  checkGameSettings, formatGameSettingsIssue, hasGameSettingsErrors
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings-issues";
import {
  effectiveSaving, SETTING_DEPENDENCY_REASONS, settingAvailability, type SettingKey
} from "../../../../../island-of-settlers-shared/src/game-settings/setting-availability";
import { isDeepEqual } from "../../components/ui-store";
import { MAX_FIXED_LEVEL, ONLINE_SWITCH_KEYS, TITLE_FILE_PATTERNS } from "./constants";

/**
 * Pure transforms of the Game settings tab (plan §5.5, §13.1): the flat switch rows with their dependency reasons
 * (`settingAvailability`), immutable edits of the draft, presets, title file checks and the draft's issues.
 */
export type BooleanSettingKey =
  | "autosave" | "experience" | "fogOfWar" | "homeIsland" | "menuBeforePlay" | "playerTroopsSightOnly" | "slots"
  | "talents" | OnlineFeatureKey | SimFeatureKey;

export interface SwitchState {
  /** What the switch shows: the stored value, or the forced/unavailable value while disabled. */
  checked: boolean;
  disabled: boolean;
  key: BooleanSettingKey;
  /** The dependency rule's reason (tooltip and note) while disabled; empty otherwise. */
  reason: string;
}

export type RewardsChoice = "auto" | "off" | "on";

/** The stored value of a boolean switch (absent optional fields read as today's defaults). */
export const storedSwitch = (settings: GameSettings, key: BooleanSettingKey): boolean => {
  if (key === "homeIsland") return hasHomeIsland(settings);
  if (key === "fogOfWar") return fogOfWarEnabled(settings);
  if (key === "menuBeforePlay") return menuBeforePlayStored(settings);
  if (key === "playerTroopsSightOnly") return playerTroopsSightOnlyEnabled(settings);
  if (key === "autosave") return settings.saving?.autosave ?? true;
  if (key === "slots") return settings.saving?.slots ?? false;
  if (key === "experience" || key === "talents") return settings.progression[key];
  if (ONLINE_SWITCH_KEYS.has(key)) return settings.online[key as OnlineFeatureKey];
  if (key === "explorationExpeditions") return optionalFeatureEnabled(settings, key);
  return settings.features[key as Exclude<SimFeatureKey, "explorationExpeditions">];
};

/** A switch as the admin sees it: disabled ones show their forced or unavailable value and keep the stored one. */
export const switchState = (settings: GameSettings, key: BooleanSettingKey): SwitchState => {
  const availability = settingAvailability(settings, key as SettingKey);
  if (availability.enabled) return { checked: storedSwitch(settings, key), disabled: false, key, reason: "" };
  const reason = availability.reason ? SETTING_DEPENDENCY_REASONS[availability.reason].en : "";
  return { checked: availability.forced === true, disabled: true, key, reason };
};

/** The landing after a map without a home: "Home" is unavailable (D8), so the draft moves to asking the player. */
const withHomePlace = (settings: GameSettings, home: boolean) => {
  settings.start = { ...settings.start, place: home ? "home" : "campaignSelect" };
  if (!home && settings.afterMap === "home") settings.afterMap = "exitChoice";
};

const withSaving = (settings: GameSettings, change: Partial<NonNullable<GameSettings["saving"]>>) => {
  const saving = settings.saving ?? { autosave: true, slots: false };
  settings.saving = { ...saving, ...change };
};

/** A copy of the draft with one switch changed. */
export const withSwitch = (settings: GameSettings, key: BooleanSettingKey, value: boolean): GameSettings => {
  const next = cloneGameSettings(settings);
  if (key === "homeIsland") withHomePlace(next, value);
  else if (key === "fogOfWar" || key === "menuBeforePlay" || key === "playerTroopsSightOnly") next[key] = value;
  else if (key === "autosave" || key === "slots") withSaving(next, { [key]: value });
  else if (key === "experience" || key === "talents") next.progression[key] = value;
  else if (ONLINE_SWITCH_KEYS.has(key)) next.online[key as OnlineFeatureKey] = value;
  else next.features[key as SimFeatureKey] = value;
  return next;
};

export const withConnectivity = (settings: GameSettings, connectivity: GameSettings["connectivity"]) =>
  ({ ...cloneGameSettings(settings), connectivity });

export const withAfterMap = (settings: GameSettings, afterMap: GameSettings["afterMap"]) =>
  ({ ...cloneGameSettings(settings), afterMap });

export const autosaveMinutes = (settings: GameSettings) =>
  settings.saving?.autosaveMinutes ?? DEFAULT_AUTOSAVE_MINUTES;

export const withAutosaveMinutes = (settings: GameSettings, minutes: number) => {
  const next = cloneGameSettings(settings);
  withSaving(next, { autosaveMinutes: minutes });
  return next;
};

/** The interval field shows only while automatic saving is effectively on. */
export const showsAutosaveMinutes = (settings: GameSettings) => effectiveSaving(settings).autosave;

export const fixedLevelOf = (settings: GameSettings) => {
  const { levels } = settings.progression;
  return levels.kind === "fixed" ? levels.level : MAX_FIXED_LEVEL;
};

export const withLevels = (settings: GameSettings, kind: "earned" | "fixed", level = fixedLevelOf(settings)) => {
  const next = cloneGameSettings(settings);
  next.progression.levels = kind === "fixed" ? { kind, level } : { kind };
  return next;
};

export const rewardsChoice = (settings: GameSettings): RewardsChoice => {
  const { rewards } = settings.progression;
  if (rewards === undefined) return "auto";
  return rewards ? "on" : "off";
};

export const withRewards = (settings: GameSettings, choice: RewardsChoice) => {
  const next = cloneGameSettings(settings);
  if (choice === "auto") delete next.progression.rewards;
  else next.progression.rewards = choice === "on";
  return next;
};

/**
 * A preset over the draft (rev H7): on a server the mode (online/offline) stays the admin's explicit choice; the
 * title page's files and its "game menu before play" switch are not part of a preset and are kept.
 */
export const withPreset = (settings: GameSettings, presetId: GameSettingsPresetId, keepConnectivity: boolean) => {
  const next = cloneGameSettings(GAME_SETTINGS_PRESETS[presetId]);
  if (keepConnectivity) next.connectivity = settings.connectivity;
  if (settings.titleScreen) next.titleScreen = { ...settings.titleScreen };
  if (settings.menuBeforePlay !== undefined) next.menuBeforePlay = settings.menuBeforePlay;
  return next;
};

/** True for an empty field (the conventional name) or a plain file name with an allowed extension. */
export const isTitleFileName = (field: keyof TitleScreenFiles, value: string) =>
  value === "" || TITLE_FILE_PATTERNS[field].test(value);

/** The draft with one title file name; an empty field removes it (and an empty object). */
export const withTitleFile = (settings: GameSettings, field: keyof TitleScreenFiles, value: string) => {
  const next = cloneGameSettings(settings);
  const files: TitleScreenFiles = { ...next.titleScreen, [field]: value.trim() || undefined };
  if (!files[field]) delete files[field];
  if (Object.keys(files).length) next.titleScreen = files;
  else delete next.titleScreen;
  return next;
};

export interface DraftIssues {
  blocking: boolean;
  messages: string[];
}

/** The draft's validation issues (English messages); errors block the save, warnings never do. */
export const draftIssues = (settings: GameSettings): DraftIssues => {
  const issues = checkGameSettings(settings);
  return { blocking: hasGameSettingsErrors(issues), messages: issues.map(formatGameSettingsIssue) };
};

/** Same document (key order ignored): the Save button stays disabled. */
export const sameSettings = (left: GameSettings, right: GameSettings) => isDeepEqual(left, right);
