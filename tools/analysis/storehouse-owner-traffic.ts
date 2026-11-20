import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { resourcesPath } from "../bench/resources-path";

const sourcePath = process.argv[2] ?? "/home/shadowvzs/Downloads/island-settlers-2026-11-03 (2).json";
const duration = Number(process.argv[3] ?? 30), tag = process.argv[4] ?? "baseline";
if (!Number.isFinite(duration) || duration <= 0 || duration > 180) throw new Error("Expected 0..180 seconds");
const output = resourcesPath("project-reviews", "storehouse-traffic-2026-11-04");
await mkdir(output, { recursive: true });
const bytes = await readFile(sourcePath), source = JSON.parse(bytes.toString()) as GameSaveV1;
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const sourceHash = digest(bytes), started = performance.now();
const island = await createHeadlessIsland(source), simulation = island.simulation;
simulation.enableDoorWaitMetrics();
const initial = simulation.snapshot(), store = initial.buildings.find(building => building.uid === 7)!;
const tracked = new Set(initial.actors.filter(actor => actor.delivery?.destination === store.uid ||
  actor.delivery?.source === store.uid).map(actor => actor.uid));
const samples: unknown[] = [];
const sample = (seconds: number) => {
  const snapshot = simulation.snapshot();
  const actors = snapshot.actors.filter(actor => tracked.has(actor.uid)).map(actor => ({
    uid: actor.uid, x: actor.x, z: actor.z, visible: actor.visible, phase: actor.phase, ware: actor.ware,
    pathIndex: actor.pathIndex, pathLength: actor.path.length, next: actor.path[actor.pathIndex],
    queueTarget: actor.queueTarget, timer: actor.timer, delivery: actor.delivery,
    recovery: actor.navigationRecovery
  }));
  samples.push({ seconds, queue: simulation.doorQueueSnapshot(store.uid), actors,
    incoming: snapshot.buildings.find(building => building.uid === store.uid)?.incoming,
    wait: simulation.doorWaitMetrics() });
  console.log(JSON.stringify({ seconds, owner: simulation.doorQueueSnapshot(store.uid).owner,
    tracked: actors.map(actor => `${actor.uid}:${actor.phase}:${actor.x.toFixed(2)},${actor.z.toFixed(2)}`) }));
};
sample(0);
for (let tick = 1; tick <= duration * 20; tick++) {
  simulation.update(.05);
  if (tick % 100 === 0) sample(tick / 20);
}
const next = await island.save();
await stageGameSession(next);
const report = { sourcePath, sourceHash, duration, tag, wallMs: performance.now() - started,
  finalValid: true, sourceUnchanged: sourceHash === digest(await readFile(sourcePath)), samples,
  scope: "Real headless live simulation; no offline time skip, renderer, network or source-save mutation." };
await writeFile(resolve(output, `${tag}.json`), JSON.stringify(report, null, 2));
await writeFile(resolve(output, `${tag}-final.json`), JSON.stringify(next));
console.log(JSON.stringify({ tag, wallMs: report.wallMs, finalValid: report.finalValid, sourceUnchanged: report.sourceUnchanged }));
