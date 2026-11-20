import {
  COMMAND_LOG_LIMITS, MAX_COMMAND_ARGS_BYTES
} from "../../../../island-of-settlers-shared/src/commands/command-limits";
import {
  recordedCommandProblem, WORLD_MUTATING_COMMANDS
} from "../../../../island-of-settlers-shared/src/commands/command-rules";
import { FORMATS } from "../../../../island-of-settlers-shared/src/formats";
import type { GameSaveV1 } from "./game-save";
import { createReplayDiagnostics, type ReplayDiagnostics } from "./replay-diagnostics";
import type { ReplaySceneEvent, ReplaySceneJournal } from "./replay-scene";
import { isSafeTree, SAVE_TREE_DEPTH } from "./save-validation";
import {
  applyRecordedCommand, copyArgs, copyCommandArgs, copyCommandResult, fillRandomDebugChoice, REPLAY_COMMANDS,
  type ReplayCommandName
} from "./settlement-commands";
import type { SettlementSaveV1 } from "./settlement-save-state";
import type { SettlementSimulation } from "./settlement-simulation";
import type { TrafficWorkCounters } from "./settlement-traffic-counters";

export interface BugReplayReport {
  format: typeof FORMATS.bugReplay.id;
  version: typeof FORMATS.bugReplay.current;
  sourceVersion: string;
  baseline: GameSaveV1;
  elapsed: number;
  updates?: number[];
  commands: { at: number; name: string; args: unknown[]; result?: unknown }[];
  finalSettlement: SettlementSaveV1;
  limited: boolean;
  gaps?: string[];
  diagnostics?: ReplayDiagnostics;
  versions?: Record<string, string>;
  scene?: ReplaySceneEvent[];
}
/** Commands per recording (the shared command-log interval bound). */
const LIMIT = COMMAND_LOG_LIMITS.commandsPerInterval;

/** Replays settlement commands only; visual/editor/account actions and cross-island visits need scene context. */
export const replaySettlementCommands = (
  report: BugReplayReport,
  simulation: SettlementSimulation,
  onResultMismatch?: (command: BugReplayReport["commands"][number], actual: unknown) => void,
  beforeFinalSnapshot?: () => void,
  afterCommand?: () => void
) => {
  if (!isSafeTree(report, SAVE_TREE_DEPTH.bugReplay) || JSON.stringify(report).length > 64 * 1024 * 1024 ||
    !Array.isArray(report.commands) || report.commands.some(command => !Array.isArray(command.args) ||
      JSON.stringify(command.args).length > MAX_COMMAND_ARGS_BYTES))
    throw new Error("Invalid or oversized replay report");
  const methods = simulation as unknown as Record<string, unknown>;
  let elapsed = 0, updateIndex = 0;
  const boundaries = report.updates && new Set([0]);
  if (report.updates) { let at = 0; for (const dt of report.updates) { at += dt; boundaries!.add(at); } }
  if (report.updates && (report.updates.length > 100_000 || report.updates.some(dt =>
    !Number.isFinite(dt) || dt <= 0 || dt > 1) ||
    Math.abs(report.updates.reduce((sum, dt) => sum + dt, 0) - report.elapsed) > 1e-7))
    throw new Error("Invalid replay update schedule");
  const advance = (until: number) => {
    if (!Number.isFinite(until) || until < elapsed || until > 3600)
      throw new Error("Invalid replay time");
    while (until - elapsed > 1e-8) {
      const step = report.updates ? report.updates[updateIndex++]! : Math.min(0.05, until - elapsed);
      if (!Number.isFinite(step) || step > until - elapsed + 1e-7) throw new Error("Command occurs inside a replay update");
      simulation.update(step);
      elapsed += step;
    }
  };
  if (report.commands.length > LIMIT) throw new Error("Replay command limit exceeded");
  for (const command of report.commands) {
    if (recordedCommandProblem(command, true)) throw new Error("Unsupported replay command");
    if (!Number.isFinite(command.at) || command.at < elapsed || command.at > report.elapsed || report.elapsed > 3600)
      throw new Error("Invalid replay time");
    if (boundaries && !boundaries.has(command.at)) throw new Error("Command occurs inside a replay update");
    if (typeof methods[command.name] !== "function") throw new Error("Replay command unavailable");
    elapsed = command.at;
  }
  if (!Number.isFinite(report.elapsed) || report.elapsed < elapsed || report.elapsed > 3600)
    throw new Error("Invalid replay time");
  elapsed = 0;
  // The baseline player's talents were on the island when the recording began.
  if (report.baseline.player?.talents) simulation.setTalentRanks(report.baseline.player.talents);
  for (const command of report.commands) {
    if (typeof methods[command.name] !== "function") throw new Error("Replay command unavailable");
    advance(command.at);
    const result = applyRecordedCommand(simulation, command.name as ReplayCommandName, command.args);
    afterCommand?.();
    if ("result" in command && JSON.stringify(command.result) !== JSON.stringify(copyArgs([result])[0]))
      onResultMismatch?.(command, result);
  }
  advance(report.elapsed);
  beforeFinalSnapshot?.();
  return simulation.saveState();
};

