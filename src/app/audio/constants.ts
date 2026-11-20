/** Cue ids a cinematic `sound` step may use (CIN6; the Ready context's `soundCueIds`). */
export const CINEMATIC_SOUND_CUE_IDS = ["thunder", "victory-fanfare"] as const;

/** Music player track id prefix of an uploaded map audio asset (`upload:<assetId>`). */
export const UPLOADED_TRACK_ID_PREFIX = "upload:";
/** Synthesized cues start this long after the request (scheduling headroom, seconds). */
export const CUE_START_DELAY_SECONDS = 0.05;
/** Level of a creature call cue against the other effects. */
export const CREATURE_CUE_GAIN = 0.6;
/** Script sounds playing at once; further ones are dropped (a trigger loop must not stack voices). */
export const SCRIPT_SOUND_VOICE_LIMIT = 4;
/** Milliseconds per second (script audio fades are authored in seconds). */
export const MS_PER_SECOND = 1000;
/** The catalog sound of a first garrison occupation. */
export const GARRISON_TRUMPET_SOUND_ID = "sound:garrisonTrumpet";
