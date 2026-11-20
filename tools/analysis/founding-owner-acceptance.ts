import assert from "node:assert/strict";
import { mkdirSync,readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { hashSettlementState } from "../../src/shared/settlement/settlement-state-hash";
import { resetTrafficWork, snapshotTrafficWork } from "../../src/shared/settlement/settlement-traffic-counters";
import { resourcesPath } from "../bench/resources-path";

const file = process.argv[2]; assert(file, "Supply the owner save before landing");
const baseline = JSON.parse(readFileSync(file, "utf8")) as GameSaveV1;
const island = await createHeadlessIsland(baseline, true);
const simulation = island.simulation;
for (const _progress of simulation.prewarmCoastalGeometry()) { /* Loading-only work. */ }

let ship = baseline.settlement.naval.fleet.ships.find(candidate => candidate.expedition);
const startedFromCheckpoint = !ship;
if (!ship) {
  // The `(2)` checkpoint predates the expedition: start the same real landing journey from it.
  const source = simulation.buildings().find(building => building.typeId === 39 &&
    building.construction === 1 && !building.colonyHome);
  assert(source, "The save has no completed harbour to launch an expedition from");
  const target = simulation.seaExpeditionDestinations(source.uid)[0];
  assert(target, "The save offers no expedition target");
  assert(simulation.queueSeaExpedition(source.uid, target), "The expedition could not be prepared");
}
let ids = new Set(ship?.passengers ?? []);
const positions = new Map<number, { x: number; z: number }>();
let largestTick = 0, largestWork: unknown = null;
let maxStep = 0, maxUpdate = 0, pierObserved = false, landed = false, resumed = false, completed = false;
let operationShip: number | undefined, outpostUid: number | undefined;
let crewIds: number[] = [];
const phases = new Set<string>();
for (let tick = 0; tick < 30_000; tick++) {
  resetTrafficWork();
  const started = performance.now(); simulation.update(.05);
  const duration = performance.now() - started;
  if (duration > maxUpdate) { maxUpdate = duration; largestTick = tick; largestWork = snapshotTrafficWork(); }
  for (const frame of simulation.frames()) {
    if (!ids.has(frame.uid)) continue;
    if (!frame.visible) { positions.delete(frame.uid); continue; }
    const before = positions.get(frame.uid);
    if (before) maxStep = Math.max(maxStep, Math.hypot(frame.x - before.x, frame.z - before.z));
    positions.set(frame.uid, { x: frame.x, z: frame.z });
  }
  if (tick % 10) continue;
  const save = simulation.saveState();
  const activeShip = ship ?? save.naval.fleet.ships.find(candidate => candidate.expedition);
  if (!ship && activeShip) { ship = activeShip; ids = new Set(activeShip.passengers ?? []); }
  const operation = save.naval.founding.operations.find(candidate =>
    operationShip === undefined || candidate.shipId === operationShip);
  const outpost = outpostUid === undefined ? undefined :
    save.buildings.find(building => building.uid === outpostUid);
  if (outpost?.construction === 1 && !operation) { completed = true; break; }
  if (!operation) continue;
  operationShip = operation.shipId;
  outpostUid = operation.siteUid;
  crewIds = [operation.builder, operation.leveler, operation.carrier];
  for (const actor of save.actors) if (ids.has(actor.uid)) phases.add(actor.phase);
  pierObserved ||= simulation.shipSites().some(site => site.kind === "pier" && Boolean(site.workPier));
  if (!resumed && operation.landing && save.actors.some(actor => ids.has(actor.uid) && actor.phase === "foundingLandingPier")) {
    const copy = structuredClone(save);
    const outcome = simulation.reloadSnapshot(copy); assert(outcome.ok, JSON.stringify(outcome));
    const after = simulation.saveState();
    for (const actor of save.actors.filter(actor => ids.has(actor.uid))) {
      const restored = after.actors.find(candidate => candidate.uid === actor.uid)!;
      assert.deepEqual([restored.x, restored.y, restored.z], [actor.x, actor.y, actor.z]);
    }
    resumed = true;
  }
  if (operation.stage !== "landing") landed = true;
}
const final = simulation.saveState();
const outpost = final.buildings.find(building => building.uid === outpostUid);
if (outpost) outpostUid = outpost.uid;
assert(landed && completed && pierObserved && resumed,
  JSON.stringify({ landed, completed, pierObserved, resumed, phases: [...phases] }));
assert(maxStep < .2, `A visible crew member jumped ${maxStep} tiles`);
if (maxUpdate >= 100) console.error(JSON.stringify({ maxUpdate, largestTick, largestWork, finalTick: simulation.tickCount() }));
assert(maxUpdate < 100, `An update took ${maxUpdate} ms`);
const shipId = ship?.id ?? operationShip;
const outpostPool = final.storagePools.pools.find(pool => pool.id === outpost?.storagePoolId);
const result = { file, startedFromCheckpoint, ship: shipId, maxStep, maxUpdate, largestTick, largestWork,
  pierObserved, landed, resumed, completed, outpostUid, finalTick: simulation.tickCount(),
  finalHash: hashSettlementState({ runtime: island.runtimeState(), settlement: final, world: island.world }),
  outpostInventory: outpost?.inventory, outpostPool: outpostPool?.available,
  crew: crewIds.map(uid => {
    const actor = final.actors.find(candidate => candidate.uid === uid);
    return actor && { uid, job: actor.job, phase: actor.phase, visible: actor.visible,
      building: actor.building, home: actor.home, tool: actor.tool, ware: actor.ware };
  }),
  shipPhase: final.naval.fleet.ships.find(candidate => candidate.id === shipId)?.phase,
  phases: [...phases] };
const output = resourcesPath("project-reviews", "follow-ups-2026-10-29");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, file.includes("(3)") ? "landing-owner-3.json" : "landing-owner-2.json"),
  JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
