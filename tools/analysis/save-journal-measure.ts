import { readFileSync } from "node:fs";

import {
  type MapBase, type MapBases, compactIsland
} from "../../../island-of-settlers-shared/src/save-map-delta";
import { type CapturedGame, persistCapturedGame } from "../../src/app/save-store/captured-game";
import type { GameDatabase } from "../../src/app/settlement/game-database";
import { readGameSave } from "../../src/shared/settlement/game-save";
import { splitGameSave } from "../../src/shared/settlement/game-save-rows";
import { packSparseCells } from "../../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { levelBuildingFoundation } from "../../src/shared/settlement/settlement-foundation";
import type { SettlementBuilding } from "../../src/shared/settlement/settlement-types";
import { removePropsAt } from "../../src/shared/world/editing/prop-removal";
import { appendProp } from "../../src/shared/world/editing/prop-set";
import { clearSaveStageProfile, readSaveStageProfile } from "../../src/shared/settlement/save-stage-profile";
import type { MapSaveInput } from "../../src/shared/world/save/map-writer";
import { bumpBuildRevision } from "../../src/shared/world/save/world-change-journal";
import { captureWorldPatch, clearWorldMirrors, VERIFY_EVERY } from "../../src/shared/world/save/world-patch";
import { PROP, PROP_REMOVED, type WorldData } from "../../src/shared/world/world-data";
import { createSyntheticDenseWorld } from "../../tests/helpers/synthetic-dense-world";
import { convertSaveToV4 } from "./save-v4-conversion";

/**
 * Save journal (research 12, S06) before/after: the main-thread cost of a save capture (the
 * structured clone `postMessage` makes of the live world, against the journal patch) and the worker
 * cost of composing and compacting the map. One JSON object per fixture.
 * Usage: npx tsx tools/analysis/save-journal-measure.ts file:<save.json> dense:1024:1.2:1.1
 */
interface Fixture { input: MapSaveInput; label: string; runtime?: unknown; settlement: SettlementSaveV1; world: WorldData }
const RUNS = 5;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const round = (value: number) => Math.round(value * 100) / 100;

const timed = async <T>(operation: () => T | Promise<T>) => {
  const times: number[] = [];
  let result!: T;
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    result = await operation();
    times.push(performance.now() - start);
  }
  return { ms: round(median(times)), result };
};

const settlementOf = (world: WorldData) => ({
  format: "island-settlers-settlement", version: 4,
  occupied: packSparseCells(new Uint8Array(world.cellsX * world.cellsZ)),
  world: { cellsX: world.cellsX, cellsZ: world.cellsZ, seed: world.seed }
}) as unknown as SettlementSaveV1;

const loadFile = async (file: string): Promise<Fixture> => {
  const loaded = await readGameSave(convertSaveToV4(JSON.parse(readFileSync(file, "utf8"))));
  const { meta, terrain, world } = loaded.map;
  return { input: { ...meta, animals: loaded.map.animals, terrain }, label: file, runtime: loaded.runtime,
    settlement: loaded.settlement, world };
};

const loadDense = (spec: string): Fixture => {
  const [cells, treeSpacing, smallSpacing] = spec.split(":").map(Number) as [number, number, number?];
  const world = createSyntheticDenseWorld({ cells, seed: 7, smallPropSpacing: smallSpacing, treeSpacing });
  return { input: { animals: [], name: "dense", savedAt: 1, source: "synthetic" }, label: `dense:${spec}`,
    settlement: settlementOf(world), world };
};

const createStore = () => {
  const keys = new Map<string, MapBase>(), byHash = new Map<string, string>();
  const bases: MapBases = {
    find: async key => keys.get(key) ?? null,
    read: async hash => byHash.get(hash) ?? null,
    write: async (key, base) => { keys.set(key, base); byHash.set(base.hash, base.map); }
  };
  const rows: Record<string, unknown>[] = [];
  const database: Pick<GameDatabase, "backend" | "mapBases" | "writeGame"> = {
    backend: "indexeddb", mapBases: () => bases,
    writeGame: async (_slot, save, options) => {
      rows.length = 0;
      for (const island of splitGameSave(save).islands)
        rows.push(await compactIsland(island.save as unknown as Record<string, unknown>, island.id, bases,
          options?.live?.[island.id]));
    }
  };
  return { database, rows };
};

/** Trees near the settlement site (a 48 cell window around the map centre) still standing. */
const standingNear = (world: WorldData, limit: number, skip: number) => {
  const ids: number[] = [], half = 24, centreX = world.cellsX / 2, centreZ = world.cellsZ / 2;
  for (let index = 0; index < world.props.count && ids.length < limit; index++) {
    if (world.props.types[index] === PROP_REMOVED || Math.abs(world.props.x[index]! - centreX) > half ||
      Math.abs(world.props.z[index]! - centreZ) > half || index % 3 !== skip % 3) continue;
    ids.push(index);
  }
  return ids;
};

