import type { OfflineReplayFlags } from "../../src/app/settlement/offline-progress";

/** Acceptance lanes of the offline catch-up; mirrors tools/analysis/offline-progress-cost.ts. */
export const OFFLINE_REPLAY_MODES = [
  "measured", "exact", "event-core", "executor", "quiet", "movement", "chronological", "economy"
] as const;
export type OfflineReplayMode = (typeof OFFLINE_REPLAY_MODES)[number];

export const replayFlags = (mode: OfflineReplayMode): OfflineReplayFlags => {
  if (mode === "economy") return { economy: true };
  // `exact` is the fixed-tick reference; disable event-core auto explicitly.
  if (mode === "exact") return { exact: true, eventCore: false };
  if (mode === "event-core") return { eventCore: true };
  if (mode === "executor") return { corridorReservations: true, eventMovement: true, exact: true, eventCore: false };
  if (mode === "quiet") return { quietSkip: true };
  if (mode === "movement") return { movementSkip: true };
  if (mode === "chronological") return { chronological: true, exact: true, eventCore: false };
  // `measured` is the explicit experimental opt-in; exact is the default.
  return { measured: true };
};
