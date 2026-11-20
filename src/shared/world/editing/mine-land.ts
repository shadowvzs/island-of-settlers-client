import { hasUsableOrePlot } from "../../settlement/settlement-ore-placement";
import { createZoneRecord, getOreAmount } from "../generation/mine-zones";
import { type CellRegion, getCellsRegion, type GridSize } from "../grid-geometry";
import { type MineZone, NO_MINE_ZONE, ORE, type Ore, type WorldData } from "../world-data";
import { type Brush,CELL_PAINT_WEIGHT, listPaintedCells } from "./brush";
import type { EditRefusal } from "./edit-refusal";

/** Richness of an ore deposit stamped in the editor (generated deposits: 0.6 .. 1). */
const EDITOR_ORE_RICHNESS = 0.85;

const getZone = (world: WorldData, id: number): MineZone | undefined => world.mineZones[id - 1];

const isBarren = (world: WorldData, id: number) => getZone(world, id)?.ore === ORE.none;

/** Neighbour cells (4-neighbourhood) inside the grid. */
const listNeighbours = (grid: GridSize, cell: number) => {
  const x = cell % grid.cellsX;
  const z = Math.floor(cell / grid.cellsX);
  const neighbours: number[] = [];
  if (x > 0) neighbours.push(cell - 1);
  if (x < grid.cellsX - 1) neighbours.push(cell + 1);
  if (z > 0) neighbours.push(cell - grid.cellsX);
  if (z < grid.cellsZ - 1) neighbours.push(cell + grid.cellsX);
  return neighbours;
};

/** A barren zone beside the cell (to grow), else NO_MINE_ZONE. */
const findBarrenNeighbour = (world: WorldData, cell: number) =>
  listNeighbours(world, cell).find((next) => {
    const id = world.mineZone[next]!;
    return id !== NO_MINE_ZONE && isBarren(world, id);
  }) ?? -1;

/** A new zone record (no cells yet) appended to the world; returns its id. */
const addZone = (world: WorldData, ore: Ore, richness: number) => {
  const id = world.mineZones.length + 1;
  const zone = { ...createZoneRecord(world, [], id), ore, richness, surveyed: false };
  world.mineZones.push(zone);
  return id;
};

/**
 * Recounts the cells and the centre of the zones (ids stay: an emptied zone keeps its record
 * with 0 cells, so the ids of the others never change).
 */
const refreshZoneRecords = (world: WorldData, ids: ReadonlySet<number>) => {
  if (ids.size === 0) return;
  const cells = new Map([...ids].map((id): [number, number[]] => [id, []]));
  world.mineZone.forEach((id, cell) => cells.get(id)?.push(cell));
  for (const [id, list] of cells) {
    const zone = getZone(world, id);
    if (!zone) continue;
    zone.cellCount = list.length;
    if (list.length === 0) continue;
    const record = createZoneRecord(world, list, id);
    zone.centreX = record.centreX;
    zone.centreZ = record.centreZ;
  }
};

/**
 * Turns the cells into mine land (barren): each joins a barren zone beside it, else one new
 * barren zone of this call. Returns the zones that changed.
 */
export const addMineLand = (world: WorldData, cells: readonly number[]) => {
  const changed = new Set<number>();
  let created = NO_MINE_ZONE;
  for (const cell of cells) {
    if (world.mineZone[cell] !== NO_MINE_ZONE) continue;
    const neighbour = findBarrenNeighbour(world, cell);
    if (neighbour < 0 && created === NO_MINE_ZONE) created = addZone(world, ORE.none, 0);
    const id = neighbour < 0 ? created : world.mineZone[neighbour]!;
    world.mineZone[cell] = id;
    world.oreAmount[cell] = 0;
    changed.add(id);
  }
  refreshZoneRecords(world, changed);
  return changed;
};

