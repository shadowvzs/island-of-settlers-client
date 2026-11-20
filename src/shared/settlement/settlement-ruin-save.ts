import type { SparseCells } from "./save-cell-codecs";
import { isFiniteNumber, isSaveGoods, isSaveInteger, isSaveObject, isSavePoint } from "./save-validation";
import { clearsRuin } from "./settlement-ruin-clearing";
import { RUIN_CELL, ruinCells, type SettlementRuin } from "./settlement-ruins";
import type { SettlementActor } from "./settlement-types";

type SavedRecord = Record<string, unknown>;

/** A whole plot on the grid: positive size and a centre whose corner lands on a cell edge. */
const validPlot = (ruin: SavedRecord) =>
  isSaveInteger(ruin.width, 1) && isSaveInteger(ruin.depth, 1) && isFiniteNumber(ruin.x) && isFiniteNumber(ruin.z) &&
  Number.isInteger((ruin.x as number) - (ruin.width as number) / 2) &&
  Number.isInteger((ruin.z as number) - (ruin.depth as number) / 2) && isSaveInteger(ruin.rotation) &&
  isSavePoint(ruin.access);

/** The clearing job's saved fields: work seconds, backoff in game ticks, and an existing clearer at work. */
const validJob = (ruin: SavedRecord, workers: ReadonlyMap<unknown, SavedRecord>) => {
  if (ruin.work !== undefined && (!isFiniteNumber(ruin.work) || ruin.work < 0)) return false;
  if (ruin.fallTick !== undefined && !isSaveInteger(ruin.fallTick)) return false;
  const backoff = [ruin.failures, ruin.retryTick, ruin.stamp];
  if (backoff.some(value => value !== undefined) && !backoff.every(value => isSaveInteger(value))) return false;
  if (ruin.clearer === undefined) return true;
  const clearer = workers.get(ruin.clearer);
  return clearer !== undefined && clearsRuin(clearer as unknown as SettlementActor, ruin.uid as number);
};

/**
 * Saved ruins (BD2): unique uids that no building uses, whole plots, salvage goods, and a clearer that exists
 * and works on a ruin. Returns the problem, or null.
 */
export const savedRuinsProblem = (value: unknown, buildings: readonly unknown[], actors: readonly unknown[]) => {
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.length) return "Invalid ruins";
  const uids = new Set(buildings.filter(isSaveObject).map(building => building.uid)), clearers = new Set<unknown>();
  const workers = new Map(actors.filter(isSaveObject).map(actor => [actor.uid, actor]));
  for (const ruin of value as unknown[]) {
    if (!isSaveObject(ruin) || !isSaveInteger(ruin.uid) || uids.has(ruin.uid) || !isSaveInteger(ruin.typeId) ||
      !isSaveInteger(ruin.owner) || !validPlot(ruin) || !isSaveGoods(ruin.salvage) || !validJob(ruin, workers))
      return "Invalid ruin";
    if (ruin.clearer !== undefined && clearers.has(ruin.clearer)) return "Ruin clearer assigned twice";
    uids.add(ruin.uid);
    if (ruin.clearer !== undefined) clearers.add(ruin.clearer);
  }
  return null;
};

/**
 * Occupancy value 3 only on cells of saved ruins (call after `savedRuinsProblem`): a stray ruin cell is malformed.
 */
export const ruinCellsMatch = (occupied: SparseCells, ruins: readonly SettlementRuin[] | undefined, cellsX: number) => {
  const cells = new Set((ruins ?? []).flatMap(ruin => ruinCells(ruin, cellsX)));
  let index = -1;
  for (let pair = 0; pair < occupied.cells.length; pair += 2) {
    index += occupied.cells[pair]!;
    if (occupied.cells[pair + 1] === RUIN_CELL && !cells.has(index)) return false;
  }
  return true;
};

/** A loaded copy of the saved ruins (absent when there is none). */
export const restoreRuins = (saved: readonly SettlementRuin[] | undefined) => saved?.length
  ? saved.map(ruin => ({ ...ruin, access: { ...ruin.access }, salvage: { ...ruin.salvage } })) : undefined;
