import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { readGameSave } from "../../src/shared/settlement/game-save";
import { NATION_DRINK_CHAINS } from "../../src/shared/settlement/nation-drinks";
import { levelRoadGround } from "../../src/shared/settlement/road-ground-leveling";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation, type SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";

const files = process.argv.slice(2);
if (!files.length) throw new Error("Pass the original exported game save paths (read only)");
for (const file of files) {
  const loaded = await readGameSave(JSON.parse(await readFile(file, "utf8")));
  const { world } = loaded.map;
  let simulation: SettlementSimulation;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, stockContact: createIslandStockContacts(world) });
  assert.deepEqual(simulation.loadState(loaded.settlement), { ok: true });
  const original = simulation.saveState();
  const advance = (seconds: number) => {
    for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
  };
  advance(120);
  assert.deepEqual(simulation.loadState(simulation.saveState()), { ok: true });
  advance(180);
  let simulatedSeconds = 300;
  while (simulatedSeconds < 900 && simulation.tavernOrders().some(entry => entry.queue.length)) {
    advance(10);
    simulatedSeconds += 10;
  }
  assert(simulation.tavernOrders().every(entry => !entry.queue.length), "Queued recruits must finish");
  const after = simulation.saveState();
  const actor = (uid: number) => after.actors.find(entry => entry.uid === uid);
  const originalCarriers = [57, 149, 182, 192, 248].filter(uid => original.actors.some(entry => entry.uid === uid));
  const report = originalCarriers.map(uid => ({ uid, phase: actor(uid)?.phase ?? "retired",
    delivery: actor(uid)?.delivery, cargo: actor(uid)?.ware }));
  for (const entry of report) assert.equal(entry.phase, "retired", `Original carrier ${entry.uid} did not finish`);
  if (original.actors.some(entry => entry.uid === 43 && entry.job === "Winegrower"))
    assert(actor(43) && Math.hypot(actor(43)!.x - 108.0379, actor(43)!.z - 114.5262) > .5);
  levelRoadGround(world, after.roads, after.buildings);
  const heights = world.heights.slice();
  for (let pass = 0; pass < 10; pass++) {
    assert.equal(levelRoadGround(world, after.roads, after.buildings), null);
    assert.deepEqual(world.heights, heights);
  }
  for (const nation of Object.keys(NATION_DRINK_CHAINS) as Array<keyof typeof NATION_DRINK_CHAINS>) {
    assert(simulation.setPlayerNation(nation));
    assert.deepEqual(simulation.loadState(simulation.saveState()), { ok: true });
    const fields = simulation.fieldFrames();
    assert(fields.every(field => !["vine", "hive", "rice", "palm"].includes(field.kind) ||
      field.kind === NATION_DRINK_CHAINS[nation].plantation));
    advance(5);
  }
  console.log(JSON.stringify({ file, simulatedSeconds, carriers: report, vineyard: actor(43)?.phase,
    horse: actor(-1)?.phase, recruitment: after.tavern,
    stableRoadPasses: 10, nationSwitchesAndReloads: 4 }));
}
