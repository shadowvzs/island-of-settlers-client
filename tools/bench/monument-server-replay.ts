import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

import { toSaveSnapshot } from "../../src/app/save-store/save-snapshot";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import { createCommandLogRecorder } from "../../src/shared/settlement/command-log";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";

const output = resolve(process.env.OUT ?? "../resources/project-reviews/acceptance-2026-10-28/monument-construction");
const prepared = await createHeadlessIsland(JSON.parse(await readFile(resolve(output, "initial.json"), "utf8")) as GameSaveV1);
assert(prepared.simulation.demolishBuilding(prepared.simulation.buildings().find(building => building.typeId === 7)!.uid).ok);
const baseline = await prepared.save();
const client = await createHeadlessIsland(baseline), { simulation } = client;
const recorder = createCommandLogRecorder(simulation, { sourceVersion: "monument200-current" });
recorder.open();
const placed = simulation.placeBuilding(7, 32.5, 32.5);
assert(placed.ok && placed.building, placed.reason ?? "Monument replay placement");
const uid = placed.building.uid;
for (let tick = 0; tick < 80000 && placed.building.construction < .25; tick++) simulation.update(.05);
assert(placed.building.construction >= .25);
const first = recorder.close("home")!;
assert(simulation.reloadSnapshot(simulation.saveState()).ok);
recorder.open();
for (let tick = 0; tick < 100000 && simulation.buildings().find(building => building.uid === uid)!.construction < 1; tick++)
  simulation.update(.05);
assert.equal(simulation.buildings().find(building => building.uid === uid)!.construction, 1);
for (let tick = 0; tick < 6000; tick++) simulation.update(.05);
const second = recorder.close("home")!, end = await client.save();
const bundle = resolve(output, "monument-verifier.mjs");
await build({ bundle: true, entryPoints: [resolve("src/app/settlement/server-bundle.ts")],
  format: "esm", outfile: bundle, platform: "node", target: "node22" });
const server = await import(pathToFileURL(bundle).href);
const input = { base: toSaveSnapshot(baseline), end: toSaveSnapshot(end),
  intervals: [{ ...first, baseRevision: 1 }, second] };
const result = await server.verifyCommandLogs(input);
assert.equal(result.status, "verified", JSON.stringify(result));
const forged = structuredClone(input);
const saved = forged.end.islands[0]!.save.data as unknown as { settlement: typeof end.settlement };
saved.settlement.buildings.find(building => building.uid === uid)!.constructionConsumed!.granite!--;
const rejected = await server.verifyCommandLogs(forged);
assert.equal(rejected.status, "mismatch");
const report = { result, forgedMaterialReceipt: rejected.status,
  bundleSha256: createHash("sha256").update(await readFile(bundle)).digest("hex"),
  intervals: input.intervals.map(interval => ({ baseTick: interval.baseTick, endTick: interval.endTick })) };
await writeFile(resolve(output, "server-replay.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
