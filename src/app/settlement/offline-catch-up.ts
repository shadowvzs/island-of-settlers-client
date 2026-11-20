import type { SettlementOptions } from "../../shared/settlement/settlement-types";
import { createOfflineChainJumps, OFFLINE_JUMP_WINDOW_SECONDS, type OfflineChainJumpOptions } from "./offline-chain-jumps";
import { createOfflineFastForward, OFFLINE_WINDOW_SECONDS } from "./offline-fast-forward";

/**
 * How offline time is caught up: every fixed tick (the default); explicit experimental measured
 * steady skips; or analytic chain jumps (opt-in: seconds per week, less accurate on fast-growing
 * islands).
 */
export type OfflineCatchUpMode = "analytic" | "exact" | "measured";

/**
 * How a multi-island replay orders its islands: live sessions advanced together in common game-time
 * slices, or the legacy home-first sequence where each island is replayed to the end in turn.
 */
export type OfflineChronology = "coordinated" | "sequential";

/** The measured analytic model is only accepted for absences up to this many game seconds. */
export const ANALYTIC_MAX_SECONDS = 3_600;

export interface OfflineCatchUpOptions extends OfflineChainJumpOptions {
  /** Real ticked game seconds a measured catch-up aims to spend on this island. */
  exactBudgetSeconds: number;
}

/** Post-jump verification of the measured lane. */
export interface MeasuredMetrics {
  /** Skips rejected by the next exact window (measured mode then stays exact). */
  failed: number;
  /** The first rejected difference, as actual vs predicted-over-the-window values. */
  lastFailure?: Record<string, { actual: number; predicted: number }>;
  /** Skipped stretches applied. */
  skips: number;
  /** Skips accepted by the next exact window. */
  verified: number;
}

/** One catch-up strategy behind the replay loop's hooks. */
export interface OfflineCatchUp {
  /** A finished production cycle (the simulation's hook). */
  cycle: NonNullable<SettlementOptions["onProductionCycle"]>;
  /**
   * Measured lane only: set once a skip failed its post-jump verification. The replay then stays in
   * exact ticks for the rest of the island's window and reports the reason.
   */
  fallbackReason?: () => "measured-divergence" | undefined;
  /** Measured lane post-jump verification counters (skips, passes, failures). */
  measuredMetrics?: () => MeasuredMetrics;
  /** A finished product (the simulation's hook). */
  produced: (ware: string) => void;
  start: () => void;
  /** After every real tick. */
  ticked: (elapsed: number, step: number) => void;
  /** Closes a window; returns the game seconds skipped or jumped (0: keep ticking). */
  windowEnd: (elapsed: number, remaining: number) => number;
  /** Real ticked game seconds between two window ends. */
  windowSeconds: number;
}

const ignore = () => {};

export const createOfflineCatchUp = (
  mode: OfflineCatchUpMode, options: OfflineCatchUpOptions
): OfflineCatchUp | undefined => {
  if (mode === "exact") return undefined;
  if (mode === "analytic") {
    const jumps = createOfflineChainJumps(options);
    return { ...jumps, produced: ignore, windowSeconds: OFFLINE_JUMP_WINDOW_SECONDS };
  }
  const skips = createOfflineFastForward(options);
  return { cycle: ignore, fallbackReason: skips.fallbackReason, measuredMetrics: skips.metrics,
    produced: skips.countProduced, start: skips.start, ticked: ignore,
    windowEnd: skips.windowEnd, windowSeconds: OFFLINE_WINDOW_SECONDS };
};
