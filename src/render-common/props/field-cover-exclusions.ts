import { type BridgeFootprint, bridgeFootprint, insideBridgeFootprint } from "../../shared/settlement/bridge-footprint";
import { roadRibbonWidth, type RoadSegment } from "../../shared/settlement/road-types";
import { distanceAtSegmentFraction, segmentFraction } from "../../shared/settlement/settlement-geometry";
import { type CellRegion,forEachRegionCell } from "../../shared/world/grid-geometry";
import { smoothstep } from "../../shared/world/noise";
import type { WorldData } from "../../shared/world/world-data";
import { growsRoadVerge, ROAD_VERGE_MAX_WIDENING, roadVergeMaxWidening, roadVergeWidening,
  VERGE_COVER_FULL_FROM, VERGE_COVER_LOW_UNTIL } from "../road-verges/road-verge-bands";

/** Construction reserves bare ground without repainting the island's terrain. */
const masks = new WeakMap<WorldData, Uint8Array>();
const roadCells = new WeakMap<WorldData, Map<number, readonly RoadSegment[]>>();
/** Bridge decks, abutments and shore ramps (completed and under construction): nothing grows there. */
const bridgeFootprints = new WeakMap<WorldData, BridgeFootprint>();
/**
 * Cells whose terrain grass must stay out: cultivated plots (grain, rice, flax, vineyard, tea and berry rows) and
 * the monument plinth.
 */
const cropCells = new WeakMap<WorldData, Set<number>>();
/**
 * Cells of the cultivated plots alone: the ground draws tilled soil under them (cover field G, GROUND-PALETTE step 6).
 * The monument plinth is not soil (ground-palette-4: its 9 × 9 grass-free square drew a ploughed strip).
 */
const soilCells = new WeakMap<WorldData, Set<number>>();
export const getFieldCoverExclusions = (world: WorldData) => masks.get(world);
export const getFieldCropCoverCells = (world: WorldData) => cropCells.get(world);
export const getFieldCropSoilCells = (world: WorldData) => soilCells.get(world);
/**
 * Physical building coverage is separate from the editor/construction mask: only cells under
 * actual walls, rooms, props and stock supports stay bare, so empty exterior yard pockets can
 * grow grass again. Counts keep overlapping buildings/demolition correct.
 */
const buildingCover = new WeakMap<WorldData, {
  counts: Uint16Array;
  cells: Map<number, readonly number[]>;
}>();
export const getBuildingGroundCoverCounts = (world: WorldData) => buildingCover.get(world)?.counts;
export const getBuildingGroundCoverCells = (world: WorldData, uid: number) =>
  buildingCover.get(world)?.cells.get(uid);
export const setBuildingGroundCoverCells = (world: WorldData, uid: number, cells: readonly number[]) => {
  let entry = buildingCover.get(world);
  if (!entry) {
    entry = { counts: new Uint16Array(world.cellsX * world.cellsZ), cells: new Map() };
    buildingCover.set(world, entry);
  }
  const previous = entry.cells.get(uid) ?? [];
  for (const cell of previous) entry.counts[cell] = Math.max(0, entry.counts[cell]! - 1);
  if (cells.length) {
    entry.cells.set(uid, cells);
    for (const cell of cells) entry.counts[cell] = Math.min(65535, entry.counts[cell]! + 1);
  } else entry.cells.delete(uid);
  return previous;
};
export const clearBuildingGroundCoverCells = (world: WorldData, uid: number) => {
  const entry = buildingCover.get(world);
  const previous = entry?.cells.get(uid);
  if (!entry || !previous) return [];
  for (const cell of previous) entry.counts[cell] = Math.max(0, entry.counts[cell]! - 1);
  entry.cells.delete(uid);
  return previous;
};
/** Grass-free cells (crops and the plinth) and the tilled soil cells among them (the crops; default: all). */
export const setFieldCropCoverCells = (
  world: WorldData, cells: ReadonlySet<number>, soil: ReadonlySet<number> = cells
) => {
  if (cells.size) cropCells.set(world, new Set(cells));
  else cropCells.delete(world);
  if (soil.size) soilCells.set(world, new Set(soil));
  else soilCells.delete(world);
};
/** Field kinds on tilled soil (the tree plantations, hives and charcoal keep their meadow). */
const CULTIVATED_FIELDS = new Set(["berries", "flax", "grain", "rice", "tea", "vine"]);

