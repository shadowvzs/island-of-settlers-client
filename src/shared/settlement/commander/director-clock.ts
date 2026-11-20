import { DIRECTOR_SLOTS } from "../../balance/commander-director";
import type { DirectorFaction } from "./director-types";

/**
 * Director cadence (A14 plan §5.1, §8): a faction decides once per `interval` ticks of its profile (plan §7) on
 * its own slot of the interval (`faction % 8` eighths, in whole ticks), on absolute game ticks, so the schedule
 * survives a save and a skip. At most one director decision runs per tick: when two factions are due together,
 * the earlier due tick and then the lower faction decides, the other on the next tick.
 */

/**
 * The first tick after `now` on the faction's slot: `slots` factions share an interval (the director's eighths; the
 * economy AI's quarters, enemy economy AI plan §3.3).
 */
export const firstDueTick = (faction: number, now: number, interval: number, slots = DIRECTOR_SLOTS) => {
  const slot = Math.floor((faction % slots) * interval / slots);
  const phase = ((now + 1 - slot) % interval + interval) % interval;
  return now + 1 + (phase === 0 ? 0 : interval - phase);
};

/** The faction that decides at `now` (factions ascend), or undefined. */
export const dueFaction = (factions: readonly DirectorFaction[], now: number) => {
  let due: DirectorFaction | undefined;
  for (const entry of factions)
    if (entry.next <= now && (!due || entry.next < due.next)) due = entry;
  return due;
};

/** The tick one interval after the slot `due`; a tick already passed (a long gap) restarts from `now`. */
const nextDueTick = (due: number, now: number, interval: number) =>
  due + interval > now ? due + interval : now + interval;

/** Schedules the faction's next decision one interval after the slot it was due on. */
export const scheduleNext = (entry: DirectorFaction, now: number, interval: number) => {
  entry.next = nextDueTick(entry.next, now, interval);
};
