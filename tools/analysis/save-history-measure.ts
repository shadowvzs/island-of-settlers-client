import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import {
  compactIsland, expandIsland, type MapBase, type MapBases, mapHash
} from "../../../island-of-settlers-shared/src/save-map-delta";
import { toSaveSnapshot } from "../../src/app/save-store/save-snapshot";
import { createGameSave, readGameSave } from "../../src/shared/settlement/game-save";
import { packSparseCells } from "../../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { createSyntheticDenseWorld } from "../../tests/helpers/synthetic-dense-world";
import { convertSaveToV4 } from "./save-v4-conversion";

/**
 * Server history row and first upload (research 12, S08): the size and time of the gzip-1 history document of one
 * upload as the server stored it before (the islands expanded to their complete map) and now (compact islands: delta +
 * base hash), and the first upload body with the base map against the catalogue reference.
 * Usage: npx tsx tools/analysis/save-history-measure.ts file:<save.json> dense:1024:1.2:1.1
 */
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const timed = async <T>(operation: () => T | Promise<T>) => {
  const times: number[] = [];
  let result!: T;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    result = await operation();
    times.push(performance.now() - start);
  }
  return { ms: Math.round(median(times) * 10) / 10, result };
};

const memory = (): MapBases => {
  const keys = new Map<string, MapBase>(), hashes = new Map<string, string>();
  return { find: async key => keys.get(key) ?? null, read: async hash => hashes.get(hash) ?? null,
    write: async (key, base) => { keys.set(key, base); hashes.set(base.hash, base.map); } };
};

const load = async (source: string) => {
  if (!source.startsWith("dense:")) {
    const loaded = await readGameSave(convertSaveToV4(JSON.parse(readFileSync(source.replace(/^file:/, ""), "utf8"))));
    const { meta, terrain, world } = loaded.map;
    return createGameSave(world, loaded.settlement, { ...meta, animals: loaded.map.animals, terrain }, loaded.runtime);
  }
  const [cells, tree, small] = source.slice(6).split(":").map(Number) as [number, number, number?];
  const world = createSyntheticDenseWorld({ cells, seed: 7, smallPropSpacing: small, treeSpacing: tree });
  const settlement = { format: "island-settlers-settlement", version: 4,
    occupied: packSparseCells(new Uint8Array(cells * cells)), world: { cellsX: cells, cellsZ: cells, seed: 7 } };
  return createGameSave(world, settlement as unknown as SettlementSaveV1, { animals: [], name: "d", savedAt: 1, source: "s" });
};

const measure = async (source: string) => {
  const game = await load(source);
  const bases = memory();
  const snapshot = toSaveSnapshot(game);
  const island = snapshot.islands[0]!;
  const compact = await compactIsland(island.save.data, island.key, bases);
  const expanded = await expandIsland(compact, bases);
  const history = async (data: Record<string, unknown>) => {
    const body = { ...snapshot, islands: [{ ...island, save: { ...island.save, data } }] };
    return timed(() => gzipSync(Buffer.from(JSON.stringify(body)), { level: 1 }).length);
  };
  const before = await history(expanded), after = await history(compact);
  const base = (await bases.find(`${island.key}:${game.settlement.world.seed}:${game.settlement.world.cellsX}:${game.settlement.world.cellsZ}`))!;
  return { fixture: source.replace(/^file:.*\//, ""), size: game.settlement.world.cellsX,
    historyRow: { beforeBytes: before.result, beforeMs: before.ms, afterBytes: after.result, afterMs: after.ms,
      expandMs: (await timed(() => expandIsland(compact, bases))).ms },
    firstUpload: { withBaseBytes: base.map.length + JSON.stringify(compact).length, catalogueReferenceBytes: JSON.stringify(compact).length + 120,
      hashOk: (await mapHash(base.map)) === base.hash } };
};

const sources = process.argv.slice(2);
if (!sources.length) throw new Error("Usage: npx tsx tools/analysis/save-history-measure.ts file:<save>|dense:<cells>:<tree>[:<small>]");
for (const source of sources) console.log(JSON.stringify(await measure(source)));
