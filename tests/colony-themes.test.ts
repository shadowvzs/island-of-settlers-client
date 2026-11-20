import { describe, expect, it, vi } from "vitest";

import { ADVENTURE_THEMES } from "../src/shared/settlement/adventure-themes";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { colonyMineSites } from "../src/shared/settlement/colony-mine-sites";
import { chooseColonyWorld } from "../src/shared/settlement/colony-world-choice";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { reachableCells } from "../src/shared/settlement/settlement-colony";
import { createSettlementFieldCycles } from "../src/shared/settlement/settlement-field-cycles";
import { findUsableOrePlots } from "../src/shared/settlement/settlement-ore-placement";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { colonyResourcePair } from "../src/shared/world/colony-resource-tiers";
import { createPlantedTreeSpecies,isTreePlantingTerrain } from "../src/shared/world/editing/tree-planting";
import { BUILD, ORE, PROP } from "../src/shared/world/world-data";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

// Owner 2026-10-18: tiered colonies grow only their selected advanced timber (hardwood .. mahogany).
const TREE_TYPES = new Set<number>([PROP.broadleafTree, PROP.coniferTree, PROP.palmTree, PROP.birchTree,
  PROP.hardwoodTree, PROP.cedarTree, PROP.walnutTree, PROP.mahoganyTree]);
describe("buildable themed colonies", () => {
  it.each(ADVENTURE_THEMES)("%s retains a harbour, complete defenders, reachable timber and deposits", theme => {
    const island = { ...colonyIslandOffers(1234)[0]!, theme, difficulty: "hard" as const, ore: "ironOre" as const };
    const world = chooseColonyWorld(island);
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), homeBuilding: 39,
      initialSettlers: 0, initialStock: {} });
    expect(simulation.startColony({ island, troops: [], landed: {} })).toEqual({ ok: true });
    expect(world.expeditionKind).toBe("colony"); expect(world.expeditionTheme).toBe(theme);
    expect(world.adventureTheme).toBeUndefined();
    expect(simulation.home()!.typeId).toBe(39);
    expect(colonyMineSites(world, simulation.home()!, 3)).toHaveLength(3);
    const home = simulation.home()!;
    const inward = { x: world.cellsX / 2 - home.x, z: world.cellsZ / 2 - home.z };
    const facing = { x: Math.sin(home.rotation * Math.PI / 2), z: Math.cos(home.rotation * Math.PI / 2) };
    expect(facing.x * inward.x + facing.z * inward.z).toBeGreaterThan(0);
    expect(simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) > 0)).toHaveLength(41);
    const context = { options: { world }, buildings: [], occupied: new Uint8Array(world.cellsX * world.cellsZ) };
    const reachable = reachableCells(context as never, simulation.home()!.access);
    const trees = Array.from({ length: world.props.count }, (_, index) => index)
      .filter(index => TREE_TYPES.has(world.props.types[index]!) && reachable({ x: world.props.x[index]!, z: world.props.z[index]! }));
    expect(trees.length).toBeGreaterThanOrEqual(15);
    expect(world.props.types.slice(0, world.props.count)).not.toContain(PROP.flowers);
    expect(world.mineZones.some(zone => zone.ore === ORE.iron && zone.surveyed)).toBe(true);
    const freeBuildingCells = world.buildCap.reduce((count, size, cell) => count + Number(size >= BUILD.small &&
      reachable({ x: cell % world.cellsX + .5, z: Math.floor(cell / world.cellsX) + .5 })), 0);
    expect(freeBuildingCells).toBeGreaterThan(100);
    const plantable = [];
    for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
      if (isTreePlantingTerrain(world, x + .5, z + .5) && reachable({ x: x + .5, z: z + .5 }))
        plantable.push({ x: x + .5, z: z + .5 });
    }
    expect(plantable.length).toBeGreaterThanOrEqual(30);
    const species = createPlantedTreeSpecies(world);
    const regrown = plantable.slice(0, 30).map(point => species(point.x, point.z));
    expect(regrown.every(type => TREE_TYPES.has(type))).toBe(true);
    // Tiered colony foresters replant only the island's selected timber, whatever the climate.
    expect(new Set(regrown)).toEqual(new Set([colonyResourcePair(world.colonyResourceTier!).treeKind]));

    // Exercise the real crop-site rules and sow/grow/harvest engine on the actual climate terrain.
    const farmContext = { options: { world, roads: createRoadNetwork(world), findWorkerPath: (_from: unknown, to: unknown) => [to] },
      buildings: [], occupied: new Uint8Array(world.cellsX * world.cellsZ), reservations: new Set(),
      nextBuilding: 1, playerNation: "roman" } as unknown as SettlementContext;
    // An advertised deposit must accept a real mine foundation and a reachable door.
    const oreCells = Array.from(world.oreAmount, (amount, cell) => amount &&
      world.mineZones.some(zone => zone.id === world.mineZone[cell] && zone.ore === ORE.iron) ? cell : -1)
      .filter(cell => cell >= 0);
    const minePlots = findUsableOrePlots(farmContext, oreCells, ORE.iron);
    expect(minePlots.some(plot => reachable(plot.access))).toBe(true);
    const candidates = plantable.sort((a, b) => Math.hypot(a.x - world.start.x, a.z - world.start.z) -
      Math.hypot(b.x - world.start.x, b.z - world.start.z));
    let produced = false;
    for (const point of candidates.slice(0, 50)) {
      const farm = makeBuilding(farmContext, 37, point.x, point.z, 0);
      farmContext.buildings = [farm];
      const cycles = createSettlementFieldCycles(farmContext);
      const target = cycles.findWork(farm);
      if (!target) continue;
      expect(cycles.complete(farm, target.target)).toEqual({ success: true });
      cycles.update(180);
      expect(cycles.complete(farm, target.target)).toEqual({ success: true, ware: "grain" });
      produced = true; break;
    }
    expect(produced).toBe(true);
  }, 60000);
});
