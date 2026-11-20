import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { catapultLocalStone } from "../../src/shared/settlement/military-catapult-resupply";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { readMapFile } from "../../src/shared/world/save/map-reader";

const input = process.argv[2] ?? "/home/shadowvzs/Downloads/island-settlers-2026-11-02.json";
const original = readFileSync(input), hash = createHash("sha256").update(original).digest("hex");
const game = JSON.parse(original.toString()), { world } = await readMapFile(new Uint8Array(Buffer.from(game.map, "base64")));
let simulation: ReturnType<typeof createSettlementSimulation>;
const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
const contacts = createIslandStockContacts(world, (x, z) => simulation?.isOccupied(x, z) ?? false);
simulation = createSettlementSimulation({ world, roads, stockContact: contacts, initialSettlers: 0,
  restoredHome: game.settlement.buildings.find((site: { typeId: number }) => site.typeId === 0), developmentAllowed: true });
const normalized = { ...game.settlement };
const adjustments: string[] = [];
if (normalized.accumulator < 0 || normalized.accumulator >= .05) { normalized.accumulator = 0; adjustments.push("Invalid harness accumulator normalized to0; source file unchanged"); }
const loaded = simulation.loadState(normalized);
console.log(JSON.stringify({ loaded, adjustments }));
if (!loaded.ok) process.exit(1);
const snapshots: unknown[] = [];
const unrelatedLoadRepairs: unknown[] = [];
const checkpoints = new Set<string>(), phases = new Set<string>(), workerIds = new Set<number>();
const originalTower = normalized.buildings.find((site: { uid: number }) => site.uid === 42)!;
const originalSoldierIds = normalized.military.soldiers.filter((soldier: { building: number }) => soldier.building === 42)
  .map((soldier: { actor: number }) => soldier.actor).sort((a: number, b: number) => a - b);
assert.equal(originalTower.worker, undefined);
let firstRoofTick: number | undefined, completedTick: number | undefined;
let maximumOwned = catapultLocalStone(originalTower);
const sourceFiles = ["src/shared/settlement/military-catapult-resupply.ts",
  "src/shared/settlement/military-catapult-resupply-actors.ts", "src/shared/settlement/settlement-workers.ts",
  "src/shared/settlement/settlement-actor-tick.ts", "src/shared/settlement/settlement-combat.ts",
  "src/shared/settlement/production-rules.ts", "src/render-common/buildings/catapult-dimensions.ts"];
const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex")]));
const capture = (tick: number) => {
  const tower = simulation.buildings().find(site => site.uid === 42)!;
  snapshots.push({ tick, roof: tower.input.stone, incoming: tower.incoming.stone, supply: structuredClone(tower.catapultSupply),
    aim: tower.catapultAim, contacts: contacts(tower, "input", "stone", 5),
    soldiers: simulation.militarySoldiers().filter(soldier => soldier.building === 42),
    bodies: simulation.snapshot().actors.filter(actor => actor.building === 42).map(actor => ({ uid: actor.uid,
      job: actor.job, phase: actor.phase, visible: actor.visible, x: actor.x, y: actor.y, z: actor.z, path: actor.path })) });
};
capture(0);
if (process.argv.includes("--move-threats")) {
  const enemies = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) !== 0).map(soldier => soldier.actor);
  console.log(JSON.stringify({ normalEnemyMoveOrder: simulation.commandMilitaryOpponent(enemies, { x: 230, z: 120 }, 1, "move") }));
}
for (let tick = 1; tick <= 6000; tick++) {
  simulation.update(.05);
  const tower = simulation.buildings().find(site => site.uid === 42)!;
  const total = catapultLocalStone(tower) + (tower.incoming.stone ?? 0);
  maximumOwned = Math.max(maximumOwned, total); assert(total <= 6);
  if ((tower.input.stone ?? 0) > 0) firstRoofTick ??= tick;
  if (tower.worker !== undefined) {
    workerIds.add(tower.worker);
    const actor = simulation.snapshot().actors.find(body => body.uid === tower.worker)!;
    assert.equal(actor.job, "Carrier"); assert.equal(actor.delivery, undefined);
    assert(!simulation.militarySoldiers().some(soldier => soldier.actor === actor.uid));
  }
  assert.deepEqual(simulation.militarySoldiers().filter(soldier => soldier.building === 42)
    .map(soldier => soldier.actor).sort((a, b) => a - b), originalSoldierIds);
  const porter = tower.catapultSupply?.porter;
  if (porter) {
    phases.add(porter.phase);
    const body = simulation.snapshot().actors.find(actor => actor.uid === porter.actor)!;
    const key = `${porter.phase}:${body.visible}`;
    if (!checkpoints.has(key)) {
      const saved = simulation.saveState();
      assert.deepEqual(simulation.loadState(JSON.parse(JSON.stringify(saved))), { ok: true });
      const restored = simulation.saveState();
      assert.deepEqual(restored.buildings.find(site => site.uid === 42), saved.buildings.find(site => site.uid === 42));
      assert.deepEqual(restored.actors.find(actor => actor.uid === porter.actor), saved.actors.find(actor => actor.uid === porter.actor));
      const changedActors = restored.actors.filter(actor => JSON.stringify(actor) !==
        JSON.stringify(saved.actors.find(before => before.uid === actor.uid))).map(actor => ({ uid: actor.uid, phase: actor.phase }));
      if (changedActors.length) unrelatedLoadRepairs.push({ checkpoint: key, actors: changedActors });
      checkpoints.add(key);
    }
  }
  if (tick <= 3 || tick % 200 === 0 || (tower.input.stone === 6 && !tower.catapultSupply?.porter)) {
    capture(tick); console.log(JSON.stringify({ tick, roof: tower.input.stone, supply: tower.catapultSupply }));
  }
  if (tower.input.stone === 6 && !tower.catapultSupply?.porter) { completedTick = tick; break; }
}
const sourceUnchanged = hash === createHash("sha256").update(readFileSync(input)).digest("hex");
assert(sourceUnchanged); assert(completedTick); assert.equal(workerIds.size, 1); assert.equal(phases.size, 8);
const result = { status: "PASS", source: input, sourceSha256: hash, sourceUnchanged, sourceHashes,
  adjustments, unrelatedLoadRepairs, firstRoofTick, completedTick, simulationSeconds: completedTick * .05, workerIds: [...workerIds],
  originalSoldierIds, maximumOwned, savedCheckpoints: [...checkpoints], phases: [...phases], snapshots };
const output = resolve(process.env.CATAPULT_OWNER_REPORT ??
  "../resources/project-reviews/catapult-civilian-resupply-2026-11-03/owner-save-report.json");
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, sourceUnchanged, firstRoofTick, completedTick,
  workerIds: result.workerIds, originalSoldierIds, phases: result.phases, savedCheckpoints: result.savedCheckpoints, output }));
