/** The offline catch-up cap is shared with the server's away window (survey §5). */
export { OFFLINE_CATCH_UP_CAP_SECONDS } from "../../../../island-of-settlers-shared/src/offline-catch-up";

/** Owner2026-11-04: every positive gap uses maintained fast economy; native is diagnostic only. */
export const OFFLINE_FAST_AFTER_SECONDS = 0;

/**
 * Client catch-up only offers "Skip waiting and discard offline progress" after this much real time
 * (owner decision D15, 2026-10-23). Waiting remains the default.
 */
export const OFFLINE_SKIP_AFTER_MS = 60_000;
