import { msg } from "@lingui/core/macro";

export const COMMANDER_UI_MESSAGES = {
  enter: msg({ id: "commander.control.enter", message: "Control commander" }),
  preparing: msg({ id: "commander.control.preparing", message: "Commander is leaving the lodge" }),
  health: msg({ id: "commander.control.health", message: "{hp} / {maximum} HP" })
};