/**
 * World bounds [min x, min z, max x, max z] of the crop plots' tilled soil (one cell of margin for the soft edge), or
 * an empty box (min > max) without plots: the ground skips the cover-field fetch outside it.
 */
export const getFieldSoilBounds = (cells: ReadonlySet<number>, cellsX: number): [number, number, number, number] => {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const cell of cells) {
    const x = cell % cellsX, z = Math.floor(cell / cellsX);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z + 1);
  }
  return cells.size ? [minX - 1, minZ - 1, maxX + 1, maxZ + 1] : [1, 1, 0, 0];
};

export const fieldCropCoverCells = (
  fields: ReadonlyArray<{ kind: string; x: number; z: number }>, cellsX: number
) => {
  const cells = new Set<number>();
  for (const field of fields) {
    if (!CULTIVATED_FIELDS.has(field.kind)) continue;
    cells.add(Math.floor(field.z) * cellsX + Math.floor(field.x));
  }
  return cells;
};
/** Bare corridor beyond the drawn road ribbon edge. */
const ROAD_COVER_MARGIN = .14;
/** Share of the tufts kept, and their height, where the verge thinning is strongest. */
export const VERGE_COVER_KEPT = .14;
export const VERGE_COVER_HEIGHT = .42;
/** Width scale of the remaining low tufts there (they read as short, mown verge grass). */
const VERGE_COVER_WIDTH = .8;

const roadCoverDistance = (segment: RoadSegment, x: number, z: number) => {
  const { end, start } = segment;
  const dx = end.x - start.x, dz = end.z - start.z;
  const fraction = segmentFraction(x, z, start.x, start.z, dx, dz);
  return { distance: distanceAtSegmentFraction(x, z, start.x, start.z, dx, dz, fraction), fraction };
};

/** True inside a bridge's deck, abutments or shore ramps, where no plant or tuft may stand. */
export const isBridgeCoverExcluded = (world: WorldData, x: number, z: number) => {
  const footprint = bridgeFootprints.get(world);
  if (!footprint?.cells.has(Math.floor(z) * world.cellsX + Math.floor(x))) return false;
  return insideBridgeFootprint(footprint, x, z);
};

export const isRoadCoverExcluded = (world: WorldData, x: number, z: number) => {
  if (isBridgeCoverExcluded(world, x, z)) return true;
  const segments = roadCells.get(world)?.get(Math.floor(z) * world.cellsX + Math.floor(x));
  if (!segments) return false;
  return segments.some((segment) => {
    const { distance, fraction } = roadCoverDistance(segment, x, z);
    return distance <= roadRibbonWidth(segment, fraction) / 2 + ROAD_COVER_MARGIN;
  });
};

/**
 * 0..1 field cover weight beside roads: low across the verge bands of verge-growing roads
 * (measured as on a stone road, shifted out by bridge flares), 1 beyond; null on the bare corridor.
 */
export const roadsideCoverWeight = (world: WorldData, x: number, z: number): number | null => {
  if (isBridgeCoverExcluded(world, x, z)) return null;
  const segments = roadCells.get(world)?.get(Math.floor(z) * world.cellsX + Math.floor(x));
  if (!segments) return 1;
  let weight = 1;
  for (const segment of segments) {
    const { distance, fraction } = roadCoverDistance(segment, x, z);
    if (distance <= roadRibbonWidth(segment, fraction) / 2 + ROAD_COVER_MARGIN) return null;
    if (!growsRoadVerge(segment)) continue;
    const vergeDistance = distance - roadVergeWidening(segment, fraction);
    weight = Math.min(weight, smoothstep(VERGE_COVER_LOW_UNTIL, VERGE_COVER_FULL_FROM, vergeDistance));
  }
  return weight;
};

