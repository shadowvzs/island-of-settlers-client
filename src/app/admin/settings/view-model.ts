import type { I18n } from "@lingui/core";

import { GAME_SETTINGS_LIMITS } from "../../../../../island-of-settlers-shared/src/game-settings/constants";
import type {
  GameSettings, TitleScreenFiles
} from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  SETTING_DEPENDENCY_REASONS, settingAvailability
} from "../../../../../island-of-settlers-shared/src/game-settings/setting-availability";
import { translateMessage } from "../../../shared/i18n/translate";
import type { SettingsStore } from "../admin-ports";
import { ADMIN_MESSAGES as M } from "../messages";
import {
  AUTOSAVE_MINUTES_LIMITS, FEATURE_SWITCH_KEYS, MAX_FIXED_LEVEL, ONLINE_SWITCH_ORDER, PRESET_IDS, PRESET_NAMES,
  SWITCH_HINTS, TITLE_FILE_PLACEHOLDERS, TITLE_FILE_TEXTS
} from "./constants";
import {
  autosaveMinutes, type BooleanSettingKey, draftIssues, fixedLevelOf, isTitleFileName, rewardsChoice,
  showsAutosaveMinutes, type SwitchState,
switchState} from "./helpers";

/** Prepared, translated data of the Game settings tab (views render it and forward callbacks). */
export interface SwitchRowView extends SwitchState {
  /** What the switch does (tooltip while it is enabled); absent for self-explanatory switches. */
  hint?: string;
  label: string;
}

export interface ChoiceView<T> {
  disabled?: boolean;
  label: string;
  title?: string;
  value: T;
}

const hintOf = (i18n: I18n, key: BooleanSettingKey) => {
  const hint = SWITCH_HINTS[key as keyof typeof SWITCH_HINTS];
  return hint ? { hint: translateMessage(i18n, hint) } : {};
};

const switchRows = (i18n: I18n, settings: GameSettings, keys: readonly BooleanSettingKey[]): SwitchRowView[] =>
  keys.map(key => ({
    ...switchState(settings, key), ...hintOf(i18n, key), label: translateMessage(i18n, M.switches[key])
  }));

const afterMapChoices = (i18n: I18n, settings: GameSettings): ChoiceView<GameSettings["afterMap"]>[] => {
  const home = settingAvailability(settings, "afterMapHome");
  const homeReason = home.reason && SETTING_DEPENDENCY_REASONS[home.reason].en;
  return [
    { disabled: !home.enabled, label: translateMessage(i18n, M.fields.afterMapHome), title: homeReason,
      value: "home" },
    { label: translateMessage(i18n, M.fields.afterMapCampaignSelect), value: "campaignSelect" },
    { label: translateMessage(i18n, M.fields.afterMapExitChoice), value: "exitChoice" }
  ];
};

const playView = (i18n: I18n, settings: GameSettings) => ({
  afterMap: settings.afterMap,
  afterMapChoices: afterMapChoices(i18n, settings),
  afterMapLabel: translateMessage(i18n, M.fields.afterMap),
  autosave: switchRows(i18n, settings, ["autosave"])[0]!,
  autosaveMinutes: autosaveMinutes(settings),
  autosaveMinutesLabel: translateMessage(i18n, M.fields.autosaveMinutes, AUTOSAVE_MINUTES_LIMITS),
  autosaveMinutesLimits: AUTOSAVE_MINUTES_LIMITS,
  catchUpNote: translateMessage(i18n, M.fields.catchUpNote),
  connectivity: settings.connectivity,
  home: switchRows(i18n, settings, ["homeIsland"])[0]!,
  modeChoices: [
    { label: translateMessage(i18n, M.fields.modeOnline), value: "online" },
    { label: translateMessage(i18n, M.fields.modeOffline), value: "offline" }
  ] as ChoiceView<GameSettings["connectivity"]>[],
  modeLabel: translateMessage(i18n, M.fields.mode),
  showsAutosaveMinutes: showsAutosaveMinutes(settings),
  slots: switchRows(i18n, settings, ["slots"])[0]!,
  title: translateMessage(i18n, M.sections.play)
});

