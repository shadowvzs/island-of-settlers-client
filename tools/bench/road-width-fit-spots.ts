import { readFileSync } from "node:fs";

import { createBuildingFitSpots } from "../../src/app/build-overlay/building-fit-spots";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../../src/render-common/buildings/building-grid-metrics";
import { readGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSignpostStakes } from "../../src/shared/settlement/settlement-road-strip-placement";
import {
  createSettlementSimulation,
  type SettlementSimulation
} from "../../src/shared/settlement/settlement-simulation";

/**
 * Building spots in a real town: every plot of the territory where a building fits (the
 * placement overlay's fit-spot scan), per type and rotation: all of them, those within two cells
 * of a road and those whose flag sits on a road node (connected on placement), plus how many more
 * road half-cells the player could still draw. Run before/after a placement rule change:
 * `npx tsx tools/bench/road-width-fit-spots.ts [save.json ...]`
 */
const SAVES = process.argv.slice(2);
const TYPES = [35, 17, 29, 32, 37];

const loadTown = async (path: string) => {
  const loaded = await readGameSave(JSON.parse(readFileSync(path, "utf8")));
  const { world } = loaded.map;
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => !!simulation && simulation.isOccupied(x, z),
    isStripReserved: createSignpostStakes(world, () => simulation?.buildings() ?? []).isStripReserved });
  simulation = createSettlementSimulation({ roads, world });
  const result = simulation.loadState(loaded.settlement);
  if (!result.ok) throw new Error(result.reason);
  return { roads, simulation, world };
};

type Town = Awaited<ReturnType<typeof loadTown>>;
type SpotCounts = { all: number; nearRoad: number; onRoad: number };

const roadNodes = (town: Town) => {
  const nodes = new Map<string, { x: number; z: number }>();
  for (const segment of town.roads.segments())
    for (const point of [segment.start, segment.end]) nodes.set(`${point.x}:${point.z}`, point);
  return nodes;
};

const nearRoad = (nodes: Map<string, { x: number; z: number }>, left: number, top: number, width: number,
  depth: number) => {
  for (const { x, z } of nodes.values())
    if (x >= left - 2 && x <= left + width + 2 && z >= top - 2 && z <= top + depth + 2) return true;
  return false;
};

const countFitSpots = (town: Town, typeId: number, rotation: number): SpotCounts => {
  const spots = createBuildingFitSpots({ getOwnership: () => town.simulation.territory().owned,
    validatePlacement: town.simulation.validatePlacement, world: town.world });
  const selection = { rotation, typeId };
  while (spots.update(selection, "measure", { x: 0, z: 0 }, 1e9) >= 0 && spots.isScanning());
  const markers = spots.markers();
  const counts = { all: 0, nearRoad: 0, onRoad: 0 };
  if (!markers) return counts;
  const nodes = roadNodes(town);
  markers.marks.forEach((mark, cell) => {
    if (!mark) return;
    const left = cell % town.world.cellsX, top = (cell - left) / town.world.cellsX;
    const { road } = getPlacedBuildingLogistics(typeId, left + markers.width / 2, top + markers.depth / 2, rotation);
    counts.all++;
    if (nearRoad(nodes, left, top, markers.width, markers.depth)) counts.nearRoad++;
    if (nodes.has(`${road.x}:${road.z}`)) counts.onRoad++;
  });
  return counts;
};

/** Road half-cells a player could still start from an existing node and build one step outwards. */
const countRoadSteps = (town: Town) => {
  const nodes = roadNodes(town);
  let open = 0;
  for (const point of nodes.values())
    for (const [dx, dz] of [[.5, 0], [-.5, 0], [0, .5], [0, -.5]]) {
      const next = { x: point.x + dx!, z: point.z + dz! };
      if (nodes.has(`${next.x}:${next.z}`)) continue;
      if (town.roads.planRoad(point, next)) open++;
    }
  return { nodes: nodes.size, open };
};

for (const path of SAVES) {
  const town = await loadTown(path);
  const segments = town.roads.segments();
  console.log(`\n${path}: ${town.simulation.buildings().length} buildings, ${segments.length} road edges ` +
    `(${segments.filter(segment => segment.tier === "stone").length} stone)`);
  for (const typeId of TYPES) {
    const counts = [0, 1, 2, 3].map(rotation => countFitSpots(town, typeId, rotation));
    const name = getBuildingDefinition(typeId).name;
    const total = (key: keyof SpotCounts) => counts.reduce((sum, count) => sum + count[key], 0);
    console.log(`${name.padEnd(12)} all ${total("all")}, near a road ${total("nearRoad")}, ` +
      `flag on a road ${total("onRoad")}`);
  }
  const steps = countRoadSteps(town);
  console.log(`road nodes ${steps.nodes}, buildable outward steps ${steps.open}`);
}
