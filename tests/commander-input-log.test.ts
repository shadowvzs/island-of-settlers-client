import { describe, expect, it } from "vitest";

import {
  appendCommanderInput, type CommanderInput, type CommanderInputRun, commanderInputTrackProblem,
  isCommanderInput, packCommanderInput
} from "../../island-of-settlers-shared/src/commander-input";
import { createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";

const intent = (forward = 10): CommanderInput => ({
  generation: 1, forward, right: 0, heading: 0, pitch: 0, buttons: 0
});
/** Protocol fixture: order-sensitive state and per-tick inputs, independent of combat/renderer fixtures. */
const protocolSimulation = () => {
  let tick = 0, total = 1, lastInputTick = -1, held = intent(0);
  const listeners = new Set<() => void>();
  const simulation = {
    gameTick: () => tick,
    frameAccumulator: () => 0,
    restoreReplayAccumulator: (value: unknown, atTick: number) => value === 0 && atTick === tick,
    counterChecksum: () => `${total}:${held.forward}:${held.heading}`,
    randomAudit: () => ({ states: () => [] }),
    observeTicks: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    selectMilitary: () => { total *= 2; },
    submitCommanderInput: (input: CommanderInput) => {
      if (!isCommanderInput(input) || lastInputTick === tick) return false;
      lastInputTick = tick; held = { ...input }; return true;
    },
    update: () => { total += held.forward; tick++; for (const listener of listeners) listener(); }
  };
  return { simulation, cast: simulation as unknown as SettlementSimulation, listeners };
};

describe("bounded versioned commander input logs", () => {
  it("compresses ten minutes of already-applied input and replays every tick without command-limit gaps", () => {
    const source = protocolSimulation(), recorder = createCommandLogRecorder(source.cast, { sourceVersion: "abc" });
    recorder.open();
    for (let tick = 0; tick < 12_000; tick++) {
      expect(source.simulation.submitCommanderInput(intent())).toBe(true);
      source.simulation.update();
    }
    const log = recorder.close("home")!;
    expect(log.version).toBe(2);
    expect(log.endAccumulator).toBe(0);
    expect(log.entries).toEqual([]);
    expect(log.gaps).toBeUndefined();
    expect(log.directInputs).toEqual([{ tick: 0, ordinal: 0, ticks: 12_000, input: packCommanderInput(intent()) }]);
    const target = protocolSimulation();
    expect(replayCommandLog(target.cast, log)).toMatchObject({ ok: true });
    expect(target.simulation.counterChecksum()).toBe(source.simulation.counterChecksum());
    recorder.dispose();
    expect(source.listeners.size).toBe(0);
  });

  it("preserves ordinary-command order before and after input at the same tick", () => {
    const source = protocolSimulation(), recorder = createCommandLogRecorder(source.cast, { sourceVersion: "abc" });
    recorder.open();
    source.simulation.selectMilitary();
    source.simulation.submitCommanderInput(intent());
    source.simulation.selectMilitary();
    source.simulation.update();
    source.simulation.selectMilitary();
    source.simulation.submitCommanderInput(intent(20));
    source.simulation.update();
    source.simulation.submitCommanderInput(intent(20));
    source.simulation.update();
    const log = recorder.close("home")!;
    expect(log.entries.map(entry => [entry.tick, entry.ordinal])).toEqual([[0, 0], [0, 2], [1, 0]]);
    expect(log.directInputs?.map(run => [run.tick, run.ordinal, run.ticks])).toEqual([[0, 1, 1], [1, 1, 2]]);
    const target = protocolSimulation();
    expect(replayCommandLog(target.cast, log)).toMatchObject({ ok: true });
    expect(target.simulation.counterChecksum()).toBe(source.simulation.counterChecksum());
  });

  it("retains v1 for ordinary play and restores the exact input function on disposal", () => {
    const source = protocolSimulation(), original = source.simulation.submitCommanderInput;
    const recorder = createCommandLogRecorder(source.cast, { sourceVersion: "abc" });
    recorder.open(); source.simulation.selectMilitary();
    const log = recorder.close("home")!;
    expect(log.version).toBe(1); expect(log.directInputs).toBeUndefined();
    recorder.dispose();
    expect(source.simulation.submitCommanderInput).toBe(original);
  });

  it("refuses overlapping/future inputs, duplicated ordinals, action-edge replay and decompression bombs", () => {
    const run = (): CommanderInputRun => ({ tick: 10, ordinal: 0, ticks: 10, input: packCommanderInput(intent()) });
    for (const runs of [[run(), run()], [{ ...run(), ticks: 1000 }],
      [{ ...run(), input: [1, 128, 0, 0, 0, 0] }], [{ ...run(), ticks: 1e12 }],
      [{ ...run(), input: [1, 0, 0, 0, 0, 4] }], [null]])
      expect(commanderInputTrackProblem(runs, 0, 100)).not.toBeNull();
    expect(commanderInputTrackProblem([run()], 0, 100, [{ tick: 15, ordinal: 0 }])).not.toBeNull();
    expect(commanderInputTrackProblem([run()], 0, 100, [{ tick: 10, ordinal: 1 }])).toBeNull();
    expect(commanderInputTrackProblem([run()], 0, 100, [{ tick: 5, ordinal: 1 }, { tick: 5, ordinal: 1 }]))
      .not.toBeNull();
  });

  it("retains a single horse-action edge rather than lengthening it into repeated actions", () => {
    const runs: CommanderInputRun[] = [], edge = packCommanderInput({ ...intent(), buttons: 8 });
    appendCommanderInput(runs, 0, 0, edge); appendCommanderInput(runs, 1, 0, edge);
    expect(runs.map(run => run.ticks)).toEqual([1, 1]);
    expect(appendCommanderInput(runs, 1, 1, edge)).toBe(false);
  });
});
