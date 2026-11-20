import {
  appendCommanderInput, COMMANDER_INPUT_METHOD, COMMANDER_INPUT_TICKS,
  type CommanderInputRun, isCommanderInput, packCommanderInput
} from "../../../../island-of-settlers-shared/src/commander-input";
import { COMMAND_LOG_LIMITS } from "../../../../island-of-settlers-shared/src/commands/command-limits";
import { FORMATS } from "../../../../island-of-settlers-shared/src/formats";
import {
  copyCommandArgs, copyCommandResult, REPLAY_COMMANDS, type ReplayCommandName
} from "./settlement-commands";
import type { SettlementSimulation } from "./settlement-simulation";
import type { SimulationStream } from "./simulation-random";

export const COMMAND_LOG_FORMAT = FORMATS.commandLog.id;
/** The counter checksum is kept every this many ticks (1 s) besides every command entry. */
export const CHECKSUM_EVERY_TICKS = 20;
const MAX_LOG_BYTES = COMMAND_LOG_LIMITS.logBytes;

/** One player command between ticks: `tick` is the island tick it ran at, `checksum` the state just before it. */
interface CommandLogEntry {
  /** v2: stable command/input order between the same two simulation ticks. */
  ordinal?: number;
  checksum: string;
  command: { args: unknown[]; name: ReplayCommandName; result?: unknown };
  /** The tick the player saw when issuing it (equals `tick` unless the island's ticks were held). */
  issuedTick: number;
  tick: number;
}

/**
 * One island's commands from a base snapshot to the next upload (D4.2), self-contained: the base snapshot's
 * revision (null when that snapshot never reached the server: the interval continues the previous one), its
 * tick, RNG states and counter checksum, and the build that ran it.
 */
export interface CommandLogInterval {
  baseChecksum: string;
  baseRevision: number | null;
  baseTick: number;
  /** [tick, counter checksum] every CHECKSUM_EVERY_TICKS ticks after the base. */
  checksums: [number, string][];
  endChecksum: string;
  /** Exact partial render-frame time at capture; no resource tick is represented by this remainder. */
  endAccumulator: number;
  endTick: number;
  entries: CommandLogEntry[];
  format: typeof COMMAND_LOG_FORMAT;
  /** Why the interval cannot be replayed exactly (limits, a failed reload): the server skips verifying it. */
  gaps?: string[];
  island: string;
  randomStates: [SimulationStream, number][];
  sourceVersion: string;
  version: 1 | 2;
  /** v2 only: bounded, run-length encoded already-applied commander inputs. */
  directInputs?: CommanderInputRun[];
}

type OpenInterval = Omit<CommandLogInterval, "endAccumulator" | "endChecksum" | "endTick" | "island">;

export interface CommandLogRecorderOptions {
  /** The tick the player saw (held frames); defaults to the island tick. */
  issuedTick?: () => number;
  sourceVersion: string;
}

const addGap = (interval: OpenInterval, gap: string) => {
  interval.gaps = [...new Set([...interval.gaps ?? [], gap])];
};

/**
 * Records the island's player commands tick-indexed between uploads. `open` starts an interval at the state the
 * client resumes from (the reloaded snapshot), `close` hands it over at the next capture; nothing is recorded in
 * between. Debug and test commands are recorded too: the server rejects them.
 */
