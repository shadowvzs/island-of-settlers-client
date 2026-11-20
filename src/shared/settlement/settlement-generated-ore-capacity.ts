import { markWorldChangedAll } from "../world/save/world-change-journal";
import { BLOCKING, BUILD, ORE, type WorldData } from "../world/world-data";
import { countCompatibleOrePlots, findUsableOrePlots } from "./settlement-ore-placement";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

const DEPOSIT_BUDGET = 170;
const EXTENSION_DEPTH = 6;

const planningContext = (world: WorldData): SettlementContext => ({
  options: { world, roads: { route: () => null, addRoad: () => {}, upgradeRoad: () => {} } },
  buildings: [], actors: [], occupied: new Uint8Array(world.cellsX * world.cellsZ),
  reservations: new Set(), nextBuilding: 0, nextActor: 0, settlers: 0,
  resourceAmounts: new Map(), accumulator: 0, scheduling: 0, transfers: []
});

const extensionPaths = (world: WorldData, cells: number[]) => {
  const parents = new Map(cells.map(cell => [cell, -1]));
  let frontier = cells;
  for (let depth = 0; depth < EXTENSION_DEPTH; depth++) {
    const next: number[] = [];
    for (const cell of frontier) {
      const x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
      const neighbours = [x > 0 ? cell - 1 : -1, x + 1 < world.cellsX ? cell + 1 : -1,
        z > 0 ? cell - world.cellsX : -1, z + 1 < world.cellsZ ? cell + world.cellsX : -1];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || parents.has(neighbour) || world.mineZone[neighbour]) continue;
        if (world.blocking[neighbour] === BLOCKING.water || world.blocking[neighbour] === BLOCKING.cliff ||
          (world.buildCap?.[neighbour] ?? world.buildClass[neighbour]!) < BUILD.flag) continue;
        parents.set(neighbour, cell);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return parents;
};

const selectExtension = (
  world: WorldData, selected: SettlementBuilding[], parents: Map<number, number>, cells: number[]
) => {
  const extension = new Set(cells);
  const path = (cell: number) => {
    const result: number[] = [];
    while (!extension.has(cell)) {
      result.push(cell);
      cell = parents.get(cell) ?? -1;
      if (cell < 0) return null;
    }
    return result;
  };
  for (const plot of selected) {
    let best: number[] | null = null;
    for (let z = plot.z - plot.depth / 2; z < plot.z + plot.depth / 2; z++) {
      for (let x = plot.x - plot.width / 2; x < plot.x + plot.width / 2; x++) {
        const cell = z * world.cellsX + x;
        if (!parents.has(cell)) continue;
        const candidate = path(cell);
        if (candidate && (!best || candidate.length < best.length)) best = candidate;
      }
    }
    if (!best) return null;
    best.forEach(cell => extension.add(cell));
  }
  return extension.size <= DEPOSIT_BUDGET ? [...extension] : null;
};

/** Generated deposits only. Prove three real mine plots first, then extend ore along the
 * shortest dry-land links to those plots. Never flatten terrain or delete a scarce patch. */
export const improveGeneratedOreCapacity = (world: WorldData, minimum = 3) => {
  const context = planningContext(world);
  for (const zone of world.mineZones) {
    if (zone.ore === ORE.none) continue;
    const cells: number[] = [];
    world.mineZone.forEach((id, cell) => { if (id === zone.id) cells.push(cell); });
    if (cells.length >= DEPOSIT_BUDGET) continue;
    if (countCompatibleOrePlots(context, findUsableOrePlots(context, cells, zone.ore)) >= minimum) continue;
    const parents = extensionPaths(world, cells);
    const candidate = { ...world, mineZone: world.mineZone.slice(), oreAmount: world.oreAmount.slice() };
    const amount = Math.max(1, Math.round(255 * zone.richness * .45));
    parents.forEach((_, cell) => { candidate.mineZone[cell] = zone.id; candidate.oreAmount[cell] ||= amount; });
    context.options.world = candidate;
    let selected: SettlementBuilding[] = [];
    const plots = findUsableOrePlots(context, [...parents.keys()], zone.ore);
    countCompatibleOrePlots(context, plots, minimum, selection => { selected = selection; });
    context.options.world = world;
    if (selected.length < minimum) continue;
    const extension = selectExtension(world, selected, parents, cells);
    if (!extension) continue;
    for (const cell of extension) {
      world.mineZone[cell] = zone.id;
      world.oreAmount[cell] ||= amount;
    }
    markWorldChangedAll(world);
    zone.cellCount = extension.length;
    zone.centreX = extension.reduce((sum, cell) => sum + cell % world.cellsX + .5, 0) / extension.length;
    zone.centreZ = extension.reduce((sum, cell) => sum + Math.floor(cell / world.cellsX) + .5, 0) / extension.length;
  }
};
