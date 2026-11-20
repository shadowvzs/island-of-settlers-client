import type { SettlementContext, SettlementPoint } from "./settlement-types";

/** A newly claimed, still empty site may surround a worker who was already there. */
export const isUnbuiltPlotEscape = (
  context: SettlementContext,
  from: SettlementPoint,
  to: SettlementPoint
) => {
  const { world } = context.options;
  const fromCell = Math.floor(from.z) * world.cellsX + Math.floor(from.x);
  if (context.occupied[fromCell] !== 1) return false;
  const plot = context.buildings.find(
    (site) =>
      site.construction === 0 &&
      from.x >= site.x - site.width / 2 &&
      from.x < site.x + site.width / 2 &&
      from.z >= site.z - site.depth / 2 &&
      from.z < site.z + site.depth / 2
  );
  if (!plot) return false;
  const depth = (point: SettlementPoint) =>
    Math.min(
      plot.width / 2 - Math.abs(point.x - plot.x),
      plot.depth / 2 - Math.abs(point.z - plot.z)
    );
  const toCell = Math.floor(to.z) * world.cellsX + Math.floor(to.x);
  // Never borrow this permission to enter another foundation or walk back into the site.
  if (depth(to) < 0 && context.occupied[toCell] === 1) return false;
  return depth(to) < depth(from) - 1e-7;
};
