import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { MATERIAL_BUILDING_GROUPS } from "../src/shared/settlement/advanced-material-production";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { ResourceTarget } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const cases = [{ forester: 20, tier: 0 as const, tree: "broadleafTree" as const }, ...MATERIAL_BUILDING_GROUPS]
  .flatMap(group => [false, true].map(reload => ({ ...group, reload })));

it.each(cases)("returns the real seedling when construction replaces the in-flight tier$tier target (reload=$reload)", ({ forester, reload, tier, tree }) => {
  const world = huntingWorld();
  world.colonyResourceTier = tier === 0 ? undefined : tier;
  world.start = { x: 10, z: 31 };
  if (tier) {
    world.colonyStoneDeposits = [{ id: 0, x: 60, z: 2, remaining: 2, material: MATERIAL_BUILDING_GROUPS.find(group => group.tier === tier)!.stone }];
    world.seaLevel = .5;
    for (let z = 40; z <= 64; z++) for (let x = 0; x <= 64; x++) world.heights[z * 65 + x] = -1;
    for (let z = 40; z < 64; z++) for (let x = 0; x < 64; x++) {
      const cell = z * 64 + x;
      world.walkCost[cell] = 0; world.blocking[cell] = 1; world.buildClass[cell] = 0;
    }
  }
  const planted: ResourceTarget[] = [];
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const stock = { shovel: 1, hammer: 1, planks: 20, stone: 20 };
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 12, initialStock: stock,
    canWorkerEnterPlot: building => building.typeId === forester,
    homeBuilding: tier ? 39 : 0, onPlantTree: target => { planted.push(target as ResourceTarget); return true; } });
  if (tier) {
    const island = { ...colonyIslandOffers(1234)[0]!, resourceTier: tier };
    expect(simulation.startColony({ island, landed: stock, troops: [] }).ok).toBe(true);
    for (const fort of simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0))
      expect(simulation.removeMilitaryScenarioBuilding(fort.uid).ok).toBe(true);
    for (let tick = 0; tick < 20; tick++) simulation.update(.05);
  }
  let placed: ReturnType<typeof simulation.placeBuilding> | undefined;
  nurserySearch: for (const dx of [-8, 8, -12, 12, 0]) for (const dz of [-8, -12, -4, 4]) {
    const candidate = simulation.placeBuilding(forester, Math.round(simulation.headquarters.x) + dx,
      Math.round(simulation.headquarters.z) + dz);
    if (!candidate.ok) continue;
    placed = candidate; break nurserySearch;
  }
  expect(placed?.ok).toBe(true);
  const nursery = placed!.building!;
  Object.assign(nursery, { construction: 1, foundationProgress: 1, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, nursery.access)).toBe(true);
  const [width, depth] = getBuildingDefinition(4).gridFootprint;
  let target: ResourceTarget | undefined, construction: number | undefined, uid: number | undefined;
  for (let tick = 0; tick < 3000 && construction === undefined; tick++) {
    simulation.update(.05);
    const worker = simulation.frames().find(actor => actor.building === nursery.uid && actor.phase === "foresterPlantWalk");
    if (!worker?.target || Math.hypot(worker.x - worker.target.x, worker.z - worker.target.z) < 3) continue;
    siteSearch: for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      const x = Math.floor(worker.target.x) + width % 2 / 2 + dx, z = Math.floor(worker.target.z) + depth % 2 / 2 + dz;
      if (Math.abs(worker.x - x) < width / 2 + .2 && Math.abs(worker.z - z) < depth / 2 + .2) continue;
      const result = simulation.placeBuilding(4, x, z);
      if (!result.ok) continue;
      target = { ...worker.target }; uid = worker.uid; construction = result.building!.uid;
      break siteSearch;
    }
  }
  expect(construction, "A legal new construction must actually cover the walking forester's target").toBeDefined();
  const previousPlantings = planted.length;
  if (reload) expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
  let sawPhysicalReturn = false, returned = false;
  for (let tick = 0; tick < 2400 && !returned; tick++) {
    simulation.update(.05);
    const actor = simulation.frames().find(worker => worker.uid === uid)!;
    const building = simulation.buildings().find(building => building.uid === nursery.uid)!;
    if (actor.phase.startsWith("foresterReturn")) {
      sawPhysicalReturn = true;
      expect(building.nurserySeedlingTaken).toBe(true);
      expect(actor.foresterSeedling).toBeDefined();
    }
    returned = sawPhysicalReturn && !building.nurserySeedlingTaken && !actor.foresterSeedling;
  }
  expect(sawPhysicalReturn).toBe(true);
  expect(returned).toBe(true);
  expect(planted).toHaveLength(previousPlantings);
  expect(simulation.saveState().reservations).not.toContain(`plant:${target!.id}`);
  expect(simulation.frames().find(worker => worker.uid === uid)!.tool).toBe("shovel");
  for (let tick = 0; tick < 2400 && planted.length === previousPlantings; tick++) simulation.update(.05);
  expect(planted.length).toBeGreaterThan(previousPlantings);
  if (tier) expect(planted.at(-1)!.treeSpecies).toBe(tree);
  const blocked = simulation.buildings().find(building => building.uid === construction)!;
  expect(planted.every(point => Math.abs(point.x - blocked.x) > blocked.width / 2 ||
    Math.abs(point.z - blocked.z) > blocked.depth / 2)).toBe(true);
});
