import { ORE, type Ore, type WorldData } from "../world/world-data";
import { makeBuilding, placementReason } from "./settlement-placement";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** Reuse production placement checks on an isolated candidate deposit. No live terrain,
 * inventory, zone records or counters change when an editor stamp is refused. */
export const hasUsableOrePlot = (world: WorldData, cells: readonly number[], ore: Ore) => {
  const id = world.mineZones.length + 1;
  const candidate: WorldData = { ...world, mineZone: world.mineZone.slice(),
    oreAmount: world.oreAmount.slice(), mineZones: [...world.mineZones, {
      id, ore, richness: 1, surveyed: false, cellCount: cells.length, centreX: 0, centreZ: 0
    }] };
  for (const cell of cells) { candidate.mineZone[cell] = id; candidate.oreAmount[cell] = 1; }
  const context: SettlementContext = {
    options: { world: candidate, roads: { route: () => null, addRoad: () => {}, upgradeRoad: () => {} } },
    buildings: [], actors: [], occupied: new Uint8Array(world.buildClass.length),
    reservations: new Set(), nextBuilding: 0, nextActor: 0, settlers: 0,
    resourceAmounts: new Map(), accumulator: 0, scheduling: 0, transfers: []
  };
  return findUsableOrePlots(context, cells, ore, 1).length > 0;
};

/** Real mine foundations may cover ordinary land and need only one matching ore cell.
 * Stop early for editor preflight; audits retain every legal rotation and anchor. */
const enumerateOrePlots = (
  context: SettlementContext, cells: readonly number[], ore: Ore, limit = Infinity
) => {
  const plots: SettlementBuilding[] = [];
  if (ore === ORE.none || limit <= 0) return plots;
  const { world } = context.options;
  const typeId = 10 + [ORE.granite, ORE.coal, ORE.iron, ORE.gold].findIndex(value => value === ore);
  const tried = new Set<string>();
  for (const cell of cells) {
    const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (let rotation = 0; rotation < 4; rotation++) {
      const probe = makeBuilding(context, typeId, 0, 0, rotation);
      for (let dz = 0; dz < probe.depth; dz++) for (let dx = 0; dx < probe.width; dx++) {
        const left = x - dx, top = z - dz, key = `${left}/${top}/${rotation}`;
        if (tried.has(key)) continue;
        tried.add(key);
        const plot = makeBuilding(context, typeId, left + probe.width / 2, top + probe.depth / 2, rotation);
        if (placementReason(context, plot)) continue;
        plots.push(plot);
        if (plots.length >= limit) return plots;
      }
    }
  }
  return plots;
};

export const findUsableOrePlots = (
  context: SettlementContext, cells: readonly number[], ore: Ore, limit = Infinity
) => {
  const nextBuilding = context.nextBuilding;
  try {
    return enumerateOrePlots(context, cells, ore, limit);
  } finally {
    context.nextBuilding = nextBuilding;
  }
};

/** Greedy capacity, with exact bounded search when it falls short of the requested minimum.
 * This is a planning/audit operation, never per frame or during each deposit-growth cell.
 * Existing buildings and occupancy are preserved, including on exceptional exit. */
export const countCompatibleOrePlots = (
  context: SettlementContext, plots: readonly SettlementBuilding[], minimum = 3,
  onSelection?: (plots: SettlementBuilding[]) => void
) => {
  const buildings = context.buildings, occupied = context.occupied;
  context.buildings = [...buildings];
  context.occupied = occupied.slice();
  const place = (plot: SettlementBuilding, value: number) => {
    const { cellsX } = context.options.world;
    const left = plot.x - plot.width / 2, top = plot.z - plot.depth / 2;
    for (let z = top; z < top + plot.depth; z++)
      context.occupied.fill(value, z * cellsX + left, z * cellsX + left + plot.width);
    context.occupied[Math.floor(plot.access.z) * cellsX + Math.floor(plot.access.x)] = value ? 2 : 0;
  };
  try {
    let count = 0;
    for (const plot of plots) {
      if (placementReason(context, plot)) continue;
      count++;
      context.buildings.push(plot);
      place(plot, 1);
    }
    if (count >= minimum) {
      onSelection?.(context.buildings.slice(buildings.length, buildings.length + minimum));
      return count;
    }
    context.buildings = [...buildings];
    context.occupied.set(occupied);
    const search = (start: number) => {
      count = Math.max(count, context.buildings.length - buildings.length);
      if (count >= minimum) {
        onSelection?.(context.buildings.slice(buildings.length));
        return;
      }
      for (let index = start; index < plots.length && count < minimum; index++) {
        const plot = plots[index]!;
        if (placementReason(context, plot)) continue;
        context.buildings.push(plot);
        place(plot, 1);
        search(index + 1);
        context.buildings.pop();
        place(plot, 0);
      }
    };
    search(0);
    return count;
  } finally {
    context.buildings = buildings;
    context.occupied = occupied;
  }
};
