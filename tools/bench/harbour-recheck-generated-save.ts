import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../../src/app/map-generator/helpers";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { BuildingType } from "../../src/shared/settlement/building-type-ids";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { storedHarbourSpots } from "../../src/shared/settlement/harbour-spot-index";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { sameLandmass } from "../../src/shared/settlement/settlement-landmass";
import { constructionCost } from "../../src/shared/settlement/settlement-placement";
import {
  createSettlementSimulation, type SettlementSimulation
} from "../../src/shared/settlement/settlement-simulation";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";

/**
 * HARBOUR-RECHECK fixture: a generated multi-island map (stored harbour spots) with a finished home
 * harbour, saved for `harbour-panel-query-timing.ts`. The start moves inland of the home site's designed
 * harbour plot; the harbour stands there (else on a stored spot or the nearest valid territory plot) and is
 * completed directly (a bench fixture, not a gameplay path).
 * Usage: SEED=1234 SIZE=512 ISLANDS=3 npx tsx tools/bench/harbour-recheck-generated-save.ts out.json
 */
const seed = Number(process.env.SEED ?? 1234);
const size = Number(process.env.SIZE ?? 512);
const islands = Number(process.env.ISLANDS ?? 3);
const outPath = resolve(process.argv[2] ?? "harbour-recheck-generated.json");
const HARBOUR = 39;
const START_INLAND = 18;

const query = new URLSearchParams(`size=${size}&landform=archipelago&islandCount=${islands}&harbourSpots=1`);
const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS,
  ...toWorldOptions(readIslandChoice(query, DEFAULT_ISLAND_CHOICE)), seed });
/** The start moves next to the home site's designed harbour plot, so it lies inside the start territory. */
const homeSite = world.playableIslands!.sites.reduce((best, site) =>
  Math.hypot(site.headquarters.x - world.start.x, site.headquarters.z - world.start.z) <
  Math.hypot(best.headquarters.x - world.start.x, best.headquarters.z - world.start.z) ? site : best);
const inland = Math.hypot(homeSite.x - homeSite.harbour.x, homeSite.z - homeSite.harbour.z);
world.start = { x: homeSite.harbour.x + (homeSite.x - homeSite.harbour.x) / inland * START_INLAND,
  z: homeSite.harbour.z + (homeSite.z - homeSite.harbour.z) / inland * START_INLAND };
let simulation: SettlementSimulation;
const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
simulation = createSettlementSimulation({ world, roads, developmentAllowed: false, playerNation: "roman",
  unlockAllBuildings: true, initialStock: Object.fromEntries(Object.keys({ ...constructionCost(HARBOUR),
    ...constructionCost(BuildingType.Woodcutter) }).map(ware => [ware, 400])) });
const home = simulation.home()!;
const spots = storedHarbourSpots(world).filter(spot => sameLandmass(world, spot, home));
/** Stored home spots first, then plots inside the start territory nearest the home building. */
const territoryPlots = function* () {
  const [width, depth] = getBuildingDefinition(HARBOUR).gridFootprint;
  const plots: Array<{ distance: number; x: number; z: number }> = [];
  for (let dz = -40; dz <= 40; dz++) for (let dx = -40; dx <= 40; dx++) {
    const x = Math.floor(home.x) + dx + width / 2, z = Math.floor(home.z) + dz + depth / 2;
    if (simulation.ownsTerritory({ x, z })) plots.push({ distance: Math.hypot(dx, dz), x, z });
  }
  plots.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
  for (const plot of plots) for (const rotation of [0, 1, 2, 3]) yield { ...plot, rotation };
};
const placeHarbour = () => {
  for (const plot of [homeSite.harbour, ...spots, ...territoryPlots()]) {
    if (simulation.validatePlacement(HARBOUR, plot.x, plot.z, plot.rotation)) continue;
    const placed = simulation.placeBuilding(HARBOUR, plot.x, plot.z, plot.rotation);
    if (placed.ok && placed.building) return placed.building;
  }
  throw new Error("No harbour plot inside the start territory");
};
const placed = { building: placeHarbour() };
Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {}, status: "Harbour" });
for (let step = 0; step < 200; step++) simulation.update(.05);
const save = await createGameSave(world, simulation.saveState(), { animals: [], name: "Harbour recheck fixture",
  savedAt: 1_000_000, source: "generated" });
await writeFile(outPath, JSON.stringify(save));
console.log(JSON.stringify({ harbour: placed.building.uid, homeSpots: spots.length, outPath, seed,
  spots: storedHarbourSpots(world).length }));
