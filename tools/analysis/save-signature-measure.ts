import { gunzipSync } from "node:zlib";

import type { MapBase, MapBases } from "../../../island-of-settlers-shared/src/save-map-delta";
import { encodeSnapshotBody } from "../../src/app/save-store/captured-game";
import { createSnapshotBodyBuilder } from "../../src/app/save-store/snapshot-body";
import { addColonyRecord, emptyArchipelago } from "../../src/shared/settlement/archipelago";
import { createGameSave, type GameSaveV1 } from "../../src/shared/settlement/game-save";
import type { IslandKey } from "../../src/shared/settlement/game-save-rows";
import { packSparseCells } from "../../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { createSyntheticDenseWorld } from "../../tests/helpers/synthetic-dense-world";

/**
 * Cloud upload with unchanged-island references (research 12 S07, owner 2026-11-07): body size and worker time of an
 * autosave of a home island (live) plus several colony islands (filed), before (every island complete and compacted
 * each time) and after (signatures + encoding cache), with all colonies unchanged and with one colony changed by a
 * shipment. Usage: npx tsx tools/analysis/save-signature-measure.ts <cells>:<tree>[:<small>] [colonies=4]
 */
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const round = (value: number) => Math.round(value * 10) / 10;
const memory = (): MapBases => {
  const keys = new Map<string, MapBase>(), hashes = new Map<string, string>();
  return { find: async key => keys.get(key) ?? null, read: async hash => hashes.get(hash) ?? null,
    write: async (key, base) => { keys.set(key, base); hashes.set(base.hash, base.map); } };
};

const island = async (cells: number, tree: number, small: number | undefined, seed: number, stock: number) => {
  const world = createSyntheticDenseWorld({ cells, seed, smallPropSpacing: small, treeSpacing: tree });
  const settlement = { buildings: [{ inventory: { logs: stock }, typeId: 29 }], format: "island-settlers-settlement",
    occupied: packSparseCells(new Uint8Array(cells * cells)), version: 4,
    world: { cellsX: cells, cellsZ: cells, seed } } as unknown as SettlementSaveV1;
  return createGameSave(world, settlement, { animals: [], name: `i${seed}`, savedAt: 1, source: "s" });
};

const game = async (cells: number, tree: number, small: number | undefined, colonies: number, changed: number) => {
  const record = { crew: 1, landed: {}, troops: [] };
  const names = { difficulty: "easy" as const, name: "Rock", ore: "coal" as const, voyageSeconds: 1 };
  let group = emptyArchipelago();
  for (let id = 1; id <= colonies; id++) group = addColonyRecord(group, id, { ...names, id, seed: 100 + id }, record);
  const filed = [];
  for (const colony of group.colonies)
    filed.push({ ...colony, save: await island(cells, tree, small, 100 + colony.expeditionId,
      colony.expeditionId === changed ? 99 : 10) });
  return { ...(await island(cells, tree, small, 7, 5)), archipelago: { ...group, colonies: filed } } as GameSaveV1;
};

const timed = async <T>(runs: number, operation: (run: number) => Promise<T>) => {
  const times: number[] = [];
  let result!: T;
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    result = await operation(run);
    times.push(performance.now() - start);
  }
  return { ms: round(median(times)), result };
};

const measure = async (spec: string, colonies: number) => {
  const [cells, tree, small] = spec.split(":").map(Number) as [number, number, number?];
  const unchanged = await game(cells, tree, small, colonies, 0), shipped = await game(cells, tree, small, colonies, 1);
  const tick = (save: GameSaveV1, run: number) => ({ ...save, savedAt: save.savedAt + run + 1 });
  const rows = (stock: "a" | "b") => new Map<IslandKey, string>(Array.from({ length: colonies }, (_, index) =>
    [`colony-${index + 1}` as IslandKey, `${index === 0 && stock === "b" ? "shipped" : "row"}-${index}`]));

  const before = await timed(5, async run => {
    const bases = memory();
    return (await encodeSnapshotBody(tick(unchanged, run), [], bases, [])).byteLength;
  });
  const builder = createSnapshotBodyBuilder(), bases = memory();
  const first = await builder.build({ bases, game: unchanged, rowSignatures: rows("a") });
  const idle = await timed(5, async run => builder.build({ bases, game: tick(unchanged, run), rowSignatures: rows("a"),
    serverSignatures: first.signatures }));
  const shipment = await timed(1, async () => builder.build({ bases, game: tick(shipped, 9), rowSignatures: rows("b"),
    serverSignatures: first.signatures }));
  const references = (upload: { body: ArrayBuffer }) =>
    (JSON.parse(gunzipSync(Buffer.from(upload.body)).toString("utf8")) as { islands: { unchanged?: string }[] })
      .islands.filter(entry => entry.unchanged).length;
  return { fixture: spec, colonies, firstUploadBytes: first.body.byteLength,
    autosaveBefore: { bytes: before.result, ms: before.ms },
    autosaveUnchanged: { bytes: idle.result.body.byteLength, ms: idle.ms, references: references(idle.result) },
    autosaveOneColonyShipment: { bytes: shipment.result.body.byteLength, ms: shipment.ms,
      references: references(shipment.result) } };
};

const [spec, count] = process.argv.slice(2);
if (!spec) throw new Error("Usage: npx tsx tools/analysis/save-signature-measure.ts <cells>:<tree>[:<small>] [colonies]");
console.log(JSON.stringify(await measure(spec, Number(count ?? 4))));
