import { msg } from "@lingui/core/macro";

export const SYSTEM_CURSOR_MESSAGES = {
  hint: msg({
    id: "settings.systemCursor.hint",
    message: "Use the operating system's mouse pointer instead of the game's gilded cursor."
  }),
  label: msg({ id: "settings.systemCursor.label", message: "System cursor" }),
  title: msg({ id: "settings.systemCursor.title", message: "Mouse cursor" })
};
