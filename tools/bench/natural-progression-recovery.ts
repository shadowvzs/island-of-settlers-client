import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createNaturalProgressionSession } from "./natural-progression-session";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "acceptance-2026-10-28", "natural-progression");
const source = JSON.parse(readFileSync(process.env.SOURCE ?? resolve(output, "02-bounded-failure.json"), "utf8")) as GameSaveV1;
const { player, save, sim } = await createNaturalProgressionSession(source);
if (process.env.PAUSE_SURPLUS === "1") for (const building of sim.buildings()) {
  if ([17, 18, 19, 22, 33].includes(building.typeId)) sim.setProductionPaused(building.uid, true);
}
const materialLedger = () => Object.fromEntries(["planks", "stone"].map(ware => [ware,
  sim.buildings().reduce((sum, building) => sum + (building.inventory[ware] ?? 0) +
    (building.input[ware] ?? 0) + (building.output[ware] ?? 0), 0) +
  sim.frames().reduce((sum, actor) => sum + (actor.ware === ware ? actor.wareUnits ?? 1 : 0), 0)]));
const beforeMaterials = materialLedger();
sim.update(.05);
const afterRepairMaterials = materialLedger();
if (process.env.ASSERT_MATERIALS === "1") assert.deepEqual(afterRepairMaterials, beforeMaterials);
const before = sim.frames().map(actor => ({ id: actor.uid, phase: actor.phase, x: actor.x, z: actor.z }));
if (process.env.LOOP === "1") {
  const h = sim.headquarters;
  const corners = [{ x: h.x - 5, z: h.z - 4.5 }, { x: h.x + 5, z: h.z - 4.5 },
    { x: h.x + 5, z: h.z + 4.5 }, { x: h.x - 5, z: h.z + 4.5 }];
  console.log("public loop", corners.map((point, index) => sim.connectRoads(point, corners[(index + 1) % 4]!)));
}
const handoffs = new Map<number, unknown>();
for (let tick = 0; tick < 1200 * 20; tick++) {
  sim.update(.05);
  if (tick % 5 === 0) for (const actor of sim.frames()) {
    if (actor.phase === "deliveryTransfer") handoffs.set(actor.uid, { uid: actor.uid, x: actor.x, z: actor.z,
      delivery: actor.delivery, contact: actor.stockContact });
  }
}
const after = sim.frames().map(actor => ({ id: actor.uid, phase: actor.phase, x: actor.x, z: actor.z }));
const moved = before.filter(actor => after.some(next => next.id === actor.id && Math.hypot(next.x - actor.x, next.z - actor.z) > 1));
const result = { beforeMaterials, afterRepairMaterials, tutorial: player.tutorialSummary(), counters: player.progress().questBook?.counters, mode: process.env.MODE ?? (process.env.LOOP ? "loop" : "reload"), moved: moved.length,
  handoffs: [...handoffs.values()], buildings: sim.buildings().map(building => ({ uid: building.uid, construction: building.construction,
    required: building.required, foundation: building.foundationProgress })), before, after };
writeFileSync(resolve(output, `recovery-${result.mode}.json`), JSON.stringify(result, null, 2));
writeFileSync(resolve(output, `recovery-${result.mode}-save.json`), JSON.stringify(await save()));
console.log(JSON.stringify({ mode: result.mode, moved: result.moved, buildings: result.buildings }));