export const createCommandLogRecorder = (simulation: SettlementSimulation, options: CommandLogRecorderOptions) => {
  const methods = simulation as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  let current: OpenInterval | null = null, bytes = 0, depth = 0, disposed = false;
  let ordinalTick = -1, nextOrdinal = 0, directTicks = 0;
  const takeOrdinal = () => {
    const tick = simulation.gameTick();
    if (ordinalTick !== tick) { ordinalTick = tick; nextOrdinal = 0; }
    return nextOrdinal++;
  };
  const unsubscribeTicks = simulation.observeTicks(() => {
    if (disposed || !current) return;
    const tick = simulation.gameTick();
    if ((tick - current.baseTick) % CHECKSUM_EVERY_TICKS === 0)
      current.checksums.push([tick, simulation.counterChecksum()]);
  });
  /** Commands that ran while no interval was open (between a capture and its snapshot reload). */
  let unrecorded = 0;
  const record = (name: ReplayCommandName, args: unknown[]) => {
    if (disposed) return null;
    if (!current) { unrecorded++; return null; }
    if (current.gaps?.length) return null;
    let copied: unknown[];
    try {
      const copy = copyCommandArgs(name, args);
      if (bytes + copy.bytes > MAX_LOG_BYTES || current.entries.length >= COMMAND_LOG_LIMITS.commandsPerInterval)
        throw new Error("limit");
      copied = copy.copied;
      bytes += copy.bytes;
    } catch {
      addGap(current, "Command log limit exceeded");
      return null;
    }
    const tick = simulation.gameTick();
    const ordinal = takeOrdinal();
    const entry: CommandLogEntry = { checksum: simulation.counterChecksum(), command: { args: copied, name },
      issuedTick: options.issuedTick?.() ?? tick, tick, ...(current.version === 2 ? { ordinal } : {}) };
    current.entries.push(entry);
    return entry;
  };
  for (const name of REPLAY_COMMANDS) {
    const method = methods[name];
    if (typeof method !== "function") continue;
    originals.set(name, method);
    methods[name] = (...args: unknown[]) => {
      // Only the outer command: one it calls through the public methods replays with it.
      const entry = depth ? null : record(name, args);
      depth++;
      let result: unknown;
      try { result = Reflect.apply(method, simulation, args); }
      finally { depth--; }
      if (!entry) return result;
      // The command stays replayable without its return value.
      const copiedResult = copyCommandResult(name, result);
      if (copiedResult !== undefined) entry.command.result = copiedResult;
      return result;
    };
  }
  const submitInput = methods[COMMANDER_INPUT_METHOD];
  if (typeof submitInput === "function") {
    originals.set(COMMANDER_INPUT_METHOD, submitInput);
    methods[COMMANDER_INPUT_METHOD] = (input: unknown) => {
      const ordinal = takeOrdinal(), tick = simulation.gameTick();
      let result: unknown;
      depth++;
      try { result = Reflect.apply(submitInput, simulation, [input]); }
      finally { depth--; }
      if (disposed || result !== true || !isCommanderInput(input)) return result;
      if (!current) { unrecorded++; return result; }
      if (current.gaps?.length) return result;
      if (++directTicks > COMMANDER_INPUT_TICKS + 1) {
        addGap(current, "Direct-input interval limit exceeded");
        return result;
      }
      if (current.version === 1) {
        let previousTick = -1, previousOrdinal = 0;
        for (const entry of current.entries) {
          if (entry.tick !== previousTick) { previousTick = entry.tick; previousOrdinal = 0; }
          entry.ordinal = previousOrdinal++;
        }
        current.version = 2;
        current.directInputs = [];
      }
      const previousRuns = current.directInputs!.length;
      if (!appendCommanderInput(current.directInputs!, tick, ordinal, packCommanderInput(input)))
        addGap(current, "Multiple direct inputs in one simulation tick");
      if (current.directInputs!.length > previousRuns) bytes += 160;
      if (bytes > MAX_LOG_BYTES) addGap(current, "Direct-input byte limit exceeded");
      return result;
    };
  }
  return {
    /**
     * Stops recording and removes the tick listener and command wrappers. Safe on island teardown;
     * a later `open`/`close`/`capture` cannot reopen the departed interval.
     */
    dispose: () => {
      if (disposed) return;
      disposed = true;
      current = null;
      unsubscribeTicks();
      for (const [name, method] of originals) methods[name] = method;
      originals.clear();
      bytes = 0;
      unrecorded = 0;
      ordinalTick = -1; nextOrdinal = 0; directTicks = 0;
    },
    /**
     * Starts an interval at the island's current state (just loaded, or reloaded from the uploaded snapshot); the
     * save store names the base revision when it uploads it.
     */
    open: (gaps?: string[]) => {
      if (disposed) return;
      bytes = 0;
      unrecorded = 0;
      current = { baseChecksum: simulation.counterChecksum(), baseRevision: null, baseTick: simulation.gameTick(),
        checksums: [], entries: [], format: COMMAND_LOG_FORMAT,
        randomStates: simulation.randomAudit().states(), sourceVersion: options.sourceVersion, version: 1,
        ...gaps?.length ? { gaps: [...gaps] } : {} };
    },
    /** Ends the interval of `island` at the current tick (the captured snapshot); null when none was open. */
    close: (island: string): CommandLogInterval | null => {
      if (disposed) return null;
      const interval = current;
      current = null;
      if (!interval) return null;
      return { ...interval, endAccumulator: simulation.frameAccumulator(),
        endChecksum: simulation.counterChecksum(), endTick: simulation.gameTick(), island };
    },
    recording: () => !disposed && current !== null,
    /** A command changed the island since the last `close`: reloading the captured snapshot would undo it. */
    changedSinceClose: () => !disposed && unrecorded > 0
  };
};
