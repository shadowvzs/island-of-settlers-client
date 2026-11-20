import { beforeAll, describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { runHeadlessReplay } from "../src/app/settlement/headless-replay";
import { canWorkerEnterBuildingPlot } from "../src/app/settlement/island-simulation-hooks";
import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { type BugReplayReport, createBugReplayRecorder } from "../src/shared/settlement/bug-replay";
import { FORESTER_TYPE_ID, WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { determinismIslandSave } from "./helpers/determinism-island";

const SLOW_TIMEOUT = 300_000;
const STEP = .05;
const HASH_EVERY = 50;
/** The snapshot a server would verify from: a multiple of HASH_EVERY ticks into the recording. */
const SNAPSHOT_UPDATES = 600;

/** Records play in Node with the bug-replay recorder: the same journal the browser exports. */
const recordFixture = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(structuredClone(save)), { world } = loaded.map;
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: canWorkerEnterBuildingPlot, roads,
    stockContact: createIslandStockContacts(world), world });
  expect(simulation.loadState(loaded.settlement).ok).toBe(true);
  const recorder = createBugReplayRecorder(simulation, "determinism-test");
  await recorder.start(async () => save);
  const play = (updates: number) => {
    for (let index = 0; index < updates; index++) { simulation.update(STEP); recorder.advance(STEP); }
  };
  const build = (type: number, x: number, z: number) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const placed = simulation.placeBuilding(type, x + width / 2, z + depth / 2);
    expect(placed.ok, placed.reason).toBe(true);
    expect(simulation.connectRoads(simulation.headquarters.access, placed.building!.access)).toBe(true);
  };
  play(10);
  build(WOODCUTTER_TYPE_ID, 34, 30);
  play(400);
  build(FORESTER_TYPE_ID, 34, 40);
  // Commands after the snapshot: the resumed replay must apply them at the same tick.
  play(SNAPSHOT_UPDATES - 410 + 40);
  simulation.setProductionPaused(simulation.buildings()[1]!.uid, true);
  play(200);
  simulation.setProductionPaused(simulation.buildings()[1]!.uid, false);
  play(560);
  const report = recorder.report();
  recorder.dispose();
  return report;
};

/** Sums like the replay does (same order), so rebased command times hit exact update boundaries. */
const boundaryTimes = (updates: readonly number[]) => {
  const times = [0];
  let elapsed = 0;
  for (const dt of updates) { elapsed += dt; times.push(elapsed); }
  return times;
};

/** The recording from update `cut` on, starting at a snapshot taken there. */
const suffixReport = (report: BugReplayReport, cut: number, baseline: GameSaveV1): BugReplayReport => {
  const updates = report.updates!, full = boundaryTimes(updates);
  const rest = updates.slice(cut), rebased = boundaryTimes(rest);
  const commands = report.commands.filter(command => command.at >= full[cut]!).map(command =>
    ({ ...command, at: rebased[full.indexOf(command.at) - cut]! }));
  return { ...report, baseline, commands, elapsed: rebased.at(-1)!, scene: undefined, updates: rest };
};

/** The recording up to update `cut`. */
const prefixReport = (report: BugReplayReport, cut: number): BugReplayReport => {
  const updates = report.updates!.slice(0, cut), elapsed = boundaryTimes(updates).at(-1)!;
  return { ...report, commands: report.commands.filter(command => command.at < elapsed), elapsed,
    scene: undefined, updates };
};

/**
 * The whole recording (reloading its own snapshot in place at the snapshot tick, as the client does at upload),
 * its prefix up to the snapshot, and the rest resumed from that snapshot.
 */
const replayAroundSnapshot = async (report: BugReplayReport) => {
  const options = { hashEveryTicks: HASH_EVERY, mode: "runtime" } as const;
  const full = await runHeadlessReplay(report, { ...options, reloadAtTick: SNAPSHOT_UPDATES });
  const prefix = await runHeadlessReplay(prefixReport(report, SNAPSHOT_UPDATES), { ...options, captureSave: true });
  const resumed = await runHeadlessReplay(suffixReport(report, SNAPSHOT_UPDATES, prefix.save!), options);
  return { full, prefix, resumed };
};

describe("settlement determinism (BACKEND-03)", () => {
  let report: BugReplayReport;
  beforeAll(async () => { report = await recordFixture(await determinismIslandSave()); }, SLOW_TIMEOUT);

  it("replays one recording twice in Node to the same state hash sequence", async () => {
    const first = await runHeadlessReplay(report, { hashEveryTicks: HASH_EVERY, mode: "runtime" });
    const second = await runHeadlessReplay(structuredClone(report), { hashEveryTicks: HASH_EVERY, mode: "runtime" });
    expect(report.commands.map(command => command.name)).toEqual(["placeBuilding", "connectRoads",
      "placeBuilding", "connectRoads", "setProductionPaused", "setProductionPaused"]);
    expect(first.outcomeDifferences).toEqual([]);
    expect(first.checkpoints).toHaveLength(report.updates!.length / HASH_EVERY);
    expect(new Set(first.checkpoints.map(checkpoint => checkpoint.hash)).size).toBeGreaterThan(20);
    expect(second.checkpoints).toEqual(first.checkpoints);
    expect(second.finalHash).toBe(first.finalHash);
  }, SLOW_TIMEOUT);

  it("resumes from one snapshot to the same hashes every time (server re-verification)", async () => {
    const { resumed } = await replayAroundSnapshot(report);
    const again = await replayAroundSnapshot(structuredClone(report));
    expect(resumed.checkpoints.length).toBeGreaterThan(10);
    expect(again.resumed.checkpoints).toEqual(resumed.checkpoints);
    expect(again.resumed.finalHash).toBe(resumed.finalHash);
  }, SLOW_TIMEOUT);

  // Snapshot fidelity (D3): the client reloads each uploaded snapshot in place, so its play continues exactly
  // as a server resumed from that snapshot plays.
  it("continuous play matches play resumed from a mid-recording snapshot", async () => {
    const { full, prefix, resumed } = await replayAroundSnapshot(report);
    expect(prefix.checkpoints).toEqual(full.checkpoints.slice(0, prefix.checkpoints.length));
    const later = full.checkpoints.slice(prefix.checkpoints.length)
      .map(checkpoint => ({ ...checkpoint, tick: checkpoint.tick - prefix.ticks }));
    expect(resumed.checkpoints).toEqual(later);
  }, SLOW_TIMEOUT);
});
