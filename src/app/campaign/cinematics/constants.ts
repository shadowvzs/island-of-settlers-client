/** Campaign cinematics presentation constants (CIN2 camera/shake, CIN3 sequence player). */

/** Shake at strength 1: yaw and pitch (radians), camera-space shift (world units), noise frequencies (rad/s). */
export const SHAKE_YAW = 0.018;
export const SHAKE_PITCH = 0.014;
export const SHAKE_SHIFT_X = 0.35;
export const SHAKE_SHIFT_Y = 0.25;
export const SHAKE_FREQUENCIES: readonly number[] = [19, 31, 47];
/** Time offsets (s) that decorrelate the four shake channels, and the phase step between harmonics. */
export const SHAKE_CHANNEL_OFFSETS = { pitch: 3.1, x: 7.3, y: 11.9, yaw: 0 } as const;
export const SHAKE_HARMONIC_PHASE = 1.7;

/** Letterbox: a 2.0:1 crop in landscape; in portrait each bar takes at most 6 % of the height. */
export const LETTERBOX_ASPECT = 2;
export const LETTERBOX_PORTRAIT_SHARE = 0.06;
export const PERCENT = 100;

/** The presentation clock never advances by more than this per frame (a hidden-tab resume). */
export const MAX_FRAME_SECONDS = 0.1;
export const MS_PER_SECOND = 1000;

/** Field of view of a shot without its own (the perspective rig's 30 degrees). */
export const DEFAULT_SHOT_FOV = (30 * Math.PI) / 180;
/** The automatic close of a sequence that left cinematic mode on: restore blend and letterbox slide-out. */
export const AUTO_CLOSE_MS = 500;
/** Two presses skip: the first arms the prompt for this long (plan section 3.5). */
export const SKIP_CONFIRM_MS = 3000;
/** Several strikes of one lightning step follow each other this far apart. */
export const LIGHTNING_REPEAT_MS = 220;
/** A queued sequence's priority: outcomes (victory/defeat) preempt and drop pending story sequences. */
export const SEQUENCE_PRIORITY = Object.freeze({ outcome: "outcome", story: "story" } as const);

/** Keys the cinematic input lock acts on; every other key is kept from the game while a sequence plays. */
export const CINEMATIC_SKIP_CODES: ReadonlySet<string> = new Set(["Escape"]);
export const CINEMATIC_ADVANCE_CODES: ReadonlySet<string> = new Set(["Enter", "NumpadEnter"]);
/** Space advances a shown line, otherwise it counts as a skip press. */
export const CINEMATIC_ADVANCE_OR_SKIP_CODES: ReadonlySet<string> = new Set(["Space"]);
/** Pointer/touch events the lock swallows on the map viewport (capture phase). */
export const CINEMATIC_LOCKED_POINTER_EVENTS = [
  "pointerdown", "pointermove", "pointerup", "pointercancel", "click", "dblclick", "contextmenu", "wheel",
  "mousedown", "mouseup", "mousemove", "touchstart", "touchmove", "touchend"
] as const;
/** Marks cinematic UI (speaker panel, skip prompt) that keeps its own pointer input during the lock. */
export const CINEMATIC_UI_SELECTOR = "[data-cinematic-ui]";

/**
 * Portrait image id of a script actor that speaks under its display name, by look ("actor-portrait:pirates").
 * No such image ships yet, so the speaker panel shows its initials medallion; the real portraits will resolve
 * these ids (owner 2026-11-13).
 */
export const ACTOR_PORTRAIT_ID_PREFIX = "actor-portrait:";
/** The portrait id key of a placed actor (it has no look of its own). */
export const PLACED_ACTOR_PORTRAIT_KEY = "placed";
