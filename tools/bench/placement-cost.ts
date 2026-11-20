import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { emitBenchJson } from "./bench-json";

/**
 * Player placement microbench (lane placement-perf): a generated 160² island with the live road rules (graded
 * roads, signpost strips, roads round buildings) and the player's headquarters.
 * 1. preview: `validatePlacement` on every plot within `PREVIEW_RADIUS` of the headquarters for a few types and all
 *    four turns (what the placement cursor asks);
 * 2. place: up to `PLACED` buildings near the headquarters, each followed by a road from its flag to the nearest
 *    road nodes (`connectRoads`, as the road tool lays it), as a player builds a town;
 * 3. roads: `planRoad` between deterministic point pairs of the grown town (found and failing plans).
 * Prints per phase the call count, average, p95 and worst (ms) and one hash over every verdict, route and the final
 * town, which must not change between a base and a lane. The modules are loaded from the working directory, so the
 * TOOL-4 runner measures its base checkout with the same steps:
 * npx tsx tools/bench/ab-runner.ts --base master ... -- <lane>/tools/bench/placement-cost.ts
 * Usage: npx tsx tools/bench/placement-cost.ts [repeats=2]
 */
const repeats = Number(process.argv[2] ?? 2);
const MAP_SIDE = 160;
const PREVIEW_RADIUS = 16;
const PLACED = 50;
const ROAD_PAIRS = 120;
const PLACE_RADIUS = 40;
const NEAREST_NODES = 3;
const PERCENTILE_95 = 0.95;
/** Woodcutter, quarry, forester, sawmill, mill, guardhouse (a mix of footprints, doors and sails). */
const TYPES = [17, 19, 20, 33, 31, 2] as const;
const STOCK = { logs: 9999, planks: 9999, stone: 9999 };

const load = <Module>(path: string): Promise<Module> =>
  import(pathToFileURL(resolve(path)).href) as Promise<Module>;
type Generate = typeof import("../../src/shared/world/generation/generate-world");
type Defaults = typeof import("../../src/shared/world/generation/default-world-options");
type Roads = typeof import("../../src/shared/settlement/road-network");
type Leveling = typeof import("../../src/shared/settlement/road-ground-leveling");
type Strips = typeof import("../../src/shared/settlement/settlement-road-strip-placement");
type Simulation = typeof import("../../src/shared/settlement/settlement-simulation");
type Hash = typeof import("../../src/shared/settlement/settlement-state-hash");
type Catalog = typeof import("../../src/render-common/buildings/building-catalog");
type Point = { x: number; z: number };

const [catalog, generate, defaults, roadsModule, leveling, strips, simulationModule, hash] = await Promise.all([
  load<Catalog>("src/render-common/buildings/building-catalog.ts"),
  load<Generate>("src/shared/world/generation/generate-world.ts"),
  load<Defaults>("src/shared/world/generation/default-world-options.ts"),
  load<Roads>("src/shared/settlement/road-network.ts"),
  load<Leveling>("src/shared/settlement/road-ground-leveling.ts"),
  load<Strips>("src/shared/settlement/settlement-road-strip-placement.ts"),
  load<Simulation>("src/shared/settlement/settlement-simulation.ts"),
  load<Hash>("src/shared/settlement/settlement-state-hash.ts")
]);

const world0 = generate.generateWorld({ ...defaults.DEFAULT_WORLD_OPTIONS, cellsX: MAP_SIDE, cellsZ: MAP_SIDE,
  erosionDroplets: 2000, landform: "island", mountains: 0, seed: 1234 });

const createIsland = () => {
  const world = structuredClone(world0);
  let simulation: ReturnType<Simulation["createSettlementSimulation"]> | undefined;
  const buildings = () => simulation?.buildings() ?? [];
  const isOccupied = (x: number, z: number) => simulation?.isOccupied(x, z) ?? false;
  const signposts = strips.createSignpostStakes(world, buildings);
  const roads = roadsModule.createRoadNetwork(world, {
    isBlocked: isOccupied, isStripReserved: signposts.isStripReserved,
    validateGradedRoads: (planned, existing) => leveling.canLevelRoadGround(world, planned, existing, buildings()) });
  simulation = simulationModule.createSettlementSimulation({ homeBuilding: 0, initialStock: STOCK, roads,
    unlockAllBuildings: true, world });
  return simulation;
};

const percentile = (values: readonly number[], fraction: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;
};
const summary = (values: readonly number[]) => ({
  avg: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), calls: values.length,
  max: Math.max(0, ...values), p95: percentile(values, PERCENTILE_95)
});
const timed = <T>(times: number[], run: () => T) => {
  const started = performance.now();
  const result = run();
  times.push(performance.now() - started);
  return result;
};

