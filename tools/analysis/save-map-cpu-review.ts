import assert from "node:assert/strict";
import { mkdirSync,readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import { compactIsland, type MapBase, type MapBases } from "../../../island-of-settlers-shared/src/save-map-delta";
import { resourcesPath } from "../bench/resources-path";

const input = process.argv[2] ?? "/home/shadowvzs/Downloads/island-settlers-2026-10-28.json";
const game = JSON.parse(readFileSync(input, "utf8"));
const keys = new Map<string, MapBase>(), hashes = new Map<string, string>();
const bases: MapBases = { find: async key => keys.get(key) ?? null, read: async hash => hashes.get(hash) ?? null,
  write: async (key, base) => { keys.set(key, base);hashes.set(base.hash, base.map); } };
const zip = promisify(gzip);
await compactIsland(game, "home", bases);
interface Sample { ms: number; cpuMs: number; rawBytes: number; compressedBytes: number }
const full: Sample[] = [], compact: Sample[] = [];
for (let index = 0; index < 4; index++) {
  for (const reduced of [false, true]) {
    const started = performance.now(), cpu = process.cpuUsage();
    const body = reduced ? await compactIsland(game, "home", bases) : game;
    const json = JSON.stringify(body), compressed = await zip(json, { level: 1 });
    const used = process.cpuUsage(cpu);
    const result = { ms: performance.now() - started, cpuMs: (used.user + used.system) / 1000,
      rawBytes: Buffer.byteLength(json), compressedBytes: compressed.length };
    (reduced ? compact : full).push(result);
  }
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const result = { file: input, size: game.settlement.world, baseBytes: Buffer.from(game.map, "base64").length,
  full, compact, fullMedianMs: median(full.map(entry => entry.ms)),
  compactMedianMs: median(compact.map(entry => entry.ms)),
  fullMedianCpuMs: median(full.map(entry => entry.cpuMs)), compactMedianCpuMs: median(compact.map(entry => entry.cpuMs)) };
assert(compact[0]!.compressedBytes < full[0]!.compressedBytes);
const output = resourcesPath("project-reviews", "follow-ups-2026-10-29");mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "save-map-cpu.json"), JSON.stringify(result, null, 2));console.log(JSON.stringify(result));
