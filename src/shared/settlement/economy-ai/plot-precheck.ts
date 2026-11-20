import { ORE, type WorldData } from "../../world/world-data";
import { foundationCellReason } from "../settlement-placement";
import { isGentlePlotGround, isPlotLaneFree } from "../settlement-plot-prechecks";
import type { SettlementContext } from "../settlement-types";
import { PLOT_KIND_MINE } from "./constants";
import type { PlotSearch } from "./plot-cache-entries";
import { isWatchedRoadCell, type PlotWatch } from "./plot-cache-watch";

/** A plot cell lies in a mine zone that holds ore (static: the live ore amount is the real rule's). */
export const isDepositCell = (world: WorldData, cell: number) => {
  const zone = world.mineZone[cell];
  return zone !== 0 && world.mineZones.some(entry => entry.id === zone && entry.ore !== ORE.none);
};

const coversDeposit = (world: WorldData, left: number, top: number, width: number, depth: number) => {
  for (let z = top; z < top + depth; z++) for (let x = left; x < left + width; x++)
    if (isDepositCell(world, z * world.cellsX + x)) return true;
  return false;
};

/** Every plot cell free of buildings, entrances and road strips and able to carry the foundation of its kind. */
const plotCellsFit = (context: SettlementContext, watch: PlotWatch, mine: boolean, left: number, top: number,
  width: number, depth: number) => {
  const { world } = context.options;
  for (let z = top; z < top + depth; z++) for (let x = left; x < left + width; x++) {
    const cell = z * world.cellsX + x;
    if (context.occupied[cell] !== 0 || isWatchedRoadCell(watch, x, z) || foundationCellReason(world, cell, mine))
      return false;
  }
  return true;
};

/**
 * The candidate cache's cheap pre-check (plan §3.5) of one turned plot with its corner at (left, top): owned
 * cells with a free lane (the debug build-all checks), free foundation cells of the kind outside road strips, then
 * a deposit for a mine or gentle ground for any other plot. It reads only the faction's territory, `occupied`, the
 * road mask, the foundation layers, the heights and the static mine zones, which is what the cache watches; the
 * real rules follow later.
 */
export const passesPlotPrecheck = (
  context: SettlementContext, { owned, watch }: Pick<PlotSearch, "owned" | "watch">, kind: number, left: number,
  top: number, width: number, depth: number
) => {
  if (!isPlotLaneFree(context, owned, left, top, width, depth)) return false;
  const mine = kind === PLOT_KIND_MINE, { world } = context.options;
  if (!plotCellsFit(context, watch, mine, left, top, width, depth)) return false;
  if (mine) return coversDeposit(world, left, top, width, depth);
  return isGentlePlotGround(world, left, top, width, depth);
};
