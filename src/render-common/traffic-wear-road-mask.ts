import { ROAD_PLACEMENT_HALF_WIDTH, ROAD_TIER_WIDTH, type RoadSegment } from "../shared/settlement/road-types";

/** What a step at a point does to the wear field; higher values win where ribbons overlap. */
export const RoadWearClass = {
  /** Bare ground: the step wears the ground (desire paths). */
  OffRoad: 0,
  /** Road verge/reserved strip: neither ground wear nor ruts, so verges stay clean. */
  Corridor: 1,
  /** Dirt road surface: the step adds to the rut channel. */
  Dirt: 2,
  /** Paved road surface: the step adds to the cart-wear channel for faint grooves. */
  Paved: 3,
  /** Bridge deck: no wear, even where a paved approach meets the deck. */
  Bridge: 4
} as const;
export type RoadWearClass = (typeof RoadWearClass)[keyof typeof RoadWearClass];

/** Mask resolution in world units: half a cell resolves roads centred on cell borders. */
const MASK_STEP = 0.5;
/** A step this close beyond a surface edge still counts as on that surface (road-edge walkers). */
const SURFACE_MARGIN = 0.2;
/** Bridge decks keep a small clean apron where they meet the banks. */
const BRIDGE_CORRIDOR_MARGIN = 0.3;

const surfaceHalfWidth = (segment: RoadSegment) =>
  segment.bridge ? segment.bridge.width / 2 : ROAD_TIER_WIDTH[segment.tier] / 2;

const surfaceClass = (segment: RoadSegment): RoadWearClass => {
  if (segment.bridge) return RoadWearClass.Bridge;
  return segment.tier === "dirt" ? RoadWearClass.Dirt : RoadWearClass.Paved;
};

const corridorHalfWidth = (segment: RoadSegment) =>
  segment.bridge ? surfaceHalfWidth(segment) + BRIDGE_CORRIDOR_MARGIN : ROAD_PLACEMENT_HALF_WIDTH;

const distanceToSegment = (segment: RoadSegment, x: number, z: number) => {
  const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
  const lengthSquared = dx * dx + dz * dz;
  const along = lengthSquared > 0
    ? Math.min(1, Math.max(0, ((x - segment.start.x) * dx + (z - segment.start.z) * dz) / lengthSquared))
    : 0;
  return Math.hypot(x - segment.start.x - along * dx, z - segment.start.z - along * dz);
};

/**
 * Half-cell classification of the road network for the wear feed. Rebuilt only when the road
 * revision moves; a lookup is one array read.
 */
export const createRoadWearMask = (cellsX: number, cellsZ: number) => {
  const width = Math.ceil(cellsX / MASK_STEP), height = Math.ceil(cellsZ / MASK_STEP);
  const classes = new Uint8Array(width * height);
  const paintSegment = (segment: RoadSegment) => {
    const surface = surfaceHalfWidth(segment) + SURFACE_MARGIN, corridor = corridorHalfWidth(segment);
    const reach = Math.max(surface, corridor), kind = surfaceClass(segment);
    const minX = Math.max(0, Math.floor((Math.min(segment.start.x, segment.end.x) - reach) / MASK_STEP));
    const maxX = Math.min(width - 1, Math.floor((Math.max(segment.start.x, segment.end.x) + reach) / MASK_STEP));
    const minZ = Math.max(0, Math.floor((Math.min(segment.start.z, segment.end.z) - reach) / MASK_STEP));
    const maxZ = Math.min(height - 1, Math.floor((Math.max(segment.start.z, segment.end.z) + reach) / MASK_STEP));
    for (let maskZ = minZ; maskZ <= maxZ; maskZ++) for (let maskX = minX; maskX <= maxX; maskX++) {
      const distance = distanceToSegment(segment, (maskX + 0.5) * MASK_STEP, (maskZ + 0.5) * MASK_STEP);
      if (distance > reach) continue;
      const index = maskZ * width + maskX;
      const value: RoadWearClass = distance <= surface ? kind : RoadWearClass.Corridor;
      if (value > classes[index]!) classes[index] = value;
    }
  };
  return {
    classAt: (x: number, z: number): RoadWearClass => {
      const maskX = Math.floor(x / MASK_STEP), maskZ = Math.floor(z / MASK_STEP);
      if (maskX < 0 || maskZ < 0 || maskX >= width || maskZ >= height) return RoadWearClass.Paved;
      return classes[maskZ * width + maskX]! as RoadWearClass;
    },
    rebuild: (segments: readonly RoadSegment[]) => {
      classes.fill(RoadWearClass.OffRoad);
      for (const segment of segments) paintSegment(segment);
    }
  };
};
