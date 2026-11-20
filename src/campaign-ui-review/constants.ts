export const REVIEW_VIEWS = [
  "intro", "intro-replay", "epilogue-success", "epilogue-failure", "epilogue-pending", "speaker", "speaker-fallback",
  "speaker-actor",
  "settings", "epilogue-rewards", "reward-gallery", "reward-popup", "level-up-popup", "multiboard"
] as const;

/** Trees planted when the multiboard review opens without a `planted` value (the design's "3 / 8"). */
export const DEFAULT_REVIEW_PLANTED = 3;
/** The longest head start of the review's hold countdown (`timer=<seconds>`): the hold timer's whole duration. */
export const MAX_REVIEW_COUNTDOWN_SECONDS = 300;
/** The multiboard review looks through player 1's eyes; its script random stream has a fixed seed. */
export const REVIEW_VIEWER_FACTION = 0;
export const REVIEW_SCRIPT_SEED = 7;

/** Retrying a failed claim shows the pending state, then the granted result (a stand-in for the C12 claim). */
export const RETRY_DEMO_MS = 1200;

/** Keys that advance the review dialogue (the in-game cinematic input lock uses the same ones). */
export const REVIEW_ADVANCE_CODES: ReadonlySet<string> = new Set(["Enter", "NumpadEnter", "Space"]);
