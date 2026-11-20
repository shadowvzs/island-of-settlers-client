import type { PackedCommanderInput } from "../../../../island-of-settlers-shared/src/commander-input";
import type { CommandLogInterval } from "./command-log";

type Entry = CommandLogInterval["entries"][number];
export type CommandLogEvent = { tick: number; command: Entry } | { tick: number; input: PackedCommanderInput };

/** Bounded streaming merge: do not allocate an expanded tick/event array for untrusted logs. */
export const commandLogEvents = function* (interval: CommandLogInterval): Generator<CommandLogEvent> {
  const runs = interval.directInputs ?? [];
  let entryIndex = 0, runIndex = 0, runOffset = 0;
  while (entryIndex < interval.entries.length || runIndex < runs.length) {
    const entry = interval.entries[entryIndex], run = runs[runIndex];
    const inputTick = run ? run.tick + runOffset : Infinity;
    const inputOrdinal = runOffset ? 0 : run?.ordinal ?? Infinity;
    if (entry && (entry.tick < inputTick || (entry.tick === inputTick && (entry.ordinal ?? 0) < inputOrdinal))) {
      yield { tick: entry.tick, command: entry };
      entryIndex++;
    } else if (run) {
      yield { tick: inputTick, input: run.input };
      if (++runOffset >= run.ticks) { runOffset = 0; runIndex++; }
    }
  }
};
