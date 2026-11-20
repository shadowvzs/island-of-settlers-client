import { STARTER_STOCK } from "@shared/catalog/balance";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { advanceOfflineGame } from "../../src/app/settlement/offline-progress";
import { getSettlementUiSnapshot } from "../../src/app/settlement/settlement-ui-state";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { BUILD } from "../../src/shared/world/world-data";

const check: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
/** Finite, explicitly flattened fixture: real recruitment/work, full serializer and actual offline replay. */
export const productionProgressFixture = async (nation: WorkerNation, type: number) => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 0 });
  world.heights.fill(2); world.blocking.fill(0); world.walkCost.fill(10); world.buildClass.fill(BUILD.large);
  world.buildCap.fill(BUILD.large); world.slopeClass.fill(0); world.seaLevel = -1;
  world.props.count = 0; world.start = { x: 10, z: 10 };
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, playerNation: nation, initialSettlers: 20,
    initialStock: { ...STARTER_STOCK, logs: 20, grain: 0, grapes: 0, honey: 0, coconut: 0, rice: 0 } });
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const placed = simulation.placeBuilding(type, 20 + width / 2, 18 + depth / 2);
  check(placed.ok && placed.building, placed.reason ?? "Fixture placement failed");
  const uid = placed.building.uid;
  Object.assign(placed.building, { construction: 1, required: {} });
  check(simulation.connectRoads(simulation.headquarters.access, placed.building.access), "Fixture road failed");
  const actor = () => simulation.frames().find(entry => entry.uid === placed.building!.worker);
  let ticks = 0;
  for (; ticks < 24000; ticks++) {
    simulation.update(.05);
    const worker = actor();
    if (worker?.phase !== "work" || !worker.productionSeconds) continue;
    if (type !== 33 && worker.fieldWork !== "harvest") continue;
    if (worker.timer < worker.productionSeconds * .65 && worker.timer > worker.productionSeconds * .4) break;
  }
  check(ticks < 24000, `${nation}/${type}: no actual active cycle ${JSON.stringify(actor())}`);
  const snapshot = (sim: typeof simulation) => {
    const result = getSettlementUiSnapshot(sim, []);
    const building = result.buildings?.find(entry => Number(entry.id) === uid);
    check(building && building.workProgress !== undefined, `${nation}/${type}: no authoritative progress bar`);
    return { building, snapshot: result, actor: sim.frames().find(entry => entry.uid === placed.building!.worker) };
  };
  const active = snapshot(simulation);
  const save = await createGameSave(world, simulation.saveState(), {
    name: `UI03 ${nation} ${type}`, savedAt: 1_000_000, source: "generated", animals: [] });
  const restore = async (source: typeof save) => {
    const loaded = await stageGameSession(source), world = loaded.map.world;
    let sim: typeof simulation;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => sim?.isOccupied(x, z) ?? false });
    sim = createSettlementSimulation({ world, roads, playerNation: nation });
    const result = sim.loadState(loaded.settlement);
    if (!result.ok) throw new Error(result.reason);
    return sim;
  };
  const restored = snapshot(await restore(JSON.parse(JSON.stringify(save))));
  check(restored.building.workProgress === active.building.workProgress, "Reload changed production bar");
  const resumedSave = await advanceOfflineGame(save, save.savedAt + 500);
  check(resumedSave.savedAt === save.savedAt + 500, "Offline cursor did not advance");
  const offline = snapshot(await restore(resumedSave));
  check(offline.building.workProgress! > active.building.workProgress!, "Actual offline work did not advance bar");
  check(offline.actor?.phase === active.actor?.phase, "Offline sample crossed cycle unexpectedly");
  return { nation, save, type, uid, ticks, assists: { flattenedWorld: true, finishedInitialSite: true,
    finiteStarterStock: true, recruitedActualWorker: true, offlineMilliseconds: 500 },
    states: { active, restored, offline } };
};
