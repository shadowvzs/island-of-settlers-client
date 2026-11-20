import type { RoadDecorationItemId } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { BuildingType } from "../../src/shared/settlement/building-type-ids";
import type { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementPoint } from "../../src/shared/settlement/settlement-types";
import type { WorldData } from "../../src/shared/world/world-data";

/**
 * HARBOUR-RECHECK bench edits: one deterministic player edit of each kind near the home building, as
 * the owner makes them between two Harbour page opens. Every edit returns a short description, or
 * null when the island offers no valid spot for it.
 */
type Simulation = ReturnType<typeof createSettlementSimulation>;
export type HarbourPanelEdit = "bridge" | "decoration" | "demolish" | "level" | "place" | "road";
export const DECORATION_ITEM: RoadDecorationItemId = "roadDecoration:indigenous-flower-pot:native";
const SEARCH_RADIUS = 40;

/** Integer-edged plot centres around `centre`, nearest first (deterministic order). */
const plotCentres = (world: WorldData, typeId: number, centre: SettlementPoint) => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const result: Array<SettlementPoint & { distance: number }> = [];
  for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz++)
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      const x = Math.floor(centre.x) + dx + width / 2, z = Math.floor(centre.z) + dz + depth / 2;
      if (x < width || z < depth || x > world.cellsX - width || z > world.cellsZ - depth) continue;
      result.push({ distance: Math.hypot(dx, dz), x, z });
    }
  return result.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
};

/** Whether the plot's corner heights differ (a Leveler must work it before construction). */
const needsLevelling = (world: WorldData, typeId: number, plot: SettlementPoint) => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  const left = plot.x - width / 2, top = plot.z - depth / 2, stride = world.cellsX + 1;
  let lowest = Infinity, highest = -Infinity;
  for (let z = top; z <= top + depth; z++) for (let x = left; x <= left + width; x++) {
    const height = world.heights[z * stride + x]!;
    lowest = Math.min(lowest, height); highest = Math.max(highest, height);
  }
  return highest - lowest > .05;
};

const placeNear = (simulation: Simulation, world: WorldData, levelled: boolean) => {
  const typeId = BuildingType.Woodcutter, home = simulation.home()!;
  for (const plot of plotCentres(world, typeId, home)) {
    if (levelled !== needsLevelling(world, typeId, plot)) continue;
    if (simulation.validatePlacement(typeId, plot.x, plot.z, 0)) continue;
    const placed = simulation.placeBuilding(typeId, plot.x, plot.z, 0);
    if (placed.ok && placed.building) return placed.building;
  }
  return null;
};

const buildRoad = (simulation: Simulation, world: WorldData) => {
  const home = simulation.home()!;
  for (const plot of plotCentres(world, BuildingType.Well, home)) {
    if (plot.distance < 8) continue;
    const start = { x: plot.x, z: plot.z }, end = { x: plot.x + 5, z: plot.z };
    if (!simulation.planRoad(start, end, "dirt")) continue;
    if (simulation.connectRoads(start, end)) return `${start.x},${start.z} -> ${end.x},${end.z}`;
  }
  return null;
};

const placeDecoration = (simulation: Simulation) => {
  const home = simulation.home()!;
  const segments = simulation.roadSegments().filter(segment => !segment.bridge)
    .map(segment => ({ segment, distance: Math.hypot(segment.start.x - home.x, segment.start.z - home.z) }))
    .sort((a, b) => a.distance - b.distance);
  for (const { segment } of segments) for (const offset of [1, -1, 1.5, -1.5]) {
    const horizontal = segment.start.z === segment.end.z;
    const position = { x: (segment.start.x + segment.end.x) / 2 + (horizontal ? 0 : offset),
      z: (segment.start.z + segment.end.z) / 2 + (horizontal ? offset : 0) };
    const order = { item: DECORATION_ITEM, position, yaw: 0 };
    if (!simulation.planRoadDecoration(order).ok) continue;
    const placed = simulation.placeRoadDecoration(order);
    if (placed.ok) return `${position.x},${position.z}`;
  }
  return null;
};

/** A wooden bridge over the nearest river crossing the home island offers. */
const buildBridge = (simulation: Simulation, world: WorldData) => {
  const home = simulation.home()!, stride = world.cellsX + 1;
  for (const plot of plotCentres(world, BuildingType.Well, home)) {
    const vertex = Math.floor(plot.z) * stride + Math.floor(plot.x);
    if (!(world.waterDepth[vertex]! > 0) || world.heights[vertex]! < world.seaLevel) continue;
    if (!simulation.previewBridge(plot, "wood").ok) continue;
    const built = simulation.buildBridge(plot, "wood");
    if (built.ok) return `${plot.x},${plot.z} (${built.plan.tiles} tiles)`;
  }
  return null;
};

/** Connects a planned site's entrance to the nearest road point, so its Leveler and builders can come. */
const connectToRoads = (simulation: Simulation, access: SettlementPoint) => {
  const ends = simulation.roadSegments().flatMap(segment => [segment.start, segment.end])
    .sort((a, b) => Math.hypot(a.x - access.x, a.z - access.z) - Math.hypot(b.x - access.x, b.z - access.z));
  return ends.slice(0, 12).some(end => simulation.connectRoads(access, end));
};

/**
 * Runs one edit; `demolish` removes the building the latest `place`/`level` edit planned. A `level`
 * site is connected to the roads so that its Leveler can reach it.
 */
export const createHarbourPanelEdits = (simulation: Simulation, world: WorldData) => {
  let placed: number | null = null;
  const place = (levelled: boolean) => {
    const building = placeNear(simulation, world, levelled);
    if (!building) return null;
    placed = building.uid;
    const connected = levelled && connectToRoads(simulation, building.access) ? " (road)" : "";
    return `${building.typeId}@${building.x},${building.z}${connected}`;
  };
  const demolish = () => {
    if (placed === null) return null;
    const uid = placed;
    placed = null;
    return simulation.demolishBuilding(uid).ok ? `uid ${uid}` : null;
  };
  const edits: Record<HarbourPanelEdit, () => string | null> = {
    bridge: () => buildBridge(simulation, world),
    decoration: () => placeDecoration(simulation),
    demolish,
    level: () => place(true),
    place: () => place(false),
    road: () => buildRoad(simulation, world)
  };
  return (edit: HarbourPanelEdit) => edits[edit]();
};
