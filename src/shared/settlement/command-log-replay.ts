import {
  COMMANDER_INPUT_METHOD, commanderInputTrackProblem, unpackCommanderInput
} from "../../../../island-of-settlers-shared/src/commander-input";
import { COMMAND_LOG_LIMITS } from "../../../../island-of-settlers-shared/src/commands/command-limits";
import { recordedCommandProblem } from "../../../../island-of-settlers-shared/src/commands/command-rules";
import { validFrameAccumulator } from "../../../../island-of-settlers-shared/src/simulation-frame-remainder";
import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import {
  CHECKSUM_EVERY_TICKS, COMMAND_LOG_FORMAT, type CommandLogInterval
} from "./command-log";
import { commandLogEvents } from "./command-log-events";
import { applyRecordedCommand } from "./settlement-commands";
import type { SettlementSimulation } from "./settlement-simulation";

/** Where a replay first disagreed with the log: the first differing checksum, a refused command, a bad log. */
export interface CommandLogMismatch {
  actual?: string;
  expected?: string;
  kind: "base" | "checksum" | "command" | "end" | "invalid" | "snapshot";
  reason?: string;
  tick: number;
}

export type CommandLogReplayResult = { endChecksum: string; ok: true } | { mismatch: CommandLogMismatch; ok: false };

const intervalProblem = (interval: CommandLogInterval, rejectDebug: boolean): string | null => {
  if (interval.format !== COMMAND_LOG_FORMAT || ![1, 2].includes(interval.version)) return "Unsupported command log";
  if (!validFrameAccumulator(interval.endAccumulator)) return "Invalid frame accumulator";
  if (!Array.isArray(interval.entries) || interval.entries.length > COMMAND_LOG_LIMITS.commandsPerInterval) return "Invalid command count";
  if (interval.version === 1 && interval.directInputs !== undefined) return "Direct inputs require log v2";
  if (interval.version === 2) {
    const problem = commanderInputTrackProblem(interval.directInputs, interval.baseTick, interval.endTick, interval.entries);
    if (problem) return problem;
  }
  if (!Number.isSafeInteger(interval.baseTick) || !Number.isSafeInteger(interval.endTick) ||
    interval.endTick < interval.baseTick || interval.endTick - interval.baseTick > COMMAND_LOG_LIMITS.intervalTicks)
    return "Invalid command log ticks";
  let previous = interval.baseTick;
  for (const entry of interval.entries) {
    // Unknown names, wrong argument shapes and (production) development commands (phase C §4).
    const commandProblem = recordedCommandProblem(entry.command, !rejectDebug);
    if (commandProblem) return commandProblem;
    if (!Number.isSafeInteger(entry.tick) || entry.tick < previous || entry.tick > interval.endTick)
      return "Invalid command tick";
    previous = entry.tick;
  }
  return null;
};

/**
 * Replays one interval on an island restored from its base (D4.3): ticks run one by one (`update(0.05)`),
 * commands run between ticks at their logged tick, and every logged counter checksum is compared. Returns the first
 * mismatch; `untilEnd` keeps playing to the interval's end after it (so the draw trails of both runs can be diffed).
 */
interface ReplayOptions {
  /**
   * The arguments a command runs with; default the logged ones. The server verifier passes its own copy of the
   * game rules an `adoptGameRules` names (GS2), so a client cannot inject other rules under a known revision.
   */
  argsOf?: (entry: CommandLogInterval["entries"][number]) => readonly unknown[];
  rejectDebug?: boolean;
  untilEnd?: boolean;
  validateCommand?: (entry: CommandLogInterval["entries"][number]) => string | undefined;
}
export const replayCommandLog = (
  simulation: SettlementSimulation, interval: CommandLogInterval,
  { argsOf, rejectDebug = true, untilEnd = false, validateCommand }: ReplayOptions = {}
): CommandLogReplayResult => {
  const invalid = intervalProblem(interval, rejectDebug);
  if (invalid) return { mismatch: { kind: "invalid", reason: invalid, tick: interval.baseTick }, ok: false };
  if (interval.directInputs?.length && typeof (simulation as unknown as Record<string, unknown>)[COMMANDER_INPUT_METHOD] !== "function")
    return { mismatch: { kind: "invalid", reason: "Direct input is unavailable in this simulation", tick: interval.baseTick }, ok: false };
  if (simulation.gameTick() !== interval.baseTick)
    return { mismatch: { kind: "base", reason: "Base tick differs", tick: simulation.gameTick() }, ok: false };
  let first: CommandLogMismatch | null = null;
  /** Records a mismatch; true when the replay should stop. */
  const check = (kind: CommandLogMismatch["kind"], expected: string, reason?: string) => {
    const actual = simulation.counterChecksum();
    if (actual === expected && !reason) return false;
    first ??= { actual, expected, kind, tick: simulation.gameTick(), ...reason ? { reason } : {} };
    return !untilEnd;
  };
  const expectedChecksums = new Map(interval.checksums);
  const advanceTo = (tick: number) => {
    while (simulation.gameTick() < tick) {
      simulation.update(TICK_SECONDS);
      const now = simulation.gameTick();
      const expected = (now - interval.baseTick) % CHECKSUM_EVERY_TICKS === 0 && expectedChecksums.get(now);
      if (expected && check("checksum", expected)) return true;
    }
    return false;
  };
  const methods = simulation as unknown as Record<string, (...args: unknown[]) => unknown>;
  const result = (): CommandLogReplayResult =>
    first ? { mismatch: first, ok: false } : { endChecksum: interval.endChecksum, ok: true };
  if (check("base", interval.baseChecksum)) return result();
  for (const event of commandLogEvents(interval)) {
    if ("input" in event) {
      if (advanceTo(event.tick)) return result();
      const accepted = methods[COMMANDER_INPUT_METHOD]!(unpackCommanderInput(event.input));
      if (accepted !== true && check("command", simulation.counterChecksum(), "Refused direct input")) return result();
      continue;
    }
    const entry = event.command;
    if (advanceTo(entry.tick) || check("command", entry.checksum)) return result();
    const problem = validateCommand?.(entry);
    if (problem) {
      if (check("command", entry.checksum, problem)) return result();
      continue;
    }
    if (typeof methods[entry.command.name] !== "function") {
      if (check("command", entry.checksum, `Unavailable command ${entry.command.name}`)) return result();
      continue;
    }
    applyRecordedCommand(simulation, entry.command.name, argsOf?.(entry) ?? entry.command.args);
  }
  if (!advanceTo(interval.endTick)) check("end", interval.endChecksum);
  // Tick-indexed logs cannot infer the browser's final partial frame from fixed-step work.
  // Restore only that strictly bounded metadata at the already-replayed exact tick. The full
  // endpoint hash still attests every saved field, including the unchanged authoritative clocks.
  if (!simulation.restoreReplayAccumulator(interval.endAccumulator, interval.endTick))
    first ??= { kind: "invalid", reason: "Invalid frame accumulator endpoint", tick: simulation.gameTick() };
  return result();
};
