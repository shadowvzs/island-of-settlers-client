import type { CommanderProfile, CommanderUnit } from "./commander-types";

/** Factions start their first cycle a quarter interval apart, so their decisions fall on different ticks. */
const CLOCK_SLOTS = 4;
const ascending = (first: number, second: number) => first - second;

interface CommanderClockSources {
  factions?: () => readonly number[];
  profile: (faction: number) => CommanderProfile;
  units: () => readonly CommanderUnit[];
}

/**
 * Decision clocks of the computer factions: each decides once per `decisionInterval` seconds of its
 * profile. The interval is read once per decision cycle. The clocks are saved; every array is reused.
 */
export const createCommanderClocks = ({ factions, profile, units }: CommanderClockSources) => {
  const clocks = new Map<number, number>();
  /** The interval of each faction's running cycle (derived, not saved). */
  const intervals = new Map<number, number>();
  const presentScratch: number[] = [],
    dueScratch: number[] = [];

  const addPresent = (faction: number) => {
    if (faction > 0 && !presentScratch.includes(faction)) presentScratch.push(faction);
  };
  /** The computer factions with field soldiers this tick, unique and ascending. */
  const present = (): readonly number[] => {
    presentScratch.length = 0;
    if (factions) for (const faction of factions()) addPresent(faction);
    else for (const unit of units()) addPresent(unit.faction);
    presentScratch.sort(ascending);
    return presentScratch;
  };
  const intervalOf = (faction: number) => {
    let interval = intervals.get(faction);
    if (interval === undefined) intervals.set(faction, (interval = profile(faction).decisionInterval));
    return interval;
  };
  /** Advances the clock of every present faction; returns the factions that decide this tick. */
  const advance = (present: readonly number[], dt: number): readonly number[] => {
    dueScratch.length = 0;
    for (const faction of present) {
      const interval = intervalOf(faction);
      const clock = (clocks.get(faction) ?? (interval * (faction % CLOCK_SLOTS)) / CLOCK_SLOTS) + dt;
      clocks.set(faction, clock >= interval ? 0 : clock);
      if (clock < interval) continue;
      dueScratch.push(faction);
      intervals.delete(faction);
    }
    return dueScratch;
  };
  const clear = () => {
    clocks.clear();
    intervals.clear();
  };
  return {
    advance,
    clear,
    present,
    restore: (saved: readonly [number, number][] | undefined) => {
      clear();
      for (const [faction, clock] of saved ?? []) clocks.set(faction, clock);
    },
    save: (): [number, number][] => [...clocks]
  };
};
