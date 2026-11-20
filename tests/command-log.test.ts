import { describe, expect, it } from "vitest";

import { CHECKSUM_EVERY_TICKS, createCommandLogRecorder } from "../src/shared/settlement/command-log";
import { replayCommandLog } from "../src/shared/settlement/command-log-replay";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { hashNumbers } from "../src/shared/settlement/settlement-state-hash";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const createWorld = () => {
  const size = 48;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

const createIsland = (state?: SettlementSaveV1) => {
  const world = createWorld(), roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ clockStart: 0, initialSettlers: 20, initialStock: {},
    resourceTargets: () => [], roads, world });
  if (state && !simulation.loadState(state).ok) throw new Error("load failed");
  return simulation;
};

const ticks = (simulation: ReturnType<typeof createIsland>, count: number) => {
  for (let index = 0; index < count; index++) simulation.update(0.05);
};

/** A played interval: its base snapshot and the log the client recorded. */
const playInterval = () => {
  const simulation = createIsland();
  ticks(simulation, 7);
  const base = simulation.saveState();
  simulation.loadState(base);
  const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
  recorder.open();
  ticks(simulation, 13);
  simulation.grantDebugTroop();
  ticks(simulation, 30);
  simulation.grantDebugTroop();
  ticks(simulation, 11);
  return { base, interval: recorder.close("home")!, recorder };
};

describe("command log intervals (D4.2)", () => {
  it("hashes integer counters identically and distinguishes them", () => {
    expect(hashNumbers([1, 2, 3])).toBe(hashNumbers([1, 2, 3]));
    expect(hashNumbers([1, 2, 3])).not.toBe(hashNumbers([1, 2, 4]));
    expect(hashNumbers([2 ** 40])).not.toBe(hashNumbers([0]));
  });

  it("records tick-indexed commands with checksums and a self-contained header", () => {
    const { interval, recorder } = playInterval();
    expect(recorder.recording()).toBe(false);
    expect(interval).toMatchObject({ baseRevision: null, baseTick: 7, endTick: 61, island: "home", sourceVersion: "test" });
    expect(interval.entries.map(entry => [entry.tick, entry.issuedTick, entry.command.name])).toEqual([
      [20, 20, "grantDebugTroop"], [50, 50, "grantDebugTroop"]
    ]);
    expect(interval.checksums.map(([tick]) => tick)).toEqual([27, 47]);
    expect(CHECKSUM_EVERY_TICKS).toBe(20);
    expect(interval.randomStates.map(([stream]) => stream)).toEqual(["forester", "military"]);
  });

  it("an honest replay from the base reproduces every checksum", () => {
    const { base, interval } = playInterval();
    expect(replayCommandLog(createIsland(base), interval, { rejectDebug: false })).toEqual({ ok: true,
      endChecksum: interval.endChecksum });
  });

  it("finds a forged command and refuses debug commands in production", () => {
    const { base, interval } = playInterval();
    const forged = structuredClone(interval);
    forged.entries[1]!.command.args = [{ rank: 2, type: "archer" }];
    expect(replayCommandLog(createIsland(base), forged, { rejectDebug: false })).toMatchObject({ ok: false,
      mismatch: { kind: "end", tick: 61 } });
    expect(replayCommandLog(createIsland(base), interval)).toMatchObject({ ok: false,
      mismatch: { kind: "invalid", reason: "Rejected command grantDebugTroop" } });
  });

  it("records debug nation changes separately and rejects them for ordinary server replay", () => {
    const simulation = createIsland(), base = simulation.saveState();
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "debug-nation" });
    recorder.open();
    expect(simulation.debugSetPlayerNation("persian")).toBe(true);
    const interval = recorder.close("home")!;
    expect(interval.entries.some(entry => entry.command.name === "debugSetPlayerNation")).toBe(true);
    expect(replayCommandLog(createIsland(base), interval)).toMatchObject({ ok: false,
      mismatch: { kind: "invalid", reason: "Rejected command debugSetPlayerNation" } });
    expect(replayCommandLog(createIsland(base), interval, { rejectDebug: false }).ok).toBe(true);
    recorder.dispose();
  });

  it("disposes the recorder, restores command methods and refuses to reopen", () => {
    const simulation = createIsland();
    const originalGrant = simulation.grantCoins;
    const recorder = createCommandLogRecorder(simulation, { sourceVersion: "test" });
    recorder.open();
    expect(recorder.recording()).toBe(true);
    recorder.dispose();
    expect(recorder.recording()).toBe(false);
    expect(recorder.close("home")).toBeNull();
    expect(recorder.changedSinceClose()).toBe(false);
    expect(simulation.grantCoins).toBe(originalGrant);
    recorder.open();
    expect(recorder.recording()).toBe(false);
    recorder.dispose();
  });
});
