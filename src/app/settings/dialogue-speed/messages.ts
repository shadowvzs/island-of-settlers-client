import { msg } from "@lingui/core/macro";

export const DIALOGUE_SPEED_MESSAGES = {
  label: msg({ id: "settings.dialogueSpeed.label", message: "Dialogue speed" }),
  speeds: {
    fast: msg({ id: "settings.dialogueSpeed.fast", message: "Fast" }),
    normal: msg({ id: "settings.dialogueSpeed.normal", message: "Normal" }),
    slow: msg({ id: "settings.dialogueSpeed.slow", message: "Slow" })
  },
  title: msg({ id: "settings.dialogueSpeed.title", message: "Story dialogue" })
};
