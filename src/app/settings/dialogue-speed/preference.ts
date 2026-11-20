import { DIALOGUE_SPEED_MS_PER_CHAR } from "../../../../../island-of-settlers-shared/src/campaign/cinematics/constants";
import { createExternalStore } from "../../components/ui-store";
import { rawTextCodec } from "../../preferences/codecs";
import { PREFERENCES } from "../../preferences/keys";
import { definePreference } from "../../preferences/registry";
import { DEFAULT_DIALOGUE_SPEED, DIALOGUE_SPEEDS } from "./constants";

const storedDialogueSpeed = definePreference(PREFERENCES.dialogueSpeed, rawTextCodec);

export type DialogueSpeed = (typeof DIALOGUE_SPEEDS)[number];

export const isDialogueSpeed = (value: unknown): value is DialogueSpeed =>
  (DIALOGUE_SPEEDS as readonly unknown[]).includes(value);

/** A stored choice, or Normal for nothing / an unknown value. */
export const parseDialogueSpeed = (stored: string | null): DialogueSpeed =>
  isDialogueSpeed(stored) ? stored : DEFAULT_DIALOGUE_SPEED;

/** Speaker line reading time per character (CIN1 section 3.6): only `msPerChar` scales, never the base. */
export const dialogueMsPerChar = (speed: DialogueSpeed) => DIALOGUE_SPEED_MS_PER_CHAR[speed];

/** Settings > Misc "Dialogue speed"; a per-browser preference like the notification switch. */
export const createDialogueSpeedPreference = (stored: string | null, persist: (value: DialogueSpeed) => void) => {
  const store = createExternalStore(parseDialogueSpeed(stored));
  return {
    getSnapshot: store.getSnapshot,
    setSpeed: (speed: DialogueSpeed) => {
      if (speed === store.getSnapshot()) return;
      persist(speed);
      store.set(speed);
    },
    subscribe: store.subscribe
  };
};

export const dialogueSpeedPreference = createDialogueSpeedPreference(
  storedDialogueSpeed.read(),
  speed => { storedDialogueSpeed.write(speed); }
);
