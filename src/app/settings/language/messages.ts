import { msg } from "@lingui/core/macro";

/** The language panel stays available while the public Hungarian journey is gated. */
export const LANGUAGE_MESSAGES = {
  apply: msg({ id: "settings.language.apply", message: "Apply language" }),
  help: msg({
    id: "settings.language.help",
    message: "Some parts of the interface are translated. The rest remains in English while translation is in progress."
  }),
  label: msg({ id: "settings.window.language", message: "Language" }),
  status: {
    selected: msg({ id: "settings.language.status.selected", message: "Selected: {language}." }),
    unsaved: msg({
      id: "settings.language.status.unsaved",
      message: "Language selected for this tab. Your browser could not save the preference."
    })
  },
  window: {
    loadFailed: msg({
      id: "settings.language.window.loadFailed",
      message: "The language settings could not load. Close and reopen to retry."
    }),
    loading: msg({ id: "settings.language.window.loading", message: "Loading language settings…" })
  }
} as const;
