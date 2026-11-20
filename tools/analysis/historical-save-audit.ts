import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { readGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isHomeBuilding } from "../../src/shared/settlement/settlement-home";
import { createSettlementSimulation, type SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { savedHomeBuilding } from "./helpers";

const folder = process.argv[2] ?? "/home/shadowvzs/Downloads";
const reports: unknown[] = [];
for (const name of (await readdir(folder)).filter(name => /^island-settlers.*\.json$/.test(name)).sort()) {
  try {
    const original = JSON.parse(await readFile(join(folder, name), "utf8"));
    const loaded = await readGameSave(original);
    let elapsed = 0;
    const { world } = loaded.map;
    let simulation: SettlementSimulation;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    const home = loaded.settlement.buildings.find(isHomeBuilding);
    const homeBuilding = savedHomeBuilding(home);
    simulation = createSettlementSimulation({ world, roads, homeBuilding, stockContact: createIslandStockContacts(world),
      playerNation: loaded.settlement.playerNation, now: () => original.savedAt + elapsed * 1000 });
    const restored = simulation.loadState(loaded.settlement);
    if (!restored.ok) throw new Error(JSON.stringify(restored));
    const before = simulation.saveState(), start = performance.now();
    let maximumStep = 0;
    for (let step = 0; step < 1200; step++) {
      const time = performance.now(); elapsed += .05; simulation.update(.05);
      maximumStep = Math.max(maximumStep, performance.now() - time);
    }
    const after = simulation.saveState();
    const invalid = after.actors.filter(actor => ![actor.x, actor.y, actor.z, actor.timer].every(Number.isFinite));
    const negativeStock = after.buildings.flatMap(building => [building.input, building.output, building.inventory]
      .flatMap(stock => Object.entries(stock).filter(([, count]) => !Number.isFinite(count) || count < 0)));
    const stationary = before.actors.filter(actor => actor.visible && actor.phase !== "retired").filter(actor => {
      const next = after.actors.find(next => next.uid === actor.uid);
      return next?.phase === actor.phase && Math.hypot(next.x - actor.x, next.z - actor.z) < .1;
    }).map(actor => ({ uid: actor.uid, job: actor.job, phase: actor.phase }));
    const reload = simulation.loadState(after);
    const report = { name, restored, reload, invalid: invalid.map(actor => actor.uid), negativeStock,
      beforeActors: before.actors.length, afterActors: after.actors.length, stationary,
      milliseconds: performance.now() - start, maximumStep };
    reports.push(report); console.log(JSON.stringify(report));
  } catch (error) { const report = { name, error: String(error) }; reports.push(report); console.log(JSON.stringify(report)); }
  await writeFile("/tmp/historical-save-audit.json", JSON.stringify(reports, null, 2));
}
