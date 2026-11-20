import type { CellRegion } from "../../grid-geometry";
import type { WorldData } from "../../world-data";

/** Kept free between the transformed contour (with its sampling margin) and the map edge. */
const EDGE_MARGIN = 2;

/** The whole-tile offset range along one axis that keeps the scaled extent inside the map. */
const clampAxis = (offset: number, min: number, max: number, scale: number, cells: number) => {
  const centre = (min + max + 1) / 2;
  const low = centre + (min - centre) * scale,
    high = centre + (max + 1 - centre) * scale;
  const lowest = Math.ceil(EDGE_MARGIN - low),
    highest = Math.floor(cells - EDGE_MARGIN - high);
  if (lowest > highest)
    throw new Error(
      "At this size the contour no longer fits inside the map. Choose a smaller size."
    );
  return Math.min(highest, Math.max(lowest, offset));
};

/**
 * Pulls a move / resize that would cross the map border back inside it (the nearest offset
 * that fits); the caller reports the clamped offset. Refuses only when the size cannot fit.
 */
export const clampFeatureOffset = (
  world: WorldData,
  bounds: CellRegion,
  transform: { offsetX: number; offsetZ: number; scale: number }
) => {
  const offsetX = clampAxis(
    transform.offsetX,
    bounds.minX,
    bounds.maxX,
    transform.scale,
    world.cellsX
  );
  const offsetZ = clampAxis(
    transform.offsetZ,
    bounds.minZ,
    bounds.maxZ,
    transform.scale,
    world.cellsZ
  );
  const clamped = offsetX !== transform.offsetX || offsetZ !== transform.offsetZ;
  if (clamped && !offsetX && !offsetZ && transform.scale === 1)
    throw new Error("The contour already touches the map border in that direction.");
  return { clamped, offsetX, offsetZ };
};
