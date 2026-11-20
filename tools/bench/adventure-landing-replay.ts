import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { MILITARY_PROFILES } from "../../src/shared/balance/military";
import { readGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { resourcesPath } from "./resources-path";

const input = process.argv[2];
assert(input, "Pass an adventure game save JSON path.");
const original = readFileSync(input);
const hash = createHash("sha256").update(original).digest("hex");
const loaded = await readGameSave(JSON.parse(original.toString()));
const world = loaded.map.world;
let simulation: ReturnType<typeof createSettlementSimulation>;
const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
simulation = createSettlementSimulation({ homeBuilding: null, initialSettlers: 0, roads, world });
assert.deepEqual(simulation.loadState(loaded.settlement), { ok: true });
const landing = simulation.adventure()?.landing;
assert(landing, "The save must contain an active adventure landing.");
const ids = new Set(simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 0)
  .map(soldier => soldier.actor));
const samples: unknown[] = [];
let maxStep = 0;
let largestStep: unknown;
for (let tick = 1; tick <= 2400; tick++) {
  const previous = new Map(simulation.frames().filter(actor => ids.has(actor.uid))
    .map(actor => [actor.uid, { phase: actor.phase, visible: actor.visible, x: actor.x, z: actor.z }]));
  simulation.update(.05);
  const actors = simulation.frames().filter(actor => ids.has(actor.uid));
  for (const actor of actors) {
    const before = previous.get(actor.uid);
    if (before?.visible && actor.visible) {
      const distance = Math.hypot(actor.x - before.x, actor.z - before.z);
      if (distance > maxStep) {
        maxStep = distance;
        largestStep = { tick, id: actor.uid, before, after: { phase: actor.phase, x: actor.x, z: actor.z } };
      }
    }
  }
  if (tick % 200 !== 0) continue;
  const pendingOrders = simulation.militarySoldiers().filter(soldier => ids.has(soldier.actor) &&
    soldier.combat?.destination !== undefined).length;
  samples.push({ seconds: tick / 20, pendingOrders, phases: actors.reduce<Record<string, number>>((counts, actor) => {
    counts[actor.phase] = (counts[actor.phase] ?? 0) + 1;
    return counts;
  }, {}), minShoreDistance: Math.min(...actors.map(actor =>
    Math.hypot(actor.x - landing.shore.x, actor.z - landing.shore.z))) });
}
const actors = simulation.frames().filter(actor => ids.has(actor.uid));
assert.equal(actors.length, ids.size, "Landing must preserve every player soldier.");
assert(actors.every(actor => actor.phase === "militaryField"), "Every soldier must finish departing.");
assert(maxStep <= MILITARY_PROFILES.cavalry.speed * .05 + 1e-6,
  `Landing recovery must use continuous movement: ${JSON.stringify(largestStep)}`);
assert.equal(createHash("sha256").update(readFileSync(input)).digest("hex"), hash);
const output = resourcesPath("project-reviews", "2026-10-13", "adventure-landing");
mkdirSync(output, { recursive: true });
const report = { source: basename(input), sha256: hash, troops: ids.size, maxStep, samples };
writeFileSync(resolve(output, "replay.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
