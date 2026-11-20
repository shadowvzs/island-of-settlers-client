import { stripOverlapsRect, type StripRect, type StripSegment } from "../road-reserved-strip";
import { ROAD_PLACEMENT_HALF_WIDTH } from "../road-types";
import type { SettlementRoads } from "../settlement-types";

/** The watched window (inclusive cells). */
interface MaskWindow {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

/** One cell's rectangle, reused for every distance test (no allocation per cell). */
const cellRect: StripRect = { bottom: 0, left: 0, right: 0, top: 0 };

const stampSegment = (segment: StripSegment, window: MaskWindow, mask: Uint8Array) => {
  const { end, start } = segment, reach = ROAD_PLACEMENT_HALF_WIDTH, width = window.maxX - window.minX + 1;
  const fromX = Math.max(window.minX, Math.floor(Math.min(start.x, end.x) - reach));
  const toX = Math.min(window.maxX, Math.floor(Math.max(start.x, end.x) + reach));
  const fromZ = Math.max(window.minZ, Math.floor(Math.min(start.z, end.z) - reach));
  const toZ = Math.min(window.maxZ, Math.floor(Math.max(start.z, end.z) + reach));
  for (let z = fromZ; z <= toZ; z++) for (let x = fromX; x <= toX; x++) {
    cellRect.left = x; cellRect.right = x + 1; cellRect.top = z; cellRect.bottom = z + 1;
    if (stripOverlapsRect(segment, cellRect, reach)) mask[(z - window.minZ) * width + x - window.minX] = 1;
  }
};

/**
 * Marks the window cells a road's reserved stone width reaches (the real `roadStripPlacementReason` test per cell,
 * bridges left to the real rule). A pure function of the current roads, so the cache stays cold-equivalent; it is
 * stamped again only when the network's revision moves.
 */
export const stampRoadStrips = (roads: SettlementRoads, window: MaskWindow, mask: Uint8Array) => {
  mask.fill(0);
  for (const segment of roads.segments?.() ?? []) if (!segment.bridge) stampSegment(segment, window, mask);
};
