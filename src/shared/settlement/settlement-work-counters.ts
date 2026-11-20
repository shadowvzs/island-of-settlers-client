import type { SettlementContext } from "./settlement-types";

/** Deterministic work counters for traffic budgets: CI gates on these, never on wall time. */
interface SettlementWorkCounters {
  /** Straight-leg static proofs a carrier actually computed. */
  carrierSegmentChecks: number;
  /** Straight-leg proofs a carrier reused because nothing relevant changed. */
  carrierSegmentSkips: number;
  /** Actor visits made by the doorway animation pass. */
  doorActivityVisits: number;
  /** Reservation waiters that made no route progress for more than ten seconds. */
  stuckButExempt: number;
  /** Owner watchdog escalations: blockers asked to clear, reservations released. */
  watchdogClears: number;
  watchdogReleases: number;
}

const counters = new WeakMap<SettlementContext, SettlementWorkCounters>();

export const settlementWorkCounters = (context: SettlementContext) => {
  let value = counters.get(context);
  if (!value) {
    value = {
      carrierSegmentChecks: 0,
      carrierSegmentSkips: 0,
      doorActivityVisits: 0,
      stuckButExempt: 0,
      watchdogClears: 0,
      watchdogReleases: 0
    };
    counters.set(context, value);
  }
  return value;
};
