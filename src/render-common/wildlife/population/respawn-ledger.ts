import { TICK_SECONDS } from "../../../../../island-of-settlers-shared/src/time/constants";

/** Seconds before a missing animal of a region is born: 5 minutes (owner 2026-10-12, D-S2). */
export const RESPAWN_SECONDS = 300;
/** Seconds before a failed placement (no valid hidden spot yet) is tried again. */
export const RETRY_SECONDS = 3;
export const RESPAWN_TICKS = Math.round(RESPAWN_SECONDS / TICK_SECONDS);
export const RETRY_TICKS = Math.round(RETRY_SECONDS / TICK_SECONDS);

/** What resolving a due entry did: a new animal, no valid spot yet, or no longer wanted. */
export type LedgerOutcome = "drop" | "retry" | "spawned";

/**
 * The respawn ledger: one entry per missing animal of a region (killed, harvested, left, or
 * capacity that grew), each due RESPAWN_TICKS after it was scheduled. Entries keep their order;
 * the latest-due surplus is dropped when a region's target shrinks.
 */
export const createRespawnLedger = () => {
  const regions: number[] = [];
  const dueTicks: number[] = [];

  const pending = (region: number) => {
    let count = 0;
    for (const entry of regions) if (entry === region) count += 1;
    return count;
  };

  const schedule = (region: number, dueTick: number) => {
    regions.push(region);
    dueTicks.push(dueTick);
  };

  const removeLatest = (region: number, count: number) => {
    for (let removed = 0; removed < count; removed += 1) {
      let latest = -1;
      for (let index = 0; index < regions.length; index += 1) {
        if (regions[index] !== region) continue;
        if (latest < 0 || dueTicks[index]! >= dueTicks[latest]!) latest = index;
      }
      if (latest < 0) return;
      regions.splice(latest, 1);
      dueTicks.splice(latest, 1);
    }
  };

  /** The region's entries follow its target: new ones 5 minutes out, surplus ones dropped. */
  const reconcile = (region: number, target: number, population: number, tick: number) => {
    const wanted = target - population - pending(region);
    if (wanted > 0) {
      for (let entry = 0; entry < wanted; entry += 1) schedule(region, tick + RESPAWN_TICKS);
      return;
    }
    if (wanted < 0) removeLatest(region, -wanted);
  };

  /**
   * Resolves the due entries in order, at most `limit` of them (the rest stay due for the next
   * call); a retry waits RETRY_TICKS, the others leave the ledger.
   */
  const resolve = (tick: number, attempt: (region: number) => LedgerOutcome, limit = Infinity) => {
    let attempts = 0;
    for (let index = 0; index < regions.length && attempts < limit; index += 1) {
      if (dueTicks[index]! > tick) continue;
      attempts += 1;
      const outcome = attempt(regions[index]!);
      if (outcome === "retry") {
        dueTicks[index] = tick + RETRY_TICKS;
        continue;
      }
      regions.splice(index, 1);
      dueTicks.splice(index, 1);
      index -= 1;
    }
  };

  const load = (savedRegions: ArrayLike<number>, savedDueTicks: ArrayLike<number>) => {
    regions.length = 0;
    dueTicks.length = 0;
    for (let index = 0; index < savedRegions.length; index += 1) {
      schedule(savedRegions[index]!, savedDueTicks[index]!);
    }
  };

  return {
    count: () => regions.length,
    dueTick: (index: number) => dueTicks[index]!,
    load,
    pending,
    reconcile,
    region: (index: number) => regions[index]!,
    resolve,
    save: () => ({ dueTicks: Int32Array.from(dueTicks), regions: Int32Array.from(regions) }),
    schedule
  };
};

export type RespawnLedger = ReturnType<typeof createRespawnLedger>;
