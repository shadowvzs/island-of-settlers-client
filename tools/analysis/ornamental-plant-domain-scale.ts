import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { ornamentalPlantArtReady } from "../../../island-of-settlers-shared/src/road-plant-models";
import { roadDecorationClearance } from "../../src/render-common/road-decoration-clearance";
import { getRoadDecoration } from "../../src/shared/settlement/road-decoration-catalog";
import { createRoadDecorationState } from "../../src/shared/settlement/road-decoration-state";

const run = process.argv.find(value => value.startsWith("--run="))?.slice(6) ?? "domain-c";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid domain scale label");
const output = resolve("../resources/project-reviews/ornamental-plant-runtime-2026-11-04", `${run}.json`);
if (existsSync(output)) throw new Error("Preserve existing measurement; choose another label");
const rows = Object.entries(ROAD_DECORATION_ITEM_DEFINITIONS)
  .filter(([, item]) => item.plant && ornamentalPlantArtReady(item.plant));
if (rows.length !== 18) throw new Error("Expected the eighteen approved canonical forms");
const owner = createRoadDecorationState(() => ({ nation: "roman", roads: [], heightAt: () => 0,
  isOwned: () => true, isFree: () => true }));
const before = process.memoryUsage().heapUsed, started = performance.now();
let held = 1000;
for (let index = 0; index < 1000; index++) {
  const result = owner.place({ item: rows[index % rows.length]![0] as keyof typeof ROAD_DECORATION_ITEM_DEFINITIONS,
    position: { x: 8 + index % 32 * 8, z: 8 + Math.floor(index / 32) * 8 },
    yaw: index * .37 % (Math.PI * 2) }, () => { held--; return true; });
  if (!result.ok) throw new Error(`Rejected real placement ${index}: ${JSON.stringify(result)}`);
}
if (held !== 0) throw new Error("Placement custody mismatch");
const placementMs = performance.now() - started, saved = owner.save(), loadStarted = performance.now();
owner.load(saved);
if (JSON.stringify(saved) !== JSON.stringify(owner.save())) throw new Error("1000 save/load changed identity");
const sources = ["src/render-common/plants/ornamental-plant-clearance.ts",
  "src/render-common/road-decoration-clearance.ts", "src/shared/settlement/road-decoration-state.ts"];
const report = {
  method: "CPU actual domain placement and save/load, flat owned terrain,1000 pre-owned fixture items",
  sourceHashes: Object.fromEntries(sources.map(path =>
    [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
  physicalContract: "15cm lower crown cells,50cm maple cells ONLY wholly above canonical2.1m traffic envelope; both graphics tiers share exact woody supports",
  localBounds: rows.map(([, item]) => ({ id: item.decoration,
    boxes: roadDecorationClearance(getRoadDecoration(item.decoration)!).volumes.length })),
  instances: owner.frames().length, worldBoxes: owner.frames().reduce((sum, frame) => sum + frame.volumes.length, 0),
  placementMs, loadMs: performance.now() - loadStarted,
  observedHeapDeltaMiB: (process.memoryUsage().heapUsed - before) / 1048576,
  heapCaveat: "Includes cold caches and transient allocations; no forced GC and no retained-heap claim. Not phone timing."
};
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
