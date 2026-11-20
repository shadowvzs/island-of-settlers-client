import { msg } from "@lingui/core/macro";

/** Main selection > Customization window, its nation avatar and gender face radios. */
export const CUSTOMIZATION_MESSAGES = {
  avatar: msg({ id: "settings.customization.avatar", message: "Avatar" }),
  changeConfirmed: msg({ id: "settings.customization.changeConfirmed",
    message: "Your nation change was confirmed. Reload the game to finish applying it." }),
  changeFailed: msg({
    id: "settings.customization.changeFailed",
    message: "The nation could not be changed. Your previous avatar is kept."
  }),
  changePending: msg({ id: "settings.customization.changePending",
    message: "Waiting for the server to confirm the nation change. Retry to continue." }),
  changingNation: msg({ id: "settings.customization.changingNation", message: "Changing the nation…" }),
  gender: msg({ id: "settings.customization.gender", message: "Gender" }),
  genderName: {
    female: msg({ id: "settings.customization.genderName.female", message: "Female" }),
    male: msg({ id: "settings.customization.genderName.male", message: "Male" })
  },
  genderOption: {
    female: msg({
      id: "settings.customization.gender.female",
      message: "Female avatar: {nation}"
    }),
    male: msg({
      id: "settings.customization.gender.male",
      message: "Male avatar: {nation}"
    })
  },
  help: msg({
    id: "settings.customization.help",
    message: "The chosen face and body appear on your HUD portrait and when you explore the island."
  }),
  localOnly: msg({
    id: "settings.customization.localOnly",
    message: "The choice is saved on this device, but your account could not be updated."
  }),
  nation: msg({ id: "settings.customization.nation", message: "Nation" }),
  window: {
    loadFailed: msg({
      id: "settings.customization.window.loadFailed",
      message: "The customization window could not load. Close and reopen to retry."
    }),
    loading: msg({ id: "settings.customization.window.loading", message: "Loading avatar choices…" })
  }
} as const;
