import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../../src/render-common/buildings/building-grid-metrics";
import { MATERIAL_BUILDING_GROUPS } from "../../src/shared/settlement/advanced-material-production";
import { adventureOffers } from "../../src/shared/settlement/adventure-rules";
import type { ColonyRecord } from "../../src/shared/settlement/archipelago";
import { colonyIslandOffers } from "../../src/shared/settlement/colony-expedition-rules";
import { chooseAdventureWorld } from "../../src/shared/settlement/colony-world-choice";
import { createGameSave, type GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { Goods } from "../../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { BUILD, MATERIAL, MATERIAL_COUNT, ORE, PROP } from "../../src/shared/world/world-data";
import { fakeColonyConquest } from "../../tests/helpers/fake-colony-conquest";

/** Reproducible legal group: retained developed home, three real colony economies and one adventure. */
const developed = process.argv.includes("--developed-colonies");
const paths = process.argv.slice(2).filter(argument => argument !== "--developed-colonies");
const homePath = resolve(paths[0] ?? "public/demo/continued-0.json");
const output = resolve(paths[1] ?? "../resources/project-reviews/offline-owner-scale-2026-11-05/fixture.json");
const bytes = await readFile(homePath);
const home = JSON.parse(bytes.toString()) as GameSaveV1;
await stageGameSession(home);
assert.equal(home.version, 3);
assert.equal(home.archipelago, undefined, "Use an independent developed home as the source");
const start = home.savedAt;
const side = developed ? 96 : 64, shore = side - 24, shift = shore - 40;

const flatCoastalWorld = (seed: number) => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, seed, cellsX: side, cellsZ: side, erosionDroplets: 0 });
  world.heights.fill(2); world.blocking.fill(0); world.walkCost.fill(10);
  world.buildClass.fill(BUILD.large); world.buildCap.fill(BUILD.large); world.slopeClass.fill(0);
  world.seaLevel = .5; world.props.count = 0; world.start = { x: 10, z: shore - 9 };
  world.splat.fill(0);
  for (let index = MATERIAL.grass; index < world.splat.length; index += MATERIAL_COUNT) world.splat[index] = 255;
  for (let z = shore; z <= side; z++) for (let x = 0; x <= side; x++) world.heights[z * (side + 1) + x] = -1;
  for (let z = shore; z < side; z++) for (let x = 0; x < side; x++) {
    const cell = z * side + x;
    world.walkCost[cell] = 0; world.blocking[cell] = 1; world.buildClass[cell] = 0;
  }
  return world;
};