/** Recording is opt-in and bounded. Capture the baseline once, never a whole save every tick. */
export const createBugReplayRecorder = (
  simulation: SettlementSimulation,
  sourceVersion: string,
  versions?: Record<string, string>,
  scene?: ReplaySceneJournal
) => {
  const methods = simulation as unknown as Record<string, unknown>;
  let state: {
    baseline?: GameSaveV1;
    commands: BugReplayReport["commands"];
    elapsed: number;
    updates: number[];
    recording: boolean;
    limited: boolean;
    finalSettlement?: SettlementSaveV1;
    gaps?: string[];
    diagnostics: ReturnType<typeof createReplayDiagnostics>;
    bytes: number;
    navigationAt?: number;
  } | null = null;
  let disposed = false, commandDepth = 0, commandWorldDirty = false, updateDepth = 0;
  scene?.scopeToSimulation(() => commandDepth > 0 || updateDepth > 0);
  const freeze = (limited = false) => {
    if (!state || state.finalSettlement) return;
    state.recording = false;
    scene?.stop();
    if (scene?.overflow()) {
      state.gaps = [...new Set([...(state.gaps ?? []), "Scene observation journal limit exceeded"])];
      limited = true;
    }
    state.limited ||= limited;
    state.finalSettlement = structuredClone(simulation.saveState());
  };
  const originals = new Map<string, unknown>();
  if (scene) {
    const update = simulation.update;
    originals.set("update", update);
    simulation.update = dt => {
      if (!state?.recording) return update(dt);
      updateDepth++;
      try { return update(dt); }
      finally { updateDepth--; }
    };
  }
  for (const name of REPLAY_COMMANDS) {
    const method = methods[name];
    if (typeof method !== "function") continue;
    originals.set(name, method);
    methods[name] = (...args: unknown[]) => {
      const current = state;
      if (!current?.recording) return Reflect.apply(method, simulation, args);
      fillRandomDebugChoice(name, args);
      let copied: unknown[];
      try {
        const copy = copyCommandArgs(name, args);
        if (current.bytes + copy.bytes > COMMAND_LOG_LIMITS.logBytes) throw new Error("Command journal too large");
        copied = copy.copied;
        current.bytes += copy.bytes;
      } catch {
        // End before the unrecordable mutation, preserving a replayable prefix.
        freeze(true);
        return Reflect.apply(method, simulation, args);
      }
      const command: BugReplayReport["commands"][number] = { at: current.elapsed, name, args: copied };
      current.commands.push(command);
      const started = performance.now();
      commandDepth++;
      commandWorldDirty ||= WORLD_MUTATING_COMMANDS.has(name);
      try {
        const result = Reflect.apply(method, simulation, args);
        // The command remains replayable even when its return value cannot be copied.
        const copiedResult = copyCommandResult(name, result);
        if (copiedResult !== undefined) command.result = copiedResult;
        return result;
      } finally {
        commandDepth--;
        // One outer command observation, even when its callbacks invoke another wrapped method.
        if (!commandDepth && commandWorldDirty) { commandWorldDirty = false; scene?.afterCommand(); }
        current.diagnostics.command(name, performance.now() - started);
        if (current.commands.length >= LIMIT) freeze(true);
      }
    };
  }
  // These public mutations cannot be represented by the scalar command journal.
  for (const [name, reason] of [
    ["debugRaiseBuildingSteps", "Direct debug-build iterator: recording stopped before unjournalled search advances"],
    ["loadState", "External settlement restore: recording stopped before the state replacement"]
  ] as const) {
    const method = methods[name]; if (typeof method !== "function") continue;
    originals.set(name, method);
    methods[name] = (...args: unknown[]) => {
      if (state?.recording) { state.gaps = [reason]; freeze(true); }
      return Reflect.apply(method, simulation, args);
    };
  }
  return {
    advance: (dt: number, milliseconds?: number, work?: Partial<TrafficWorkCounters>) => {
      if (!state?.recording || !Number.isFinite(dt) || dt <= 0) return;
      const step = Math.min(dt, 1);
      state.updates.push(step);
      state.elapsed += step;
      if (milliseconds !== undefined) state.diagnostics.step(state.elapsed, milliseconds, work);
      if (simulation.navigationDiagnostics && state.elapsed >= (state.navigationAt ?? 0)) {
        state.diagnostics.navigation(state.elapsed, simulation.navigationDiagnostics());
        state.navigationAt = state.elapsed + 1;
      }
      if (scene?.overflow()) { state.gaps = ["Scene observation journal limit exceeded"]; freeze(true); }
      if (state.elapsed >= 3599 || state.updates.length >= 100_000) freeze(true);
    },
    start: async (capture: () => Promise<GameSaveV1>) => {
      if (disposed) throw new Error("Recorder disposed");
      if (state?.recording || (state && !state.baseline)) throw new Error("A reproduction is already recording");
      const next: NonNullable<typeof state> = { commands: [], updates: [], elapsed: 0, recording: true, limited: false,
        diagnostics: createReplayDiagnostics(), bytes: 0 };
      state = next;
      try {
        // Freeze season/calendar-dependent offers into the captured baseline before travel orders.
        simulation.colonyIslands?.();
        simulation.adventureIslands?.();
        // Capture must snapshot synchronously before its first await (compression runs later).
        scene?.begin();
        const baseline = await capture();
        if (disposed || state !== next) throw new Error("Recording cancelled");
        next.baseline = baseline;
      } catch (error) {
        if (state === next) { state = null; scene?.stop(); }
        throw error;
      }
    },
    recording: () => state?.recording ?? false,
    unsupported: (action: string) => {
      if (!state?.recording) return;
      state.gaps = [action.slice(0, 160)];
      freeze(true);
    },
    report: (): BugReplayReport => {
      if (!state?.baseline) throw new Error("Start recording a reproduction first");
      freeze();
      return {
        format: FORMATS.bugReplay.id,
        version: FORMATS.bugReplay.current,
        sourceVersion,
        baseline: structuredClone(state.baseline),
        commands: structuredClone(state.commands),
        elapsed: state.elapsed,
        updates: [...state.updates],
        diagnostics: state.diagnostics.snapshot(),
        ...(scene ? { scene: scene.snapshot() } : {}),
        ...(versions ? { versions: { ...versions } } : {}),
        finalSettlement: structuredClone(state.finalSettlement!),
        limited: state.limited,
        ...(state.gaps ? { gaps: [...state.gaps] } : {})
      };
    },
    dispose: () => {
      disposed = true;
      scene?.stop();
      for (const [name, method] of originals) methods[name] = method;
      scene?.scopeToSimulation();
      state = null;
    }
  };
};
