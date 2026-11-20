import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { RUIN_CLEARING_SECONDS, RUIN_RETRY_CAP_SECONDS, RUIN_RETRY_SECONDS } from "../balance/military";
import { bumpBuildRevision } from "../world/save/world-change-journal";
import { buildRevisionSinceLoad, roadRevisionSinceLoad } from "./settlement-load-revisions";
import { ownerOf } from "./settlement-ownership";
import { bumpNavigationRevision } from "./settlement-reservations";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * BUILDING-DESTRUCTION BD2 (plan review B6-B8): the ruin a fallen building of an owner with an economy leaves.
 * It continues the fort ruin of `MilitaryStructure.fallen`: the building itself is removed on its fall (or at
 * the end of its burn-down), and the ruin keeps its plot occupied until the clearing job
 * (`settlement-ruin-clearing.ts`) carries the salvage away. Ruins of owners without an economy are never
 * recorded: their fallen building crumbles after `FORT_REMOVAL_SECONDS`, as forts always did.
 * Saved as `ruins` (absent when there is none); the uid is the fallen building's.
 */
export interface SettlementRuin {
  uid: number;
  typeId: number;
  /** The faction whose economy clears it (`ownerOf` of the fallen building). */
  owner: number;
  /** The fallen building's plot: centre and size in cells, rotation and road access. */
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  access: SettlementPoint;
  /** What the clearing yields (`ruinSalvage`), carried to storage by the clearer. */
  salvage: Goods;
  /** The clearer's actor uid while one is assigned. */
  clearer?: number;
  /** Seconds of clearing work done so far (kept when a clearer flees). */
  work?: number;
  /** Game tick of the fall: the scorched ground around the ruin fades with its age (render only, ruin-scorch.ts). */
  fallTick?: number;
  /** Backoff after an unreachable search (B8a, game ticks): next retry, failures so far, navigation stamp. */
  retryTick?: number;
  failures?: number;
  stamp?: number;
}

/** The placement refusal over a ruin (plan review B8h). */
export const RUIN_PLACEMENT_REASON = "A ruin is being cleared here";

type Plot = Pick<SettlementRuin, "depth" | "width" | "x" | "z">;

const plotLeft = (plot: Plot) => plot.x - plot.width / 2;
const plotTop = (plot: Plot) => plot.z - plot.depth / 2;

/** The cells of a ruin's plot. */
export const ruinCells = (ruin: Plot, cellsX: number) => {
  const cells: number[] = [];
  for (let z = plotTop(ruin); z < plotTop(ruin) + ruin.depth; z++)
    for (let x = plotLeft(ruin); x < plotLeft(ruin) + ruin.width; x++) cells.push(z * cellsX + x);
  return cells;
};

/**
 * The occupancy of a ruin's cells: like a building's (1) it refuses buildings, roads, fields and decorations,
 * but people walk over the rubble (the building-yard rule blocks only bare cells of value 1), so a ruin never
 * strands anyone on its plot or cuts a neighbour's way (plan review B8d).
 */
export const RUIN_CELL = 3;

/** Whether a cell holds a building or a ruin (roads and entrance roads avoid both). */
export const isBuiltCell = (value: number | undefined) => value === 1 || value === RUIN_CELL;

/** Marks every ruin's plot: part of the occupancy rebuild after a removal. */
export const markRuinOccupancy = (context: Pick<SettlementContext, "occupied" | "options" | "ruins">) => {
  for (const ruin of context.ruins ?? [])
    for (const cell of ruinCells(ruin, context.options.world.cellsX)) context.occupied[cell] = RUIN_CELL;
};

/** A ruin overlapping the plot rectangle (cells `left..left+width`, `top..top+depth`), if any. */
const ruinOverlapping = (context: Pick<SettlementContext, "ruins">, left: number, top: number, width: number,
  depth: number) => context.ruins?.find(ruin => plotLeft(ruin) < left + width && left < plotLeft(ruin) + ruin.width &&
  plotTop(ruin) < top + depth && top < plotTop(ruin) + ruin.depth);

