import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { isBuildingCourtyardPointWalkable } from "../../src/render-common/buildings/building-courtyard";
import { readGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { isHomeBuilding } from "../../src/shared/settlement/settlement-home";
import { createSettlementSimulation, type SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { savedHomeBuilding } from "./helpers";
const folder = resolve(process.argv[2] ?? "/home/shadowvzs/Downloads");
const output = resolve(process.argv[3] ?? "/tmp/settlers-supplied-save-audit-2026-10-18");
const simulate = process.argv.includes("--simulate");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const entries: { label: string; original: any; sourceHash: string; copy: string }[] = [];
const reports: unknown[] = [];
await mkdir(output, { recursive: true });
await mkdir(join(output, "copies"), { recursive: true });

const collect = (original: any, label: string, sourceHash: string, copy: string) => {
  entries.push({ original, label, sourceHash, copy });
  const archive = original.archipelago;
  if (archive?.home) entries.push({ original: archive.home, label: `${label}::archipelago.home`, sourceHash, copy });
  for (const colony of archive?.colonies ?? []) if (colony.save) entries.push({
    original: colony.save, label: `${label}::colony-${colony.expeditionId}`, sourceHash, copy
  });
};

const actorContext = (actor: any, buildings: any[]) => ({
  uid: actor.uid, job: actor.job, phase: actor.phase, action: actor.action,
  x: actor.x, y: actor.y, z: actor.z, timer: actor.timer, blocked: actor.blocked,
  ware: actor.ware, target: actor.target, resource: actor.resource,
  pathIndex: actor.pathIndex, pathLength: actor.path?.length,
  delivery: actor.delivery, productionInputs: actor.productionInputs,
  navigationRecovery: actor.navigationRecovery, stockContact: actor.stockContact,
  stockBuilding: actor.stockBuilding, preparedTarget: actor.preparedTarget,
  productionSeconds: actor.productionSeconds, queueWait: actor.queueWait,
  building: buildings.filter(building => [actor.home, actor.building, actor.workplace].includes(building.uid))
    .map(building => ({ uid: building.uid, typeId: building.typeId, x: building.x, z: building.z,
      input: building.input, output: building.output, inventory: building.inventory }))
});

const savedIslandKind = (state: { adventure?: unknown; colony?: unknown } | undefined) => {
  if (state?.colony) return "colony";
  return state?.adventure ? "adventure" : "home";
};

const inventory = (entry: typeof entries[number]) => {
  const saved = entry.original, state = saved.settlement;
  const expeditions = saved.player?.colonyExpeditions ?? saved.player?.expeditions;
  return { label: entry.label, sourceHash: entry.sourceHash, copy: entry.copy, savedAt: saved.savedAt,
    buildings: state?.buildings?.length, actors: state?.actors?.length,
    island: savedIslandKind(state),
    harbour: state?.buildings?.filter((building: any) => building.typeId === 39)
      .map((building: any) => ({ uid: building.uid, construction: building.construction, inventory: building.inventory })),
    naval: state?.naval, expeditions,
    troops: state?.military?.soldiers?.map((soldier: any) => ({ uid: soldier.uid, type: soldier.type,
      rank: soldier.rank, location: soldier.location })),
    archivedIslands: saved.archipelago?.colonies?.map((colony: any) => ({
      expeditionId: colony.expeditionId, island: colony.island, status: colony.status
    })) };
};

const audit = async (entry: typeof entries[number]) => {
  const details = inventory(entry);
  try {
    const loaded = await readGameSave(entry.original);
    const { world } = loaded.map;
    if (!simulate) return { ...details, validated: true, dimensions: [world.cellsX, world.cellsZ] };
    let elapsed = 0;
    let simulation: SettlementSimulation;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    const home = loaded.settlement.buildings.find(isHomeBuilding);
    const homeBuilding = savedHomeBuilding(home);
    simulation = createSettlementSimulation({ world, roads, homeBuilding,
      playerNation: loaded.settlement.playerNation, now: () => entry.original.savedAt + elapsed * 1000,
      stockContact: createIslandStockContacts(world, (x, z) => simulation?.isOccupied(x, z) ?? false),
      canWorkerEnterPlot: (building, point) => building.construction < 1 ||
        isBuildingCourtyardPointWalkable(building.typeId, building.x, building.z, building.rotation,
          point, building.output, building.input)
    });
    const restored = simulation.loadState(loaded.settlement);
    if (!restored.ok) return { ...details, restored };
    const before = simulation.saveState();
    let maximumStepMs = 0;
    const snapshots: unknown[] = [];
    for (let step = 0; step < 1200; step++) {
      const start = performance.now();
      elapsed += .05;
      simulation.update(.05);
      maximumStepMs = Math.max(maximumStepMs, performance.now() - start);
      if ((step + 1) % 200 === 0) {
        snapshots.push({ seconds: elapsed, actors: simulation.saveState().actors.length });
        // Give the coordinator time between bounded chunks; never run a parallel simulation pool.
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    const after = simulation.saveState();
    const invalid = after.actors.filter(actor => ![actor.x, actor.y, actor.z, actor.timer].every(Number.isFinite));
    const negativeStock = after.buildings.flatMap(building => ["input", "output", "inventory"].flatMap(key =>
      Object.entries((building as any)[key]).filter(([, value]) => !Number.isFinite(value) || Number(value) < 0)
        .map(([ware, amount]) => ({ uid: building.uid, typeId: building.typeId, x: building.x,
          z: building.z, stock: key, ware, amount }))));
    const stationary = before.actors.filter(actor => actor.visible && actor.phase !== "retired").flatMap(actor => {
      const next = after.actors.find(next => next.uid === actor.uid);
      if (!next || next.phase !== actor.phase || Math.hypot(next.x - actor.x, next.z - actor.z) >= .1) return [];
      return [{ before: actorContext(actor, before.buildings), after: actorContext(next, after.buildings) }];
    });
    return { ...details, restored, reload: simulation.loadState(after), seconds: elapsed, maximumStepMs,
      snapshots, invalid: invalid.map(actor => actorContext(actor, after.buildings)), negativeStock, stationary,
      beforeActors: before.actors.length, afterActors: after.actors.length };
  } catch (error) { return { ...details, error: String(error) }; }
};

for (const name of (await readdir(folder)).filter(name => /^(island-settlers|settlers-reproduction).*\.json$/.test(name)).sort()) {
  const bytes = await readFile(join(folder, name));
  const sourceHash = hash(bytes), copy = join(output, "copies", basename(name));
  await writeFile(copy, bytes);
  try {
    const original = JSON.parse(bytes.toString("utf8"));
    if (original.format === "island-settlers-game") collect(original, name, sourceHash, copy);
    else if (original.format === "island-settlers-bug-replay")
      collect(original.baseline, `${name}::baseline`, sourceHash, copy);
  } catch (error) { reports.push({ name, sourceHash, error: String(error) }); }
}
for (const entry of entries) {
  const result = await audit(entry);
  reports.push(result);
  await writeFile(join(output, "audit.json"), JSON.stringify({ simulate, scope: "60s serial local simulation probes",
    limitations: ["No live felling/growth/wildlife/resource scene controllers or renderer",
      "No archipelago/background voyage coordinator or offline catch-up",
      "Stationary phase/position is diagnostic, not sufficient to establish a deadlock",
      "No complete independent ware/reservation conservation proof"], reports }, null, 2));
  console.log(JSON.stringify({ label: entry.label, error: (result as any).error,
    validated: (result as any).validated, restored: (result as any).restored,
    stationary: (result as any).stationary?.length, invalid: (result as any).invalid?.length,
    negativeStock: (result as any).negativeStock?.length }));
}
