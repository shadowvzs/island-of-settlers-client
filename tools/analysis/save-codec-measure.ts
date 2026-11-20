import { readFileSync } from "node:fs";
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from "node:zlib";

import { type MapBase, type MapBases, mapHash } from "../../../island-of-settlers-shared/src/save-map-delta";
import { encodeSnapshotBody } from "../../src/app/save-store/captured-game";
import { createGameSave, type GameSaveV1, readGameSave } from "../../src/shared/settlement/game-save";
import { packSparseCells } from "../../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import type { MapSaveInput } from "../../src/shared/world/save/map-writer";
import type { PropSet, WorldData } from "../../src/shared/world/world-data";
import { createSyntheticDenseWorld } from "../../tests/helpers/synthetic-dense-world";
import { convertSaveToV4 } from "./save-v4-conversion";

/**
 * Save size and time measurement before/after the save cards (research 12, S02..S13). One JSON
 * object per fixture: the complete save bytes, the compact repeat body of an unchanged map and of
 * a map with one planted tree, and the times of every codec step. Fixtures:
 *   file:<save.json>                         a retained save (a version 3 file is converted to 4 in memory)
 *   dense:<cells>:<treeSpacing>[:<smallSpacing>]  the synthetic dense world of tests/helpers
 * Usage: npx tsx tools/analysis/save-codec-measure.ts file:<save.json> dense:1024:1.2:1.8
 */

interface Fixture { input: MapSaveInput; label: string; runtime?: unknown; settlement: SettlementSaveV1; world: WorldData }
const RUNS = 3;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const milliseconds = (value: number) => Math.round(value * 10) / 10;

const timed = async <T>(operation: () => Promise<T>) => {
  const times: number[] = [];
  let result!: T;
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    result = await operation();
    times.push(performance.now() - start);
  }
  return { ms: milliseconds(median(times)), result };
};

const emptySettlement = (world: WorldData) => ({
  format: "island-settlers-settlement", version: 4,
  occupied: packSparseCells(new Uint8Array(world.cellsX * world.cellsZ)),
  world: { cellsX: world.cellsX, cellsZ: world.cellsZ, seed: world.seed }
}) as unknown as SettlementSaveV1;

const loadFileFixture = async (file: string): Promise<Fixture> => {
  const loaded = await readGameSave(convertSaveToV4(JSON.parse(readFileSync(file, "utf8"))));
  const { meta, terrain, world } = loaded.map;
  return { input: { ...meta, animals: loaded.map.animals, terrain }, label: file, runtime: loaded.runtime,
    settlement: loaded.settlement, world };
};

const loadDenseFixture = (spec: string): Fixture => {
  const [cells, treeSpacing, smallSpacing] = spec.split(":").map(Number) as [number, number, number?];
  const world = createSyntheticDenseWorld({ cells, seed: 7, smallPropSpacing: smallSpacing, treeSpacing });
  return { input: { animals: [], name: "dense", savedAt: 1, source: "synthetic" }, label: `dense:${spec}`,
    settlement: emptySettlement(world), world };
};

const loadFixture = (source: string) => source.startsWith("dense:") ?
  loadDenseFixture(source.slice(6)) : loadFileFixture(source.replace(/^file:/, ""));

const growProps = (props: PropSet): PropSet => {
  const grow = <T extends Float32Array | Uint8Array>(array: T) => {
    const bigger = new (array.constructor as new (length: number) => T)(props.count + 1);
    bigger.set(array.subarray(0, props.count));
    return bigger;
  };
  const grown = { count: props.count + 1, form: grow(props.form), phase: grow(props.phase),
    rotation: grow(props.rotation), scale: grow(props.scale), types: grow(props.types), x: grow(props.x),
    y: grow(props.y), z: grow(props.z) };
  grown.x[props.count] = props.x[0]!; grown.z[props.count] = props.z[0]!; grown.y[props.count] = props.y[0]!;
  return grown;
};

const createBases = () => {
  const keys = new Map<string, MapBase>(), byHash = new Map<string, string>();
  const bases: MapBases = {
    find: async (key) => keys.get(key) ?? null,
    read: async (hash) => byHash.get(hash) ?? null,
    write: async (key, base) => { keys.set(key, base); byHash.set(base.hash, base.map); }
  };
  return { bases, pin: (key: string, base: MapBase) => { keys.set(key, base); byHash.set(base.hash, base.map); } };
};

/** The map file's payload recompressed by gzip-6 and by a fast brotli level (analysis only). */
const mapCodecSizes = (base64: string) => {
  const file = Buffer.from(base64, "base64");
  const payload = (file[6] === 1 ? brotliDecompressSync : gunzipSync)(file.subarray(8));
  const quality = { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: payload.length };
  return { brotliQ5: brotliCompressSync(payload, { params: quality }).length, file: file.length,
    gzip6: gzipSync(payload, { level: 6 }).length, raw: payload.length };
};

const saveSizes = (save: GameSaveV1) => {
  const json = Buffer.from(JSON.stringify(save));
  return { gzip6: gzipSync(json, { level: 6 }).length, json: json.length, mapBase64: save.map.length };
};

const baseKey = (world: WorldData) => `home:${world.seed}:${world.cellsX}:${world.cellsZ}`;

const bodyBytes = async (save: GameSaveV1, bases: MapBases, hash: string) => {
  const { ms, result } = await timed(async () => encodeSnapshotBody(save, undefined, bases, [hash]));
  return { bytes: result.byteLength, ms };
};

const measure = async (source: string) => {
  const fixture = await loadFixture(source);
  const { input, runtime, settlement, world } = fixture;
  const create = await timed(() => createGameSave(world, settlement, input, runtime));
  const save = create.result;
  const read = await timed(() => readGameSave(save));
  const hash = await mapHash(save.map);
  const { bases, pin } = createBases();
  const first = await timed(() => encodeSnapshotBody(save, undefined, createBases().bases, []));
  pin(baseKey(world), { hash, map: save.map });
  const unchanged = await bodyBytes(await createGameSave(world, settlement, input, runtime), bases, hash);
  const grownWorld = { ...world, props: growProps(world.props) };
  const grownSave = await createGameSave(grownWorld, settlement, input, runtime);
  const grown = await bodyBytes(grownSave, bases, hash);
  return { fixture: fixture.label, size: world.cellsX, props: world.props.count,
    save: saveSizes(save), mapCodecs: mapCodecSizes(save.map),
    times: { createGameSaveMs: create.ms, firstBodyMs: first.ms, readGameSaveMs: read.ms },
    body: { firstBytes: first.result.byteLength, grownByOneProp: grown, unchanged } };
};

const sources = process.argv.slice(2);
if (!sources.length) throw new Error("Usage: npx tsx tools/analysis/save-codec-measure.ts file:<save>|dense:<cells>:<tree>[:<small>]");
for (const source of sources) console.log(JSON.stringify(await measure(source)));