/** Why a plot cannot be built: a ruin lies on it (before the generic occupied check). */
export const ruinPlacementReason = (context: Pick<SettlementContext, "ruins">, plot: Plot) =>
  ruinOverlapping(context, plotLeft(plot), plotTop(plot), plot.width, plot.depth) ? RUIN_PLACEMENT_REASON : undefined;

/** Seconds of work a ruin takes: its plot's longer side (up to 4, 5, larger) picks 10, 15 or 20 s. */
export const ruinClearingSeconds = (ruin: Plot) => {
  const side = Math.max(ruin.width, ruin.depth);
  if (side <= 4) return RUIN_CLEARING_SECONDS[0];
  return side <= 5 ? RUIN_CLEARING_SECONDS[1] : RUIN_CLEARING_SECONDS[2];
};

/** Records the ruin of a fallen building; call before the building is removed so the plot stays occupied. */
export const recordRuin = (context: SettlementContext, site: SettlementBuilding, salvage: Goods) => {
  const ruin: SettlementRuin = { access: { x: site.access.x, z: site.access.z }, depth: site.depth,
    fallTick: context.clock?.tick(), owner: ownerOf(site), rotation: site.rotation, salvage, typeId: site.typeId,
    uid: site.uid, width: site.width, x: site.x, z: site.z };
  if (ruin.fallTick === undefined) delete ruin.fallTick;
  (context.ruins ??= []).push(ruin);
  return ruin;
};

/** The ruin is cleared: its plot becomes free ground (a navigation change of exactly its cells). */
export const removeRuin = (context: SettlementContext, ruin: SettlementRuin) => {
  const ruins = context.ruins ?? [];
  const index = ruins.indexOf(ruin);
  if (index < 0) return;
  ruins.splice(index, 1);
  if (!ruins.length) context.ruins = undefined;
  const cells = ruinCells(ruin, context.options.world.cellsX);
  for (const cell of cells) if (context.occupied[cell] === RUIN_CELL) context.occupied[cell] = 0;
  bumpNavigationRevision(context, cells);
  bumpBuildRevision(context.options.world, null);
};

/**
 * Building and road changes since the island's logical epoch (saved, so a load keeps a ruin's backoff): either
 * may make an unreachable ruin reachable.
 */
const navigationStamp = (context: SettlementContext) =>
  buildRevisionSinceLoad(context) + roadRevisionSinceLoad(context);

/**
 * Plan review B8a/b: a ruin found unreachable waits until its saved retry tick, unless navigation or building
 * changed since; that reset is coalesced because each ruin is looked at only once per second.
 */
export const ruinInBackoff = (
  context: SettlementContext, ruin: SettlementRuin, tick: number
) => ruin.retryTick !== undefined && tick < ruin.retryTick && ruin.stamp === navigationStamp(context);

/** The ruin was found unreachable and nothing that could change that has moved since. */
export const ruinKnownUnreachable = (
  context: SettlementContext, ruin: SettlementRuin
) => ruin.failures !== undefined && ruin.stamp === navigationStamp(context);

/** One more failure: the retry delay doubles from `RUIN_RETRY_SECONDS` up to the cap, in game ticks. */
export const backOffRuin = (
  context: SettlementContext, ruin: SettlementRuin, tick: number
) => {
  const failures = (ruin.failures ?? 0) + 1;
  const seconds = Math.min(RUIN_RETRY_CAP_SECONDS, RUIN_RETRY_SECONDS * (1 << Math.min(failures - 1, 16)));
  ruin.failures = failures;
  ruin.retryTick = tick + Math.round(seconds / TICK_SECONDS);
  ruin.stamp = navigationStamp(context);
};

/** A clearer reached the ruin: its backoff is over. */
export const resetRuinBackoff = (ruin: SettlementRuin) => {
  delete ruin.failures;
  delete ruin.retryTick;
  delete ruin.stamp;
};