/** Stable 0..1 value of a tuft position (its cell stream is untouched, so other tufts never shift). */
const tuftHash = (x: number, z: number) => {
  let value = Math.imul(Math.floor(x * 4096), 374761393) ^ Math.imul(Math.floor(z * 4096), 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

/**
 * A field cover tuft as it grows beside roads: dropped on the road corridor, thinned and lowered
 * across the verge (deterministic per position), unchanged elsewhere. Every renderer that draws
 * field cover shares it, so the verge band reads the same on Low, Medium and High.
 */
export const fitRoadsideCover = <Tuft extends { scale: number; stretch: number; x: number; z: number }>(
  world: WorldData, tuft: Tuft
): Tuft | undefined => {
  // The stored (float32) position decides, so a drawn tuft re-tested later gets the same answer.
  const x = Math.fround(tuft.x), z = Math.fround(tuft.z), weight = roadsideCoverWeight(world, x, z);
  if (weight === null) return undefined;
  if (weight >= 1) return tuft;
  if (tuftHash(x, z) >= VERGE_COVER_KEPT + (1 - VERGE_COVER_KEPT) * weight) return undefined;
  return { ...tuft, scale: tuft.scale * (VERGE_COVER_WIDTH + (1 - VERGE_COVER_WIDTH) * weight),
    stretch: tuft.stretch * (VERGE_COVER_HEIGHT + (1 - VERGE_COVER_HEIGHT) * weight) };
};

/** Farthest a road affects field cover: its bare corridor or, for verge roads, the verge falloff. */
const roadCoverReach = (segment: RoadSegment) => {
  const corridor = Math.max(roadRibbonWidth(segment, 0), roadRibbonWidth(segment, 1)) / 2 + ROAD_COVER_MARGIN;
  if (!growsRoadVerge(segment)) return corridor;
  return Math.max(corridor, roadVergeMaxWidening(segment) + VERGE_COVER_FULL_FROM);
};
/** Cell margin a road edit must rebuild round its segments so the whole verge falloff refreshes. */
export const ROAD_COVER_REBUILD_MARGIN = Math.ceil(VERGE_COVER_FULL_FROM + ROAD_VERGE_MAX_WIDENING);

/** Point-accurate road corridor: grass remains at the roadside and stays absent after rebuilds. */
export const excludeRoadFieldCover = (world: WorldData, segments: readonly RoadSegment[]) => {
  const cells = new Map<number, RoadSegment[]>();
  for (const segment of segments) {
    const radius = roadCoverReach(segment);
    const minX = Math.max(0, Math.floor(Math.min(segment.start.x, segment.end.x) - radius));
    const maxX = Math.min(world.cellsX - 1, Math.floor(Math.max(segment.start.x, segment.end.x) + radius));
    const minZ = Math.max(0, Math.floor(Math.min(segment.start.z, segment.end.z) - radius));
    const maxZ = Math.min(world.cellsZ - 1, Math.floor(Math.max(segment.start.z, segment.end.z) + radius));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const key = z * world.cellsX + x;
      const list = cells.get(key) ?? [];
      list.push(segment);
      cells.set(key, list);
    }
  }
  roadCells.set(world, cells);
  const footprint = bridgeFootprint(segments, world);
  if (footprint) bridgeFootprints.set(world, footprint);
  else bridgeFootprints.delete(world);
};
export const excludeFieldCoverRegion = (world: WorldData, region: CellRegion) => {
  let mask = masks.get(world);
  if (!mask) {
    mask = new Uint8Array(world.cellsX * world.cellsZ);
    masks.set(world, mask);
  }
  forEachRegionCell(world, region, (cell) => { mask[cell] = 1; });
};

export const releaseFieldCoverRegion=(world:WorldData,region:CellRegion) => {
  const mask=masks.get(world);
  if(mask)forEachRegionCell(world,region,cell=>{mask[cell]=0;});
};
