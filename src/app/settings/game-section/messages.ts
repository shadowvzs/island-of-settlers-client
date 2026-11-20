import { msg } from "@lingui/core/macro";

/** Settings > Misc > Game (GS3b, SAVE-SLOTS, plan §7.6): Save, Load and Exit game wherever a title page exists. */
export const GAME_SECTION_MESSAGES = {
  exit: msg({ id: "settings.game.exit", message: "Exit game" }),
  exitConfirm: msg({ id: "settings.game.exitConfirm", message: "Save and exit" }),
  exitQuestion: msg({ id: "settings.game.exitQuestion", message: "Save the game and return to the title page?" }),
  leaveFailed: msg({ id: "settings.game.leaveFailed", message: "The game could not be left" }),
  leaveWithoutSaving: msg({ id: "settings.game.leaveWithoutSaving", message: "Leave without saving" }),
  leaving: msg({ id: "settings.game.leaving", message: "Leaving…" }),
  load: msg({ id: "settings.game.load", message: "Load a saved game" }),
  manualExitQuestion: msg({
    id: "settings.game.manualExitQuestion",
    message: "Automatic saving is off: progress since your last save is lost unless you save it to a slot."
  }),
  save: msg({ id: "settings.game.save", message: "Save the game to a slot" }),
  saveToSlot: msg({ id: "settings.game.saveToSlot", message: "Save to slot…" }),
  title: msg({ id: "settings.game.title", message: "Game" })
};
