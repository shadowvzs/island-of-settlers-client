import { useExternalStore } from "../../components/external-store";
import { dialogueMsPerChar, dialogueSpeedPreference } from "./preference";

/** The chosen dialogue speed and its setter (Settings > Misc). */
export const useDialogueSpeed = () => ({
  onSpeedChange: dialogueSpeedPreference.setSpeed,
  speed: useExternalStore(dialogueSpeedPreference)
});

/** Reading time per character of the chosen dialogue speed, for the speaker panel. */
export const useDialogueMsPerChar = () => dialogueMsPerChar(useExternalStore(dialogueSpeedPreference));
