import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";

const input = process.argv[2] ?? "/tmp/home-fleet-current-2026-11-05/fleet-24-9.save.json";
const output = resolve(process.argv[3] ?? "/tmp/home-fleet-current-2026-11-05/late");
const target = Number(process.argv[4] ?? 65000);
assert(Number.isSafeInteger(target) && target > 300 && target <= 120000);
await mkdir(output, { recursive: true });
const bytes = await readFile(input);
const island = await createHeadlessIsland(JSON.parse(bytes.toString("utf8")));
const simulation = island.simulation;
for (const _ of simulation.prewarmCoastalGeometry()) { /* Canonical loading preparation. */ }
const history: unknown[] = [];
for (let tick = simulation.saveState().gameTick ?? 0; tick < target; tick++) {
  simulation.update(.05);
  if ((tick + 1) % 5000 === 0 || tick + 1 === target) {
    const save = await island.save();
    const ships = save.settlement.naval.fleet.ships;
    assert.equal(ships.filter(ship => !ship.visitor).length, 24);
    const row = { tick: tick + 1, orders: save.settlement.naval.fleet.orders.length,
      phases: Object.fromEntries([...new Set(ships.map(ship => ship.phase))].map(phase =>
        [phase, ships.filter(ship => ship.phase === phase).length])) };
    history.push(row);
    await writeFile(resolve(output, "checkpoint.save.json"), JSON.stringify(save));
    await writeFile(resolve(output, "history.json"), JSON.stringify({ input,
      inputSHA256: createHash("sha256").update(bytes).digest("hex"), target, history }, null, 2));
    console.log(JSON.stringify(row));
    if (row.orders > 0 && ships.filter(ship => ship.phase === "stranded").length >= 8) break;
  }
}