/** The cells stop being mine land (their ore goes with it). Returns the zones that changed. */
export const removeMineLand = (world: WorldData, cells: readonly number[]) => {
  const changed = new Set<number>();
  for (const cell of cells) {
    const id = world.mineZone[cell]!;
    if (id === NO_MINE_ZONE) continue;
    changed.add(id);
    world.mineZone[cell] = NO_MINE_ZONE;
    world.oreAmount[cell] = 0;
  }
  refreshZoneRecords(world, changed);
  return changed;
};

/** Explicit mine eraser: ground appearance, height and standing props stay unchanged. */
export const eraseMineLand = (world: WorldData, brush: Brush): OreStamp => {
  const cells = listPaintedCells(world, brush).map(({ cell }) => cell)
    .filter(cell => world.mineZone[cell] !== NO_MINE_ZONE);
  return { cells: getCellsRegion(world, cells), zoneIds: removeMineLand(world, cells) };
};

/** The deposit of this ore covering most of the cells (to extend), else NO_MINE_ZONE. */
const findDepositToExtend = (world: WorldData, cells: readonly number[], ore: Ore) => {
  const counts = new Map<number, number>();
  for (const cell of cells) {
    const id = world.mineZone[cell]!;
    if (getZone(world, id)?.ore === ore) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const best = [...counts].sort((first, second) => second[1] - first[1])[0];
  return best ? best[0] : NO_MINE_ZONE;
};

type PaintedCell = ReturnType<typeof listPaintedCells>[number];

export interface OreStamp {
  cells: CellRegion;
  /** Zones that changed: the deposit and the zones it took cells from. */
  zoneIds: Set<number>;
}

/** Brush cover of a painted cell as its depth in the deposit: 0 at the rim .. 1 in the core. */
const toCore = (weight: number) => (weight - CELL_PAINT_WEIGHT) / (1 - CELL_PAINT_WEIGHT);

/**
 * Stamps an ore deposit onto the mine land under the brush, hidden like generated ore until it
 * is surveyed (or "Reveal ore deposits" is on); other
 * ground is left alone. The cells join a deposit of the same ore they overlap, else a new one;
 * the ore amount rises from the brush rim to its core (never lowered by a weaker stamp).
 */
export const stampOreDeposit = (
  world: WorldData,
  brush: Brush,
  ore: Ore
): OreStamp | EditRefusal => {
  const painted = listPaintedCells(world, brush).filter(
    ({ cell }) => world.mineZone[cell] !== NO_MINE_ZONE
  );
  if (painted.length === 0) return "notMineLand";
  const cells = painted.map(({ cell }) => cell);
  const extended = findDepositToExtend(world, cells, ore);
  const candidateCells = [...cells];
  if (extended !== NO_MINE_ZONE) world.mineZone.forEach((zone, cell) => {
    if (zone === extended && world.oreAmount[cell]! > 0) candidateCells.push(cell);
  });
  if (!hasUsableOrePlot(world, candidateCells, ore)) return "noMinePlot";
  const id = extended === NO_MINE_ZONE ? addZone(world, ore, EDITOR_ORE_RICHNESS) : extended;
  return { cells: getCellsRegion(world, cells), zoneIds: assignOreCells(world, painted, id) };
};

/** The painted cells join the deposit, their ore rising from the brush rim to its core. */
const assignOreCells = (world: WorldData, painted: readonly PaintedCell[], id: number) => {
  const { richness } = getZone(world, id)!;
  const zoneIds = new Set([id]);
  for (const { cell, weight } of painted) {
    const previous = world.mineZone[cell] === id ? world.oreAmount[cell]! : 0;
    zoneIds.add(world.mineZone[cell]!);
    world.mineZone[cell] = id;
    world.oreAmount[cell] = Math.max(previous, getOreAmount(richness, toCore(weight)));
  }
  refreshZoneRecords(world, zoneIds);
  return zoneIds;
};

/**
 * A new deposit of the ore on the brushed cells, whatever their ground (world generation: a
 * deposit on open land). The caller checks the cells are free and hold a mine plot.
 */
export const addOreDeposit = (world: WorldData, brush: Brush, ore: Ore, richness: number) =>
  assignOreCells(world, listPaintedCells(world, brush), addZone(world, ore, richness));
