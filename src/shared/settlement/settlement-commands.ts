import type { CommandName } from "../../../../island-of-settlers-shared/src/commands/command-manifest";
import {
  COMMAND_NAMES, commandSizeLimits, commandSpec
} from "../../../../island-of-settlers-shared/src/commands/command-rules";
import { randomDebugEnemy } from "./settlement-debug-enemy";
import { randomDebugTroop } from "./settlement-debug-troop";
import type { SettlementSimulation } from "./settlement-simulation";

/**
 * The client side of the shared command manifest (`island-of-settlers-shared/src/commands`): the recorded
 * commands as `SettlementSimulation` method names, their argument/result copies and the replay dispatch.
 * Only explicit player commands: never wrap queries, save/load or per-frame internals.
 */
export const REPLAY_COMMANDS = COMMAND_NAMES satisfies readonly (keyof SettlementSimulation)[];

export type ReplayCommandName = CommandName;

/** JSON copies of command arguments (`undefined` kept as a marker the replay restores). */
export const copyArgs = (args: unknown[]) =>
  JSON.parse(
    JSON.stringify(args.map((value) => (value === undefined ? { $undefined: true } : value)))
  ) as unknown[];

export const restoreArg = (value: unknown) =>
  value && typeof value === "object" && Object.keys(value).length === 1 && "$undefined" in value
    ? undefined
    : value;

/** The recordable copy of `args` and its JSON size; throws when they cannot be copied or exceed the size class. */
export const copyCommandArgs = (name: ReplayCommandName, args: unknown[]) => {
  const copied = copyArgs(args);
  const bytes = JSON.stringify(copied).length;
  if (bytes > commandSizeLimits(name).argsBytes) throw new Error("Command arguments too large");
  return { bytes, copied };
};

/** The recordable copy of a command's return value; undefined when it cannot be copied or is too large. */
export const copyCommandResult = (name: ReplayCommandName, result: unknown): unknown => {
  try {
    const copied = copyArgs([result])[0];
    return JSON.stringify(copied).length <= commandSizeLimits(name).resultBytes ? copied : undefined;
  } catch {
    return undefined;
  }
};

const RANDOM_CHOICE_ROLLS = {
  enemy: () => randomDebugEnemy(Math.random),
  troop: () => randomDebugTroop(Math.random)
} as const;

/** Debug commands that roll a random choice fill it into their argument first, so a replay repeats it. */
export const fillRandomDebugChoice = (name: ReplayCommandName, args: unknown[]) => {
  const choice = commandSpec(name).randomChoice;
  if (!choice || args[choice.arg] !== undefined) return;
  args[choice.arg] = RANDOM_CHOICE_ROLLS[choice.kind]();
};

/** Runs a logged command (arguments as stored) on `simulation`, through any recorder wrapper installed on it. */
export const applyRecordedCommand = (
  simulation: SettlementSimulation, name: ReplayCommandName, storedArgs: readonly unknown[]
): unknown => {
  const method = simulation[name] as (...args: unknown[]) => unknown;
  return Reflect.apply(method, simulation, storedArgs.map(restoreArg));
};
