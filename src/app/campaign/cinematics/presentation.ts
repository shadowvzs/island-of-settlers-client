/**
 * CIN3/CIN5 presentation channels of the sequence player. `ui` changes rarely (a speak page, the skip prompt) and
 * feeds React through `useSyncExternalStore`; `visual` (letterbox and fade amounts) changes every frame of a ramp
 * and is written straight into element styles by its subscriber, so no React render runs per frame.
 */
import type {
  CampaignSpeaker, CinematicStepOf
} from "../../../../../island-of-settlers-shared/src/campaign/cinematics/types";
import { createExternalStore, type ReadableStore } from "../../components/ui-store";

export type CinematicSpeakLine = CinematicStepOf<"speak">;
export type CinematicFadeColor = "black" | "white";

/** The shown speak page: `lineIndex` indexes `lines` (the sequence's speak steps in order). */
export interface CinematicSpeech {
  lineIndex: number;
  pageIndex: number;
  /** `leaving` while the panel slides out after a line's last page. */
  phase: "leaving" | "playing";
}

export interface CinematicUiState {
  /** Cinematic mode is on (the layer shows; the HUD is hidden). */
  active: boolean;
  fadeColor: CinematicFadeColor;
  lines: readonly CinematicSpeakLine[];
  /** The first skip press armed the "press again" prompt. */
  skipPrompt: boolean;
  speakers: readonly CampaignSpeaker[];
  speech: CinematicSpeech | null;
}

export interface CinematicVisualState {
  /** 0 clear .. 1 fully covered in `fadeColor`. */
  fade: number;
  /** 0 hidden .. 1 fully slid-in bars. */
  letterbox: number;
}

const IDLE_UI: CinematicUiState = Object.freeze({
  active: false, fadeColor: "black", lines: [], skipPrompt: false, speakers: [], speech: null
});
const IDLE_VISUAL: CinematicVisualState = Object.freeze({ fade: 0, letterbox: 0 });

const sameSpeech = (left: CinematicSpeech | null, right: CinematicSpeech | null) =>
  left === right || (left !== null && right !== null && left.lineIndex === right.lineIndex &&
    left.pageIndex === right.pageIndex && left.phase === right.phase);

const changed = (current: CinematicUiState, patch: Partial<CinematicUiState>) =>
  (Object.keys(patch) as (keyof CinematicUiState)[]).some(key => {
    if (key === "speech") return !sameSpeech(current.speech, patch.speech ?? null);
    return !Object.is(current[key], patch[key]);
  });

export const createCinematicPresentation = () => {
  const ui = createExternalStore<CinematicUiState>(IDLE_UI);
  const visual = createExternalStore<CinematicVisualState>(IDLE_VISUAL);
  return {
    reset: () => {
      ui.set(IDLE_UI);
      visual.set(IDLE_VISUAL);
    },
    setUi: (patch: Partial<CinematicUiState>) => {
      const current = ui.getSnapshot();
      if (changed(current, patch)) ui.set({ ...current, ...patch });
    },
    setVisual: (fade: number, letterbox: number) => {
      const current = visual.getSnapshot();
      if (current.fade !== fade || current.letterbox !== letterbox) visual.set({ fade, letterbox });
    },
    ui: ui as ReadableStore<CinematicUiState>,
    visual: visual as ReadableStore<CinematicVisualState>
  };
};

export type CinematicPresentation = ReturnType<typeof createCinematicPresentation>;
