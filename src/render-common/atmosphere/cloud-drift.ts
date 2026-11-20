/**
 * Possessed-sky cloud drift: wind speed multipliers of the lower cumulus layer and the high cirrus
 * (exploration-cloud-motion.ts; the TSL sky port takes the same numbers). The cloud clock runs at a
 * third of real time, so the lower layer moves at |wind| × lower / 3 metres per second.
 * TOOL-8 reference tuner (docs/plans/ref-tuner-2026-11-17.md): real-time static cumulus clips drifted
 * 0.35–0.6° per second (60° lens assumed); the game's look-up view measured 0.04° per second with the
 * old multiplier 6 (about 2 m/s at 1–2.5 km), so the clouds looked painted on, and 0.26° per second
 * with 45. 60 gives about 17 m/s in clear weather (about 0.34° per second, the calm end of the clips);
 * the cirrus keeps its 1 : 6 ratio.
 */
export const EXPLORATION_CLOUD_DRIFT = {
  lower: 60,
  upper: 10
} as const;
