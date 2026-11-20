import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { getPlacedBuildingSignpost } from "../../render-common/buildings/building-road-signpost";
import { DMath } from "../math/deterministic-math";
import {
  roadStripIndex,
  segmentRectDistance,
  type StripRect,
  type StripSegment
} from "./road-reserved-strip";
import { ROAD_RESERVED_HALF_WIDTH, type RoadPoint } from "./road-types";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

type PlacedPlot = Pick<SettlementBuilding, "depth" | "width" | "x" | "z">;
type PlacedEntrance = PlacedPlot & Pick<SettlementBuilding, "access" | "rotation" | "typeId">;

/** Half size of a signpost stake's ground footprint, the part a road ribbon must not cover. */
const SIGNPOST_STAKE_RADIUS = 0.04;

export const plotRect = (building: PlacedPlot): StripRect => ({
  bottom: building.z + building.depth / 2, left: building.x - building.width / 2,
  right: building.x + building.width / 2, top: building.z - building.depth / 2
});

const pointRect = (point: RoadPoint, radius = 0): StripRect => ({
  bottom: point.z + radius, left: point.x - radius, right: point.x + radius, top: point.z - radius
});

const pointRectDistance = (point: RoadPoint, rect: StripRect) =>
  segmentRectDistance({ end: point, start: point }, rect);

/** The building's own road leaving its flag straight outwards: the door apron is its destination. */
const isOwnEntranceStub = (segment: StripSegment, building: PlacedEntrance) => {
  const angle = (((building.rotation % 4) + 4) % 4) * Math.PI / 2;
  const sine = DMath.sin(angle), cosine = DMath.cos(angle);
  return [segment.start, segment.end].every(point => {
    const dx = point.x - building.access.x, dz = point.z - building.access.z;
    return dx * sine + dz * cosine >= -1e-6 && Math.abs(dx * cosine - dz * sine) < 1e-6;
  });
};

/** The signpost stake's ground footprint. */
const signpostStakeRect = (building: Pick<SettlementBuilding, "rotation" | "typeId" | "x" | "z">) => {
  const { post } = getPlacedBuildingSignpost(building.typeId, building.x, building.z, building.rotation);
  return pointRect(post, SIGNPOST_STAKE_RADIUS);
};

/**
 * A road reserves its full canonical stone width from the day it is built as
 * dirt, so a later upgrade never collides. Plots, signposts and door aprons keep that strip clear.
 */
export const roadStripPlacementReason = (context: SettlementContext, building: SettlementBuilding) => {
  const strip = roadStripIndex(context.options.roads);
  const plot = plotRect(building);
  if (strip.findInRect(plot, segment => isOwnEntranceStub(segment, building)))
    return "Plot reaches into a road's reserved stone width";
  if (!isOpenArcherTower(building) && strip.findInRect(signpostStakeRect(building), undefined, ROAD_RESERVED_HALF_WIDTH))
    return "Building signpost stands in a road's reserved stone width";
  for (const existing of context.buildings) {
    if (!isOpenArcherTower(existing) && pointRectDistance(existing.access, plot) < ROAD_RESERVED_HALF_WIDTH - 1e-6)
      return "Plot obstructs an existing entrance road";
    if (!isOpenArcherTower(building) && pointRectDistance(building.access, plotRect(existing)) < ROAD_RESERVED_HALF_WIDTH - 1e-6)
      return "Entrance road would touch a neighbouring plot";
  }
  return null;
};

const stakeKey = (x: number, z: number) => z * 65536 + x;
/** A new road step closer than this to a stake covers it. */
const RESERVED_STRIP_REACH = ROAD_RESERVED_HALF_WIDTH - 1e-6;

/**
 * Signpost stakes bucketed per cell, rebuilt only when the buildings or the world's build revision
 * change. `isStripReserved` is road construction's check (a new step must not cover a stake);
 * `clearance` is how far a centreline stays from the nearest stake (old roads narrow to it).
 */
export const createSignpostStakes = (
  world: { buildRevision?: number }, buildings: () => readonly SettlementBuilding[]
) => {
  let revision: number | undefined, count = -1;
  const stakes = new Map<number, StripRect[]>();
  const refresh = () => {
    const list = buildings(), next = world.buildRevision ?? 0;
    if (next === revision && list.length === count) return;
    revision = next;
    count = list.length;
    stakes.clear();
    for (const building of list) {
      if (isOpenArcherTower(building)) continue;
      const rect = signpostStakeRect(building), key = stakeKey(Math.floor(rect.left), Math.floor(rect.top));
      stakes.set(key, [...(stakes.get(key) ?? []), rect]);
    }
  };
  /** Distance from the centreline to the nearest stake within reach (else Infinity); stops early below `enough`. */
  const nearestStake = (start: RoadPoint, end: RoadPoint, enough: number) => {
    refresh();
    const reach = ROAD_RESERVED_HALF_WIDTH + 1, segment = { end, start };
    const minX = Math.floor(Math.min(start.x, end.x) - reach), maxX = Math.floor(Math.max(start.x, end.x) + reach);
    const minZ = Math.floor(Math.min(start.z, end.z) - reach), maxZ = Math.floor(Math.max(start.z, end.z) + reach);
    let nearest = Infinity;
    for (let z = minZ; z <= maxZ; z++)
      for (let x = minX; x <= maxX; x++) {
        const rects = stakes.get(stakeKey(x, z));
        if (!rects) continue;
        for (const rect of rects) {
          nearest = Math.min(nearest, segmentRectDistance(segment, rect));
          if (nearest < enough) return nearest;
        }
      }
    return nearest;
  };
  /** Distance from the centreline to the nearest stake within the reserved half width (else Infinity). */
  const clearance = (start: RoadPoint, end: RoadPoint) => nearestStake(start, end, -Infinity);
  const isStripReserved = (start: RoadPoint, end: RoadPoint) =>
    nearestStake(start, end, RESERVED_STRIP_REACH) < RESERVED_STRIP_REACH;
  return { clearance, isStripReserved };
};
