import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { createIslandStockContacts } from "../../src/app/settlement/island-stock-contacts";
import { createOfflineIslandRuntime } from "../../src/app/settlement/offline-island-runtime";
import { isBuildingCourtyardPointWalkable } from "../../src/render-common/buildings/building-courtyard";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { findGroundPath, isNavigationClear } from "../../src/shared/settlement/settlement-navigation";
import { movementOutcome } from "../../src/shared/settlement/settlement-navigation-recovery";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import { savedHomeBuilding } from "./helpers";
import { savedOccupancy } from "../../src/shared/settlement/save-cell-codecs";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) throw new Error("Expected source-save.json and new output directory");
const sourcePath = resolve(inputArgument), output = resolve(outputArgument);
const bytes = await readFile(sourcePath);
await mkdir(output);
await writeFile(join(output, basename(sourcePath)), bytes);
const source = JSON.parse(bytes.toString("utf8")) as GameSaveV1;
const loaded = await stageGameSession(source), { world } = loaded.map;
const runtime = createOfflineIslandRuntime(loaded);
let elapsed = 0;
let simulation: ReturnType<typeof createSettlementSimulation>;
const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
simulation = createSettlementSimulation({ world, roads, ...runtime.hooks,
  homeBuilding: savedHomeBuilding(loaded.settlement.buildings.find(building => building.typeId === 0 || building.colonyHome)),
  playerNation: loaded.settlement.playerNation, now: () => source.savedAt + elapsed * 1000,
  stockContact: createIslandStockContacts(world),
  canWorkerEnterPlot: (building, point) => building.construction < 1 ||
    isBuildingCourtyardPointWalkable(building.typeId, building.x, building.z, building.rotation,
      point, building.output, building.input) });
const restored = simulation.loadState(loaded.settlement);
if (!restored.ok) throw new Error(restored.reason);
const distance = new Map<number, number>();
const snapshot = () => ({ seconds: elapsed, population: simulation.population(),
  idle: simulation.availableSettlers(), horses: simulation.saveState().actors.filter(actor => actor.job === "Mount")
    .map(actor => ({ uid: actor.uid, phase: actor.phase, visible: actor.visible,
      outcome: movementOutcome(simulation.frames().find(candidate => candidate.uid === actor.uid)!),
      x: actor.x, z: actor.z })),
  work: simulation.saveState().actors.filter(actor => ["Forester", "Builder"].includes(actor.job)).map(actor => ({ uid: actor.uid, job: actor.job, phase: actor.phase, x: actor.x, z: actor.z, target: actor.target, seedling: actor.foresterSeedling, tool: actor.tool, path: actor.path, pathIndex: actor.pathIndex, recovery: actor.navigationRecovery, outcome: movementOutcome(simulation.frames().find(candidate => candidate.uid === actor.uid)!) })),
  sites: simulation.buildings().filter(building => building.uid === 39 || building.construction < 1).map(building => ({ uid: building.uid, construction: building.construction, working: building.working, status: building.status })),
  traffic: simulation.saveState().actors.filter(actor => actor.visible && ["Carrier", "Mount"].includes(actor.job))
    .map(actor => ({ uid: actor.uid, job: actor.job, phase: actor.phase, ware: actor.ware,
      x: actor.x, z: actor.z, distance: distance.get(actor.uid) ?? 0, pathIndex: actor.pathIndex,
      outcome: movementOutcome(simulation.frames().find(candidate => candidate.uid === actor.uid)!),
      pathLength: actor.path.length, queueWait: actor.queueWait, queueTarget: actor.queueTarget,
      arrivalOrder: actor.storageArrivalOrder, arrivalBuilding: actor.storageArrivalBuilding,
      home: actor.home, building: actor.building, delivery: actor.delivery })) });
const snapshots = [snapshot()];
const reports: unknown[] = [];
for (const phase of ["saved-continuation"]) {
  for (let tick = 0; tick < 4800; tick++) {
    const before = new Map(simulation.frames().filter(actor => actor.visible)
      .map(actor => [actor.uid, { x: actor.x, z: actor.z }]));
    simulation.update(.05); elapsed += .05;
    for (const actor of simulation.frames()) {
      const previous = before.get(actor.uid);
      if (actor.visible && previous) distance.set(actor.uid, (distance.get(actor.uid) ?? 0) +
        Math.hypot(actor.x - previous.x, actor.z - previous.z));
    }
    if ((tick + 1) % 200 !== 0) continue;
    snapshots.push(snapshot());
    await writeFile(join(output, "report.json"), JSON.stringify({ sourcePath,
      sha256: createHash("sha256").update(bytes).digest("hex"), reports, snapshots }, null, 2));
    console.log(JSON.stringify({ phase, seconds: elapsed, visibleTraffic: snapshots.at(-1)!.traffic.length }));
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await writeFile(join(output, `${phase}.settlement.json`), JSON.stringify(simulation.saveState()));
}
const state = simulation.saveState();
const context = { ...state, options: { world, roads }, actors: simulation.frames(),
  buildings: simulation.buildings(), occupied: savedOccupancy(state).slice(),
  reservations: new Set(state.reservations), resourceAmounts: new Map(state.resourceAmounts) } as unknown as SettlementContext;
const home = simulation.headquarters;
await writeFile(join(output, "navigation.json"), JSON.stringify(context.actors.filter(actor => actor.visible &&
  Math.hypot(actor.x - home.access.x, actor.z - home.access.z) < 1).map(actor => ({
    uid: actor.uid, phase: actor.phase, startClear: isNavigationClear(context, actor),
    goalClear: isNavigationClear(context, home.access),
    route: findGroundPath(context, actor, home.access, undefined, undefined, .125, 512),
    target: actor.path[actor.pathIndex], outcome: movementOutcome(actor)
  })), null, 2));