/** Plot centres round the headquarters, nearest first (ties by row, then column). */
const plotsAround = (centre: Point, radius: number) => {
  const plots: Point[] = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++)
    if (dx * dx + dz * dz <= radius * radius)
      plots.push({ x: Math.floor(centre.x) + dx, z: Math.floor(centre.z) + dz });
  return plots.sort((a, b) => (a.x - centre.x) ** 2 + (a.z - centre.z) ** 2 - (b.x - centre.x) ** 2 -
    (b.z - centre.z) ** 2 || a.z - b.z || a.x - b.x);
};
type Island = ReturnType<typeof createIsland>;
const footprints = new Map<number, readonly [number, number]>();
const centreOf = (typeId: number, plot: Point, rotation: number) => {
  const [width, depth] = footprints.get(typeId)!;
  const turned = rotation % 2 === 1;
  return { x: plot.x + (turned ? depth : width) / 2, z: plot.z + (turned ? width : depth) / 2 };
};

/** Road nodes and other flags nearest to `point` (distance, then z, then x). */
const nearestNodes = (island: Island, point: Point) => {
  const nodes = new Map<string, Point>();
  const add = (node: Point) => nodes.set(`${node.x}:${node.z}`, node);
  for (const { end, start } of island.roadSegments()) { add(start); add(end); }
  for (const building of island.buildings()) add(building.access);
  return [...nodes.values()].filter(node => node.x !== point.x || node.z !== point.z)
    .sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z) ||
      a.z - b.z || a.x - b.x).slice(0, NEAREST_NODES);
};

const previewPhase = (island: Island, centre: Point, verdicts: string[]) => {
  const times: number[] = [];
  for (const plot of plotsAround(centre, PREVIEW_RADIUS)) for (const typeId of TYPES)
    for (let rotation = 0; rotation < 4; rotation++) {
      const { x, z } = centreOf(typeId, plot, rotation);
      verdicts.push(timed(times, () => island.validatePlacement(typeId, x, z, rotation)) ?? "ok");
    }
  return times;
};

const placePhase = (island: Island, centre: Point, verdicts: string[]) => {
  const checks: number[] = [], places: number[] = [], roads: number[] = [];
  let placed = 0, index = 0;
  for (const plot of plotsAround(centre, PLACE_RADIUS)) {
    if (placed === PLACED) break;
    const typeId = TYPES[index++ % TYPES.length]!, rotation = index % 4;
    const { x, z } = centreOf(typeId, plot, rotation);
    if (timed(checks, () => island.validatePlacement(typeId, x, z, rotation))) continue;
    const result = timed(places, () => island.placeBuilding(typeId, x, z, rotation));
    verdicts.push(`${typeId}@${x},${z},${rotation}:${result.ok ? "placed" : result.reason}`);
    if (!result.ok || !result.building) continue;
    placed++;
    const flag = result.building.access;
    for (const node of nearestNodes(island, flag)) {
      const connected = timed(roads, () => island.connectRoads(flag, node));
      verdicts.push(`road ${flag.x},${flag.z}>${node.x},${node.z}:${connected}`);
      if (connected) break;
    }
  }
  return { checks, places, roads };
};

const roadPhase = (island: Island, centre: Point, verdicts: string[]) => {
  const times: number[] = [];
  const flags = island.buildings().map(building => building.access);
  for (let pair = 0; pair < ROAD_PAIRS; pair++) {
    const from = flags[pair % flags.length]!;
    const angle = pair * 2.399963, reach = 4 + (pair * 7) % 26;
    const to = { x: Math.round((centre.x + Math.cos(angle) * reach) * 2) / 2,
      z: Math.round((centre.z + Math.sin(angle) * reach) * 2) / 2 };
    const plan = timed(times, () => island.planRoad(from, to, "dirt"));
    verdicts.push(plan ? plan.points.map(point => `${point.x},${point.z}`).join(" ") : "none");
  }
  return times;
};

const measure = () => {
  const island = createIsland();
  const centre = island.headquarters;
  const verdicts: string[] = [];
  const preview = previewPhase(island, centre, verdicts);
  const { checks, places, roads } = placePhase(island, centre, verdicts);
  const plans = roadPhase(island, centre, verdicts);
  const town = hash.canonicalJson({ buildings: island.buildings().map(({ access, rotation, typeId, uid, x, z }) =>
    ({ access, rotation, typeId, uid, x, z })), roads: island.roadSegments() });
  return { check: summary(checks), connect: summary(roads), place: summary(places),
    placed: island.buildings().length - 1, plan: summary(plans), preview: summary(preview),
    stateHash: hash.hashText(verdicts.join("\n") + town) };
};

for (const typeId of TYPES) footprints.set(typeId, catalog.getBuildingDefinition(typeId).gridFootprint);
const runs = Array.from({ length: repeats }, measure);
const last = runs.at(-1)!;
const hashes = new Set(runs.map(run => run.stateHash));
const format = (value: number) => value.toFixed(4);
console.log("| phase | calls | avg ms | p95 ms | worst ms |");
console.log("| --- | --- | --- | --- | --- |");
for (const phase of ["preview", "check", "place", "connect", "plan"] as const)
  console.log(`| ${phase} | ${last[phase].calls} | ${format(last[phase].avg)} | ${format(last[phase].p95)} | ` +
    `${format(last[phase].max)} |`);
console.log(`placed ${last.placed}, hash ${last.stateHash}${hashes.size > 1 ? " (repeats differ)" : ""}`);
emitBenchJson({ placement: { ...last, repeatsIdentical: hashes.size === 1 } });