/** A burst of play: trees felled, a few planted, one foundation levelled. */
const play = (world: WorldData, step: number) => {
  removePropsAt(world, standingNear(world, 40, step));
  for (let plant = 0; plant < 12; plant++)
    appendProp(world.props, { form: 1, phase: 0, rotation: 0, scale: 1, type: PROP.broadleafTree,
      x: world.cellsX / 2 + plant * 1.5, y: 3, z: world.cellsZ / 2 + step });
  bumpBuildRevision(world, null);
  const building = { depth: 3, width: 3, x: world.cellsX / 2 + 10 + step * 4.5, y: 3.2, z: world.cellsZ / 2 + 8 };
  levelBuildingFoundation(world, building as unknown as SettlementBuilding, []);
};

const bytesOf = (value: unknown) => JSON.stringify(value).length;

const measure = async (source: string) => {
  const fixture = source.startsWith("dense:") ? loadDense(source.slice(6)) : await loadFile(source.replace(/^file:/, ""));
  const { input, runtime, settlement, world } = fixture;
  const target = { kind: "local", slotId: "guest" } as const;
  const before = createStore(), after = createStore();
  const capture = (): CapturedGame => ({ save: [world, settlement, input, runtime] });
  // Main thread, before: the structured clone postMessage makes of the whole capture.
  const clone = await timed(() => structuredClone(capture()));
  const rest = await timed(() => structuredClone({ save: [null, settlement, input, runtime] }));
  // Worker, before: compose the whole map file and compare it with the base.
  await persistCapturedGame(capture(), target, before.database);
  const legacy = await timed(() => persistCapturedGame(capture(), target, before.database));
  // Keyframe (first save, or an unexplained change): the whole world copied once.
  const keyframe = await timed(() => {
    clearWorldMirrors();
    return captureWorldPatch(world, { forceKeyframe: true })!;
  });
  const patchOf = (captured: ReturnType<typeof captureWorldPatch>): CapturedGame => ({
    save: [null as unknown as WorldData, settlement, input, runtime], worldPatch: captured!.patch });
  const resync = async () => {
    clearWorldMirrors();
    await persistCapturedGame(patchOf(captureWorldPatch(world, { forceKeyframe: true })), target, after.database);
  };
  await resync();
  const idle = await timed(() => captureWorldPatch(world)!);
  await resync();
  let step = 0;
  const incremental = { bytes: 0, captureMs: [] as number[], workerMs: [] as number[] };
  const stages = new Map<string, number[]>();
  (globalThis as { __saveStageProfile?: boolean }).__saveStageProfile = true;
  for (let run = 0; run < RUNS; run++) {
    play(world, step++);
    const started = performance.now();
    const captured = captureWorldPatch(world)!;
    incremental.captureMs.push(performance.now() - started);
    incremental.bytes = captured.transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    const message = patchOf(captured);
    const workerStarted = performance.now();
    await persistCapturedGame(message, target, after.database);
    incremental.workerMs.push(performance.now() - workerStarted);
    for (const sample of readSaveStageProfile()) stages.set(sample.name, [...stages.get(sample.name) ?? [], sample.ms]);
    clearSaveStageProfile();
  }
  (globalThis as { __saveStageProfile?: boolean }).__saveStageProfile = false;
  // The same final world through the old path: rows must agree.
  await persistCapturedGame(capture(), target, before.database);
  const sameRows = JSON.stringify(before.rows.map(row => row.saveEncoding)) ===
    JSON.stringify(after.rows.map(row => row.saveEncoding));
  const rowBytes = { after: bytesOf(after.rows[0]!.saveEncoding), before: bytesOf(before.rows[0]!.saveEncoding) };
  // Periodic self check: a patch that carries a full copy for the worker to compare.
  let verify = { captureMs: 0 };
  for (let run = 0; run < VERIFY_EVERY; run++) {
    play(world, step++);
    const started = performance.now();
    const captured = captureWorldPatch(world)!;
    if (captured.patch.verify) verify = { captureMs: round(performance.now() - started) };
    await persistCapturedGame(patchOf(captured), target, after.database);
  }
  return { fixture: fixture.label, size: world.cellsX, props: world.props.count,
    mainThreadBefore: { cloneWholeCaptureMs: clone.ms, ofWhichSettlementAndRuntimeMs: rest.ms },
    mainThreadAfter: { idleMs: idle.ms, incrementalMs: round(median(incremental.captureMs)),
      incrementalBytes: incremental.bytes, keyframeMs: keyframe.ms, selfCheckMs: verify.captureMs },
    worker: { beforeMs: legacy.ms, afterMs: round(median(incremental.workerMs)),
      afterStages: Object.fromEntries([...stages].map(([name, values]) => [name, round(median(values))])) },
    rowBytes, sameRows };
};

const sources = process.argv.slice(2);
if (!sources.length) throw new Error("Usage: npx tsx tools/analysis/save-journal-measure.ts file:<save>|dense:<cells>:<tree>[:<small>]");
for (const source of sources) console.log(JSON.stringify(await measure(source)));
