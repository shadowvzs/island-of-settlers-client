import { displayFogAt } from "../../shared/world/fog-display";
import type { GridSize } from "../../shared/world/grid-geometry";
import { FOG, NO_MINE_ZONE, ORE, type WorldData } from "../../shared/world/world-data";

/** Group of a cell for the outline: cells with the same non zero group share one outline. */
export type CellGroup = (cell: number) => number;

/** One closed outline: cell corner points (world x, z pairs, first corner not repeated). */
export interface CellOutline {
  group: number;
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
  points: number[];
}

/** The loops (outer border and holes) of one surveyed ore deposit. */
export interface DepositOutline {
  ore: number;
  outlines: CellOutline[];
}

/** The outlines of the mine land and of the surveyed ore deposits inside it. */
export interface MineOutlines {
  deposits: DepositOutline[];
  mineLand: CellOutline[];
}

/** Cell sides as (neighbour dx, dz) and the side's corners clockwise around the cell. */
const SIDES = [
  { dx: 0, dz: -1, from: [0, 0], to: [1, 0] },
  { dx: 1, dz: 0, from: [1, 0], to: [1, 1] },
  { dx: 0, dz: 1, from: [1, 1], to: [0, 1] },
  { dx: -1, dz: 0, from: [0, 1], to: [0, 0] }
] as const;

const getNeighbourGroup = (grid: GridSize, groupOf: CellGroup, x: number, z: number) => {
  if (x < 0 || z < 0 || x >= grid.cellsX || z >= grid.cellsZ) return 0;
  return groupOf(z * grid.cellsX + x);
};

/** Directed border sides per group: start corner -> end corners (corner = z * (cellsX + 1) + x). */
const collectBorderSides = (grid: GridSize, groupOf: CellGroup) => {
  const corners = grid.cellsX + 1;
  const sidesByGroup = new Map<number, Map<number, number[]>>();
  for (let z = 0; z < grid.cellsZ; z += 1) {
    for (let x = 0; x < grid.cellsX; x += 1) {
      const group = groupOf(z * grid.cellsX + x);
      if (group === 0) continue;
      for (const { dx, dz, from, to } of SIDES) {
        if (getNeighbourGroup(grid, groupOf, x + dx, z + dz) === group) continue;
        const sides = sidesByGroup.get(group) ?? new Map<number, number[]>();
        sidesByGroup.set(group, sides);
        const start = (z + from[1]) * corners + x + from[0];
        const ends = sides.get(start) ?? [];
        ends.push((z + to[1]) * corners + x + to[0]);
        sides.set(start, ends);
      }
    }
  }
  return sidesByGroup;
};

const createOutline = (group: number, cornerLoop: number[], corners: number): CellOutline => {
  const outline = { group, maxX: -Infinity, maxZ: -Infinity, minX: Infinity, minZ: Infinity };
  const points: number[] = [];
  for (const corner of cornerLoop) {
    const x = corner % corners;
    const z = Math.floor(corner / corners);
    points.push(x, z);
    outline.minX = Math.min(outline.minX, x);
    outline.maxX = Math.max(outline.maxX, x);
    outline.minZ = Math.min(outline.minZ, z);
    outline.maxZ = Math.max(outline.maxZ, z);
  }
  return { ...outline, points };
};

/** Walks the border sides from `start` until it is back there (every corner balances in / out). */
const walkLoop = (sides: Map<number, number[]>, start: number) => {
  const loop: number[] = [];
  let corner = start;
  do {
    loop.push(corner);
    const ends = sides.get(corner)!;
    const next = ends.pop()!;
    if (ends.length === 0) sides.delete(corner);
    corner = next;
  } while (corner !== start);
  return loop;
};

/**
 * Closed outlines along the cell borders of every group (outer borders and holes alike), walked
 * clockwise around the group's cells. A cell touching another group's cell, an outside cell or
 * the map edge is a border. Pinched corners (two cells meeting diagonally) may join two loops.
 */
export const traceCellOutlines = (grid: GridSize, groupOf: CellGroup) => {
  const corners = grid.cellsX + 1;
  const outlines: CellOutline[] = [];
  for (const [group, sides] of collectBorderSides(grid, groupOf)) {
    while (sides.size > 0) {
      const start = sides.keys().next().value!;
      outlines.push(createOutline(group, walkLoop(sides, start), corners));
    }
  }
  return outlines;
};

/** The surveyed zone with ore of a cell (its id), else 0: ore stays hidden until surveyed. */
const createDepositGroup =
  (world: WorldData): CellGroup =>
  (cell) => {
    if (displayFogAt(world, cell) === FOG.hidden) return 0;
    const id = world.mineZone[cell]!;
    if (id === NO_MINE_ZONE) return 0;
    const zone = world.mineZones[id - 1];
    if (!zone?.surveyed || zone.ore === ORE.none) return 0;
    return id;
  };

/**
 * The mine land as one region (fields of one ore and barren gravel alike, so an unsurveyed
 * deposit inside the gravel does not show) plus every surveyed ore deposit on its own.
 */
export const traceMineOutlines = (world: WorldData): MineOutlines => {
  const isMineLand: CellGroup = (cell) =>
    world.mineZone[cell] === NO_MINE_ZONE || displayFogAt(world, cell) === FOG.hidden ? 0 : 1;
  const deposits = new Map<number, DepositOutline>();
  for (const zone of world.mineZones) {
    if (zone.surveyed && zone.ore !== ORE.none)
      deposits.set(zone.id, { ore: zone.ore, outlines: [] });
  }
  if (deposits.size > 0) {
    for (const outline of traceCellOutlines(world, createDepositGroup(world))) {
      deposits.get(outline.group)!.outlines.push(outline);
    }
  }
  return {
    deposits: [...deposits.values()].filter(({ outlines }) => outlines.length > 0),
    mineLand: traceCellOutlines(world, isMineLand)
  };
};

/** Changes when the mine land or a survey changes (rebuild the outlines then). */
export const getMineOutlineKey = (world: WorldData) => {
  const surveyed = world.mineZones
    .map((zone) => `${zone.id}:${Number(zone.surveyed)}:${zone.ore}`)
    .join();
  return `${world.buildRevision ?? 0}/${world.fogRevision ?? 0}/${surveyed}`;
};
