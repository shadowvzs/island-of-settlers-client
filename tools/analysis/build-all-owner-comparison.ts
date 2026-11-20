import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { resourcesPath } from "../bench/resources-path";

const directory = resourcesPath("project-reviews", "build-all-slowdown-2026-11-04");
const read = (name: string) => JSON.parse(readFileSync(resolve(directory, `${name}.json`), "utf8"));
const before = read("baseline"), after = read("candidate");
const baseline = read("baseline-settlement") as SettlementSaveV1;
const candidate = read("candidate-settlement") as SettlementSaveV1;
const inventories = (save: SettlementSaveV1) => save.buildings.map(building => ({ uid: building.uid,
  input: building.input, output: building.output, inventory: building.inventory, incoming: building.incoming }));
const cargo = (save: SettlementSaveV1) => save.actors.map(actor => ({ uid: actor.uid,
  ware: actor.ware, wareUnits: actor.wareUnits }));
const claims = (save: SettlementSaveV1) => save.actors.map(actor => ({ uid: actor.uid,
  delivery: actor.delivery && Object.fromEntries(Object.entries(actor.delivery)
    .filter(([key]) => !key.startsWith("lease"))) }));
assert.deepEqual(candidate.buildings.map(building => building.uid), baseline.buildings.map(building => building.uid));
assert.deepEqual(candidate.actors.map(actor => actor.uid), baseline.actors.map(actor => actor.uid));
assert.deepEqual(inventories(candidate), inventories(baseline));
assert.deepEqual(cargo(candidate), cargo(baseline));
assert.deepEqual(claims(candidate), claims(baseline));
assert.deepEqual(candidate.storagePools, baseline.storagePools);
assert.deepEqual(after.outcomeDifferences, before.outcomeDifferences);
assert.equal(after.ticks, before.ticks);
const oldActor = baseline.actors.find(actor => actor.uid === 11)!;
const newActor = candidate.actors.find(actor => actor.uid === 11)!;
const distance = Math.hypot(newActor.x - oldActor.x, newActor.z - oldActor.z);
assert.ok(distance > 1);
assert.equal(newActor.phase, "pickup");
assert.equal(newActor.stockBuilding, newActor.delivery?.source);
let previous = oldActor;
let maximumFrameDisplacement = 0;
for (const point of after.actorProgress) {
  maximumFrameDisplacement = Math.max(maximumFrameDisplacement,
    Math.hypot(point.x - previous.x, point.z - previous.z));
  previous = point;
}
assert.ok(maximumFrameDisplacement <= .2 * .84 + 1e-7, "The repair must walk at the normal carrier speed");
const receipt = { inputSha256: before.inputSha256, ticks: before.ticks,
  beforeUpdateMs: before.nativeMs, afterUpdateMs: after.nativeMs,
  updateReductionPercent: (1 - after.nativeMs / before.nativeMs) * 100,
  actorUidsPreserved: true, buildingUidsPreserved: true, inventoriesAndIncomingPerBuildingPreserved: true,
  heldCargoPerActorPreserved: true, deliveryClaimsPreserved: true, storagePoolsPreserved: true,
  outcomeDifferencesUnchanged: true, historicalRecordedEndpointMatches: false,
  actor11: { before: { x: oldActor.x, z: oldActor.z, phase: oldActor.phase },
    after: { x: newActor.x, z: newActor.z, phase: newActor.phase }, displacement: distance,
    maximumFrameDisplacement, stockBuilding: newActor.stockBuilding, source: newActor.delivery?.source, destination: newActor.delivery?.destination } };
writeFileSync(resolve(directory, "comparison.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
