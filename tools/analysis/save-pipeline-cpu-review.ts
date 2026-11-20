import { createHash } from "node:crypto";
import { mkdirSync,readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { decodeSave, encodeSave } from "../../../island-of-settlers-api/src/save-codec.ts";
import { type MapBase, type MapBases } from "../../../island-of-settlers-shared/src/save-map-delta.ts";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { resourcesPath } from "../bench/resources-path";

const files = process.argv.slice(2);
if (!files.length) files.push("/home/shadowvzs/Downloads/island-settlers-2026-10-28 (1).json");
const output = resourcesPath("project-reviews", "follow-ups-2026-10-29");
mkdirSync(output, { recursive: true });

const memoryBases = () => {
  const keys = new Map<string, MapBase>(), hashes = new Map<string, string>();
  return { keys, bases: {
    find: async key => keys.get(key) ?? null,
    read: async hash => hashes.get(hash) ?? null,
    write: async (key, base) => { keys.set(key, base); hashes.set(base.hash, base.map); }
  } as MapBases };
};
const sample = async (run: () => Promise<number>) => {
  const started = performance.now(), cpu = process.cpuUsage();
  const bytes = await run();
  const used = process.cpuUsage(cpu);
  return { milliseconds: performance.now() - started, cpuMilliseconds: (used.user + used.system) / 1000, bytes };
};
const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
/** The complete per-island snapshot the server stores for history, before transport wrapping. */
const historySnapshot = (game: GameSaveV1) =>
  ({ islands: [{ key: "home", save: { schemaVersion: 2, metadata: {}, data: game } }],
    player: game.player ?? {}, session: {}, colonies: [], adventures: [], evacuations: [] });
const results: unknown[] = [];
for (const file of files) {
  const game = JSON.parse(readFileSync(file, "utf8")) as GameSaveV1;
  const bytes = readFileSync(file);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const cold = memoryBases();
  const coldEncode = await sample(async () => (await encodeSave({ schemaVersion: 2, metadata: {}, data: game },
    { bases: cold.bases, key: "home" })).compressed.length);
  const coldEncoded = await encodeSave({ schemaVersion: 2, metadata: {}, data: game }, { bases: cold.bases, key: "home" });
  const coldDecode = await sample(async () => (await decodeSave(coldEncoded.compressed, coldEncoded.bytes, cold.bases)
    ? 1 : 0));
  const warm = memoryBases();
  await encodeSave({ schemaVersion: 2, metadata: {}, data: game }, { bases: warm.bases, key: "home" });
  const warmRuns = [];
  for (let run = 0; run < 5; run++) warmRuns.push(await sample(async () =>
    (await encodeSave({ schemaVersion: 2, metadata: {}, data: game }, { bases: warm.bases, key: "home" })).compressed.length));
  const warmDecodeRuns = [];
  const warmEncoded = await encodeSave({ schemaVersion: 2, metadata: {}, data: game }, { bases: warm.bases, key: "home" });
  for (let run = 0; run < 5; run++) warmDecodeRuns.push(await sample(async () =>
    (await decodeSave(warmEncoded.compressed, warmEncoded.bytes, warm.bases)) ? 1 : 0));
  const history = historySnapshot(game);
  const historyRun = await sample(async () => gzipSync(JSON.stringify(history), { level: 1 }).length);
  results.push({ file, sha256: hash, gameTick: game.settlement.gameTick,
    world: game.settlement.world, sourceBytes: bytes.length,
    cold: { encode: coldEncode, decode: coldDecode, baseBytes: Buffer.from([...cold.keys.values()][0]?.map ?? "", "base64").length },
    warm: { encodeMedian: { milliseconds: median(warmRuns.map(run => run.milliseconds)),
      cpuMilliseconds: median(warmRuns.map(run => run.cpuMilliseconds)), bytes: warmRuns[0]!.bytes },
      decodeMedian: { milliseconds: median(warmDecodeRuns.map(run => run.milliseconds)),
        cpuMilliseconds: median(warmDecodeRuns.map(run => run.cpuMilliseconds)) },
      runs: warmRuns },
    history: { ...historyRun, completeSnapshot: true } });
}
const result = { generatedAt: new Date().toISOString(), results,
  limits: ["In-memory MapBases only; no PostgreSQL, network, verification queue or history table I/O",
    "History is a complete gzip snapshot, not an incremental/delta history claim"] };
writeFileSync(resolve(output, "save-pipeline-cpu.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