const progressionView = (i18n: I18n, settings: GameSettings) => ({
  fixedLevel: fixedLevelOf(settings),
  fixedLevelLabel: translateMessage(i18n, M.fields.fixedLevel, { max: MAX_FIXED_LEVEL }),
  levelChoices: [
    { label: translateMessage(i18n, M.fields.levelsEarned), value: "earned" },
    { label: translateMessage(i18n, M.fields.levelsFixed), value: "fixed" }
  ] as ChoiceView<"earned" | "fixed">[],
  levels: settings.progression.levels.kind,
  levelsLabel: translateMessage(i18n, M.fields.levels),
  maxFixedLevel: MAX_FIXED_LEVEL,
  rewardChoices: [
    { label: translateMessage(i18n, M.fields.rewardsAuto), value: "auto" },
    { label: translateMessage(i18n, M.fields.rewardsOn), value: "on" },
    { label: translateMessage(i18n, M.fields.rewardsOff), value: "off" }
  ] as ChoiceView<"auto" | "off" | "on">[],
  rewards: rewardsChoice(settings),
  rewardsLabel: translateMessage(i18n, M.fields.rewards),
  showsFixedLevel: settings.progression.levels.kind === "fixed",
  switches: switchRows(i18n, settings, ["experience", "talents"]),
  title: translateMessage(i18n, M.sections.progression)
});

export interface TitleFileFieldView {
  error: string;
  field: keyof TitleScreenFiles;
  hint: string;
  label: string;
  maxLength: number;
  placeholder: string;
  value: string;
}

const titleFileField = (
  i18n: I18n, settings: GameSettings, field: keyof TitleScreenFiles
): TitleFileFieldView => {
  const value = settings.titleScreen?.[field] ?? "";
  const texts = TITLE_FILE_TEXTS[field];
  return {
    error: isTitleFileName(field, value) ? "" : translateMessage(i18n, M.fields.titleFileInvalid),
    field,
    hint: translateMessage(i18n, texts.hint),
    label: translateMessage(i18n, texts.label),
    maxLength: GAME_SETTINGS_LIMITS.titleFileLength,
    placeholder: TITLE_FILE_PLACEHOLDERS[field],
    value
  };
};

const titlePageView = (i18n: I18n, settings: GameSettings) => ({
  fields: [titleFileField(i18n, settings, "background"), titleFileField(i18n, settings, "music")],
  // Forced on (checked, disabled, with the reason) without a home or offline.
  menuBeforePlay: switchRows(i18n, settings, ["menuBeforePlay"])[0]!,
  title: translateMessage(i18n, M.sections.titleScreen)
});

const presetViews = (i18n: I18n, store: SettingsStore) => PRESET_IDS.map(id => {
  const name = translateMessage(i18n, PRESET_NAMES[id]);
  const label = store === "server" ? M.footer.presetKeepsMode : M.footer.preset;
  return { id, label: translateMessage(i18n, label, { name }), name };
});

/** Everything the tab shows for the draft. */
export const settingsViewModel = (i18n: I18n, settings: GameSettings, store: SettingsStore) => ({
  features: {
    rows: switchRows(i18n, settings, FEATURE_SWITCH_KEYS), title: translateMessage(i18n, M.sections.features)
  },
  issues: draftIssues(settings),
  online: {
    rows: switchRows(i18n, settings, ONLINE_SWITCH_ORDER), title: translateMessage(i18n, M.sections.online)
  },
  play: playView(i18n, settings),
  presets: presetViews(i18n, store),
  progression: progressionView(i18n, settings),
  titlePage: titlePageView(i18n, settings)
});

export type SettingsViewModel = ReturnType<typeof settingsViewModel>;
export type PlayView = SettingsViewModel["play"];
export type ProgressionView = SettingsViewModel["progression"];
export type TitlePageView = SettingsViewModel["titlePage"];
