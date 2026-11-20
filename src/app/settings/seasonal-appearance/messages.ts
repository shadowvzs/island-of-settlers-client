import { msg } from "@lingui/core/macro";

export const SEASONAL_APPEARANCE_MESSAGES = {
  failed: msg({ id: "settings.season.failed", message: "The season could not be saved. Try again." }),
  ignore: msg({ id: "settings.season.ignore", message: "Ignore global season" }),
  ignoreHint: msg({
    id: "settings.season.ignoreHint",
    message: "Choose whether to ignore the administrator's global season. Naturally snowy islands stay snowy."
  }),
  ignoreNo: msg({ id: "settings.season.ignoreNo", message: "Ignore global season: No" }),
  ignoreYes: msg({ id: "settings.season.ignoreYes", message: "Ignore global season: Yes" }),
  saving: msg({ id: "account.settings.saving", message: "Saving…" }),
  title: msg({ id: "settings.appearance.title", message: "Appearance" }),
  unavailable: msg({
    id: "settings.season.unavailable", message: "Sign in to the online service to change the global season."
  })
} as const;

/** SEASONS S0 admin controls (English only; translations follow in the T1 card). */
export const GLOBAL_SEASON_MESSAGES = {
  autumn: msg({ id: "settings.season.autumn", message: "Autumn" }),
  fixedSeason: msg({ id: "settings.season.fixedSeason", message: "Fixed season" }),
  fixedSeasonHint: msg({
    id: "settings.season.fixedSeasonHint",
    message: "Shown while the season mode is None. Cycling modes follow the calendar instead."
  }),
  hint: msg({
    id: "settings.season.hint",
    message: "Cosmetic season for all players. Changes blend in gradually. Players can ignore it in Settings."
  }),
  mode: msg({ id: "settings.season.mode", message: "Season mode" }),
  modeFour: msg({ id: "settings.season.modeFour", message: "Four seasons" }),
  modeNone: msg({ id: "settings.season.modeNone", message: "None (fixed season)" }),
  modeTwo: msg({ id: "settings.season.modeTwo", message: "Dry and monsoon" }),
  monsoon: msg({ id: "settings.season.monsoon", message: "Monsoon" }),
  spring: msg({ id: "settings.season.spring", message: "Spring" }),
  summer: msg({ id: "settings.season.summer", message: "Summer" }),
  title: msg({ id: "settings.season.title", message: "Global season" }),
  transition: msg({ id: "settings.season.transition", message: "Change duration" }),
  transitionLong: msg({ id: "settings.season.transitionLong", message: "3 minutes" }),
  transitionShort: msg({ id: "settings.season.transitionShort", message: "30 seconds" }),
  winter: msg({ id: "settings.season.winter", message: "Winter" })
} as const;
