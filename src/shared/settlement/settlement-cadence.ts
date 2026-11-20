import type { SettlementContext } from "./settlement-types";

/**
 * SIM-CADENCE (owner 2026-11-10): re-checks that can safely wait run on a quarter-second cadence,
 * five fixed 50 ms ticks. Slots read the saved game-clock tick and the actor uid, so a save/load
 * mid-cadence continues on the same slots and the work of a crowd spreads over every tick.
 */
export const QUARTER_SECOND_TICKS = 5;

/** The saved whole-tick counter; bare fixtures without a game clock have none. */
export const cadenceTick = (context: SettlementContext) => context.clock?.tick();

/**
 * Whether this tick is `uid`'s staggered slot of a `period`-tick cadence. Without a game clock
 * (bare fixtures) every tick is a slot, i.e. the former every-tick behaviour.
 */
export const isCadenceSlot = (context: SettlementContext, uid: number, period = QUARTER_SECOND_TICKS) => {
  const tick = cadenceTick(context);
  if (tick === undefined) return true;
  return ((tick + uid) % period + period) % period === 0;
};