const colony = async (index: number): Promise<ColonyRecord> => {
  const group = MATERIAL_BUILDING_GROUPS[index]!;
  const world = flatCoastalWorld(1234 + index);
  world.colonyResourceTier = group.tier;
  world.colonyStoneDeposits = [{ id: 0, x: 14, z: 20 + shift, remaining: 48, material: group.stone }];
  world.props.count = 1; world.props.types[0] = PROP[group.tree];
  world.props.x[0] = 22; world.props.z[0] = 23 + shift; world.props.scale[0] = 1;
  let simulation: ReturnType<typeof createSettlementSimulation>;
  let draftPlot: { left: number; right: number; top: number; bottom: number } | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => !!draftPlot &&
    x >= draftPlot.left && x < draftPlot.right && z >= draftPlot.top && z < draftPlot.bottom ||
    (simulation?.isOccupied(x, z) ?? false) });
  const stock: Goods = developed ? { axe: 8, pickaxe: 8, saw: 8, shovel: 8, hammer: 8, scythe: 8,
    rollingPin: 8, cleaver: 8, fishingRod: 8, bow: 8, planks: 160, stone: 160,
    logs: 80, fish: 80, grain: 80, water: 80, flour: 40, pig: 20, sword: 2, shield: 2, beer: 2 } :
    { axe: 2, pickaxe: 2, saw: 2, shovel: 2, planks: 20, stone: 20 };
  simulation = createSettlementSimulation({ world, roads, initialSettlers: developed ? 80 : 12, initialStock: stock,
    homeBuilding: 39, now: () => start, canWorkerEnterPlot: () => true });
  const island = { ...colonyIslandOffers(1234)[index]!, resourceTier: group.tier,
    ...(developed ? { ore: (["coal", "ironOre", "goldOre"] as const)[index]! } : {}) };
  assert(simulation.startColony({ island, landed: stock, troops: [] }).ok);
  fakeColonyConquest(simulation);
  const place = (type: number, x: number, z: number) => {
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    const placed = simulation.placeBuilding(type, x + width % 2 / 2, z + shift + depth % 2 / 2);
    assert(placed.ok && placed.building, placed.reason ?? "Colony building placement failed");
    Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
    assert(simulation.connectRoads(simulation.headquarters.access, placed.building.access));
    return placed.building;
  };
  place(group.forester, 15, 17); place(group.woodcutter, 22, 17);
  const sawmill = place(33, 27, 25);
  sawmill.workshopUpgrade = { level: group.tier };
  assert(simulation.setProductionMode(sawmill.uid, group.planks));
  place(group.quarry, 22, 34);
  if (developed) {
    const complete = (building: ReturnType<typeof simulation.placeBuilding>["building"]) => {
      assert(building);
      Object.assign(building, { construction: 1, foundationProgress: 1, required: {} });
      // Placement can automatically join a nearby existing road; addRoad then reports no change.
      assert(simulation.connectRoads(simulation.headquarters.access, building.access) ||
        roads.route(simulation.headquarters.access, building.access));
    };
    const candidates = Array.from({ length: 8 }, (_, row) => row * 8 + 6).flatMap(z =>
      Array.from({ length: 11 }, (_, column) => ({ x: column * 8 + 6, z })));
    candidates.sort((a, b) => Math.hypot(a.x - 10, a.z - (shore - 9)) -
      Math.hypot(b.x - 10, b.z - (shore - 9)));
    const nearby = (type: number) => {
      const [width, depth] = getBuildingDefinition(type).gridFootprint;
      for (const point of candidates) {
        const x = point.x + width % 2 / 2, z = point.z + depth % 2 / 2;
        draftPlot = { left: x - width / 2, right: x + width / 2,
          top: z - depth / 2, bottom: z + depth / 2 };
        const plan = simulation.planRoad(simulation.headquarters.access,
          getPlacedBuildingLogistics(type, x, z, 0).road, "dirt");
        draftPlot = undefined;
        if (!plan) continue;
        const placed = simulation.placeBuilding(type, x, z);
        if (!placed.ok) continue;
        complete(placed.building);
        return placed.building!;
      }
      throw new Error(`No legal developed-colony plot for ${type}`);
    };
    const fortress = nearby(9);
    const guard = simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
    assert(guard !== null, "Stocked fixture must recruit its real territory guard");
    assert.equal(simulation.garrisonMilitary([guard], fortress.uid), 1);
    for (let tick = 0; tick < 2_400 && !fortress.territoryClaimed; tick++) simulation.update(.05);
    simulation.territory();
    assert(fortress.territoryClaimed, "A real stationed soldier must expand the colony before development");
    console.log(`Colony ${index + 1}: territory guard stationed`);
    for (const type of [59, 58, 57, 35, 37, 31, 32, 28, 21, 37, 35, 22]) nearby(type);
    // One authored finite seam per colony, then canonical mine placement and food delivery.
    const type = 11 + index, ore = [ORE.coal, ORE.iron, ORE.gold][index]!;
    const [width, depth] = getBuildingDefinition(type).gridFootprint;
    let mined = false;
    for (const point of candidates) {
      world.mineZone.fill(0); world.oreAmount.fill(0);
      const centreX = point.x + width % 2 / 2, centreZ = point.z + depth % 2 / 2;
      const left = Math.floor(centreX - width / 2), top = Math.floor(centreZ - depth / 2);
      for (let z = top; z < top + depth; z++) for (let x = left; x < left + width; x++) {
        world.mineZone[z * side + x] = 1; world.oreAmount[z * side + x] = 1_000;
      }
      world.mineZones = [{ id: 1, ore, centreX, centreZ,
        cellCount: width * depth, richness: 1, surveyed: true }];
      const placed = simulation.placeBuilding(type, centreX, centreZ);
      if (!placed.ok) continue;
      complete(placed.building); mined = true; break;
    }
    assert(mined, "No legal developed-colony mine plot");
  }
  // Fixture preparation only: recruit real workers before the zero-prefix production measurement.
  for (let tick = 0; tick < 2_400; tick++) simulation.update(.05);
  if (developed) {
    // Move finite existing stock onto a real incoming hull; authoring adds no extra goods.
    const inventory = simulation.headquarters.inventory;
    assert((inventory.planks ?? 0) >= 3);
    assert.notEqual(simulation.sendVisitorShip({ planks: 3 }, [], "supply", undefined, 30), null);
    inventory.planks = (inventory.planks ?? 0) - 3;
  }
  const save = await createGameSave(world, simulation.saveState(), {
    name: `Coupled tier ${group.tier} colony`, savedAt: start, source: "generated", animals: []
  });
  save.settlement.playerNation = home.settlement.playerNation;
  await stageGameSession(save);
  console.log(`Colony ${index + 1}: ${save.settlement.buildings.length} buildings prepared`);
  return { expeditionId: 7 + index, island, status: "conquered", conqueredAt: start,
    nextOreShipAt: start + 3_600_000, save };
};

const colonies: ColonyRecord[] = [];
for (let index = 0; index < 3; index++) colonies.push(await colony(index));
const adventureIsland = adventureOffers(1234).find(island => island.difficulty === "easy")!;
const adventureWorld = chooseAdventureWorld(adventureIsland);
const adventureSimulation = createSettlementSimulation({ world: adventureWorld,
  roads: createRoadNetwork(adventureWorld), homeBuilding: null, initialSettlers: 0,
  initialStock: {}, now: () => start, canWorkerEnterPlot: () => true });
assert(adventureSimulation.startAdventure({ island: adventureIsland,
  troops: Array.from({ length: 3 }, () => ({ hp: 125, rank: 1, type: "heavy" as const })) }).ok);
const adventure = await createGameSave(adventureWorld, adventureSimulation.saveState(), {
  name: "Coupled archived adventure", savedAt: start, source: "generated", animals: []
});
home.archipelago = { active: null, version: 1, colonies,
  adventures: [{ expeditionId: 10, island: adventureIsland, status: "contested", save: adventure }] };
await stageGameSession(home); await stageGameSession(adventure);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(home));
const saves = [home, ...colonies.map(entry => entry.save!), adventure];
const manifest = { generatedAt: new Date().toISOString(), sourceHome: homePath,
  sourceHomeSha256: createHash("sha256").update(bytes).digest("hex"),
  fixture: output, fixtureSha256: createHash("sha256").update(JSON.stringify(home)).digest("hex"),
  version: home.version, islands: saves.map((save, index) => ({ id: index === 0 ? "home" : String(index + 6),
    world: save.settlement.world, buildings: save.settlement.buildings.length,
    actors: save.settlement.actors.length, fields: save.settlement.fields.length,
    ships: save.settlement.naval.fleet.ships.length })), developedColonies: developed,
  scope: `Retained source home plus three authored ${side}-square real colony economies and a generated 96-square adventure; not five independent homes. Native ticks prepare fixtures only, never startup catch-up.` };
await writeFile(resolve(dirname(output), "fixture-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
