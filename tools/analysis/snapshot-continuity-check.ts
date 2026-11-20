import { readFileSync } from "node:fs";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { FORESTER_TYPE_ID, WOODCUTTER_TYPE_ID } from "../../src/shared/settlement/building-type-ids";
import { createGameSave, type GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import {
  createSettlementSimulation, type SettlementSimulation
} from "../../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";
import { placeProp } from "../../src/shared/world/editing/prop-placement";
import { PROP } from "../../src/shared/world/world-data";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { createSnapshotSession, type SnapshotSession, STEP } from "./snapshot-session";

/**
 * Snapshot continuity (determinism item 3): runs the determinism fixture continuously and resumed
 * from a snapshot at tick SNAPSHOT_TICK, hashes every tick and prints the first diverging fields.
 *
 *   npx tsx tools/analysis/snapshot-continuity-check.ts [--inplace] [--ticks 1600] [--save game.json]
 *
 * `--inplace`: at the snapshot the continuous run reloads its own snapshot into the same
 * simulation (`loadState(saveState())`; canonical in-place restart). `--rebuild`: a whole new session.
 */
const SNAPSHOT_TICK = 600;
const flag = (name: string) => process.argv.includes(name);
const argument = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
};
const TOTAL_TICKS = argument("--ticks", 1600);
const saveIndex = process.argv.indexOf("--save");
const SAVE_FILE = saveIndex < 0 ? undefined : process.argv[saveIndex + 1];

const fixtureSave = () => {
  const world = huntingWorld();
  for (let z = 30; z <= 44; z += 2) for (let x = 40; x <= 54; x += 2)
    placeProp(world, { kind: PROP.broadleafTree, seed: x * 131 + z, x: x + .5, z: z + .5 });
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20, initialStock: {
    axe: 2, fish: 200, hammer: 2, logs: 80, planks: 60, saw: 2, shovel: 2, stone: 40 } });
  return createGameSave(world, simulation.saveState(), {
    animals: [], name: "Determinism island", savedAt: 10_000_000, source: "generated" });
};


const build = (simulation: SettlementSimulation, type: number, x: number, z: number) => {
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const placed = simulation.placeBuilding(type, x + width / 2, z + depth / 2);
  if (!placed.ok) throw new Error(placed.reason);
  simulation.connectRoads(simulation.headquarters.access, placed.building!.access);
};

/** The test fixture's commands by absolute tick. */
const commandAt = (simulation: SettlementSimulation, tick: number) => {
  if (SAVE_FILE) return;
  if (tick === 10) build(simulation, WOODCUTTER_TYPE_ID, 34, 30);
  if (tick === 410) build(simulation, FORESTER_TYPE_ID, 34, 40);
  if (tick === 640) simulation.setProductionPaused(simulation.buildings()[1]!.uid, true);
  if (tick === 840) simulation.setProductionPaused(simulation.buildings()[1]!.uid, false);
};

const step = (session: SnapshotSession, absoluteTick: number) => {
  commandAt(session.simulation, absoluteTick);
  session.clock.elapsed += STEP;
  session.simulation.update(STEP);
};

const run = (session: SnapshotSession, fromTick: number, toTick: number) => {
  const hashes: { hash: string; state: string; tick: number }[] = [];
  for (let tick = fromTick; tick < toTick; tick++) {
    step(session, tick);
    const state = session.state();
    hashes.push({ hash: hashSettlementState(state), state: JSON.stringify({ runtime: state.runtime,
      settlement: state.settlement }), tick: tick + 1 });
  }
  return hashes;
};

const differences = (a: unknown, b: unknown, path = "", out: string[] = []) => {
  if (out.length >= 12) return out;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys)
    differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`, out);
  return out;
};

const main = async () => {
  const base = SAVE_FILE ? JSON.parse(readFileSync(SAVE_FILE, "utf8")) as GameSaveV1 : await fixtureSave();
  const continuous = await createSnapshotSession(base, { elapsed: 0 });
  run(continuous, 0, SNAPSHOT_TICK);
  const snapshot = JSON.parse(JSON.stringify(await continuous.saveGame())) as GameSaveV1;
  let continued = continuous;
  if (flag("--inplace")) {
    // Same simulation object (context-keyed caches survive); actors are rebuilt from the save.
    const reload = continuous.simulation.reloadSnapshot(snapshot.settlement);
    if (!reload.ok) throw new Error(reload.reason);
  }
  if (flag("--rebuild")) continued = await createSnapshotSession(snapshot, { elapsed: 0 });
  const resumed = await createSnapshotSession(snapshot, { elapsed: 0 });
  const a = run(continued, SNAPSHOT_TICK, TOTAL_TICKS), b = run(resumed, SNAPSHOT_TICK, TOTAL_TICKS);
  const first = a.findIndex((entry, index) => entry.hash !== b[index]!.hash);
  if (first < 0) { console.log(`identical for ${a.length} ticks after the snapshot`); return; }
  console.log(`first divergence at tick ${a[first]!.tick} (${first + 1} ticks after the snapshot)`);
  for (const line of differences(JSON.parse(a[first]!.state), JSON.parse(b[first]!.state))) console.log(" ", line);
  const worldDiff = (name: string, left: ArrayLike<number>, right: ArrayLike<number>) => {
    let count = 0, first = -1;
    for (let index = 0; index < Math.max(left.length, right.length); index++)
      if (left[index] !== right[index]) { count++; if (first < 0) first = index; }
    if (count) console.log(`  world.${name}: ${count} differ, first [${first}] ${left[first]} vs ${right[first]}`);
  };
  const [left, right] = [continued.world, resumed.world];
  worldDiff("props.types", left.props.types.subarray(0, left.props.count),
    right.props.types.subarray(0, right.props.count));
  worldDiff("props.x", left.props.x.subarray(0, left.props.count), right.props.x.subarray(0, right.props.count));
  worldDiff("props.z", left.props.z.subarray(0, left.props.count), right.props.z.subarray(0, right.props.count));
  worldDiff("props.phase", left.props.phase.subarray(0, left.props.count),
    right.props.phase.subarray(0, right.props.count));
  worldDiff("oreAmount", left.oreAmount, right.oreAmount);
  worldDiff("heights", left.heights, right.heights);
  worldDiff("fog", left.fog ?? [], right.fog ?? []);
  const diverged = a.filter((entry, index) => entry.hash !== b[index]!.hash).length;
  console.log(`${diverged}/${a.length} ticks differ`);
};

await main();
