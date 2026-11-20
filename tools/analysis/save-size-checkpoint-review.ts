import { createHash } from "node:crypto";
import { mkdirSync,readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { type MapBase, type MapBases, mapHash } from "../../../island-of-settlers-shared/src/save-map-delta";
import { encodeSnapshotBody } from "../../src/app/save-store/captured-game";
import type { BugReplayReport } from "../../src/shared/settlement/bug-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { resourcesPath } from "../bench/resources-path";

const reportFile = process.argv[2] ?? resourcesPath("project-reviews", "follow-ups-2026-10-29",
  "periodic-reproduction.json");
const periodicFile = process.argv[3] ?? resourcesPath("project-reviews", "follow-ups-2026-10-29",
  "periodic-save.json");
const report = JSON.parse(readFileSync(reportFile, "utf8")) as BugReplayReport;
const baseline = report.baseline as GameSaveV1;
const periodic = JSON.parse(readFileSync(periodicFile, "utf8")) as { compactBytes?: number;
  firstUploadBytes?: number; fullExportBytes?: number };
const keys = new Map<string, MapBase>(), byHash = new Map<string, string>();
const bases: MapBases = {
  find: async key => keys.get(key) ?? null,
  read: async hash => byHash.get(hash) ?? null,
  write: async (key, base) => { keys.set(key, base); byHash.set(base.hash, base.map); }
};
const world = (baseline.settlement as unknown as { world: { seed: number; cellsX: number; cellsZ: number } }).world;
const key = `home:${world.seed}:${world.cellsX}:${world.cellsZ}`;
const hash = await mapHash(baseline.map);
keys.set(key, { hash, map: baseline.map }); byHash.set(hash, baseline.map);
const compact = Buffer.from(await encodeSnapshotBody(baseline, undefined, bases, [hash]));
const fullJson = JSON.stringify(baseline), full = gzipSync(fullJson, { level: 1 });
const result = {
  reportFile, periodicFile,
  checkpoint: { savedAt: baseline.savedAt, tick: baseline.settlement.gameTick,
    map: { seed: world.seed, cellsX: world.cellsX, cellsZ: world.cellsZ },
    saveSha256: createHash("sha256").update(JSON.stringify(baseline)).digest("hex") },
  full: { rawBytes: Buffer.byteLength(fullJson), gzipBytes: full.length },
  compact: { gzipBytes: compact.length, excludingOneTimeBase: true },
  retainedPeriodic: periodic,
  sameCheckpoint: true,
  retainedPeriodicMatches: periodic.compactBytes === undefined ? null : periodic.compactBytes === compact.length,
  retainedPeriodicDeltaBytes: periodic.compactBytes === undefined ? null : compact.length - periodic.compactBytes,
  smallerGzip: compact.length < full.length,
  note: "The full and compact sizes above are both produced from this report's exact baseline. The retained periodic value is a different capture/checkpoint and is not used as the match."
};
const output = resourcesPath("project-reviews", "follow-ups-2026-10-29");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "save-size-identical-checkpoint.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
