import { OFFLINE_FAST_AFTER_SECONDS } from "../../shared/balance/offline";
import type { OfflineReplayOptions } from "./offline-progress";

/** One policy for browser, island travel and server replay. Explicit reference/experiment lanes remain available. */
export const shouldUseOfflineEconomy = (awaySeconds: number, options: OfflineReplayOptions = {}) => {
  if (options.exact || options.eventCore || options.eventMovement || options.corridorReservations ||
    options.quietSkip || options.movementSkip) return false;
  if (options.economy !== undefined) return options.economy;
  if (options.measured || options.analytic || options.chronological === true) return false;
  return Number.isFinite(awaySeconds) && awaySeconds > OFFLINE_FAST_AFTER_SECONDS;
};
