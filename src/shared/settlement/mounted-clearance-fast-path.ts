import { MOUNTED_NAVIGATION_RADIUS } from "../../render-common/mounts/horse-dimensions";
import { adventureCampNavigationIndex } from "./adventure-camp-navigation";
import { type CampObstacleIndex, campPointIsClear } from "./adventure-camp-obstacles";
import { hasBridgeGround, isOnBridgeMasonry } from "./bridge-masonry";
import {
  boxesNear, buildingClearanceBoxes, CLEARANCE_MARGIN, isOccupiedTileClaimed
} from "./mounted-clearance-boxes";
import { everyFootprintProbe } from "./navigation-footprint-probes";
import { navigationPropRadius, someObstacleInCells } from "./navigation-prop-geometry";
import {
  buildingNavigationCells, isYardPointClaimed, navigationSearchMemo
} from "./settlement-building-navigation";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Hero-mount-perf: a certain "a horse fits here" answer for the many horse clearance tests of one
 * navigation search or flow-field build (each 0.05-tile segment sample and rider tile used to run
 * the full test, ~3 µs, about 25 building point queries). True only when the exact test
 * (`isMountedNavigationClear`) must answer true; false means "not known", and the exact test runs.
 *
 * Per block of tiles of an open search the surroundings are gathered once: building volumes as padded
 * world boxes and the trunks and boulders round the block (a superset of each point's own window). A point
 * a horse's radius (plus a margin) from every box and obstacle, whose footprint probes stand on walkable
 * ground the yard rule accepts, and with no decoration support, camp dressing or bridge masonry, passes the
 * exact test: each of its building queries and footprint probes answers true. A block whose whole area
 * passes is open: its points need no further work.
 */
const RADIUS = MOUNTED_NAVIGATION_RADIUS;
const REACH = RADIUS + CLEARANCE_MARGIN;
/** Tiles round a point's tile that its footprint probes and building queries reach (radius 1.05). */
const FOOTPRINT_REACH = Math.ceil(RADIUS);
/** The exact obstacle test's window round the point's tile (`isNearNavigationObstacle`). */
const OBSTACLE_REACH = Math.ceil(1.2 + RADIUS);
const SAFE_DISTANCE_SQUARED = REACH * REACH;
/** Tiles per side of a gathered block. */
const BLOCK = 4;
/** Any height: decoration lookups by area. */
const ALL_HEIGHTS = 1e6;

/** An axis-aligned area of points (a point, a block, or the box round a segment's samples). */
interface Area { maxX: number; maxZ: number; minX: number; minZ: number }
interface BlockSurroundings {
  /** Padded world boxes of the building volumes near the block: minX, minZ, maxX, maxZ per box. */
  boxes: number[];
  /** Obstacles round the block: x, z, navigation radius per obstacle. */
  obstacles: number[];
  /** Every point of the block is surely clear. */
  open: boolean;
}
/** The point features of the exact test that exist at all in this search. */
interface PointFeatures { camps: CampObstacleIndex | null; masonry: boolean }
/** One open search's gathered blocks, boxes per building, claimed occupied tiles and features. */
interface SearchSurroundings {
  blocks: Map<number, BlockSurroundings>;
  boxes: Map<SettlementBuilding, readonly number[]>;
  /** Occupied tiles every point of which the yard rule accepts (1) or not (2). */
  claimed: Map<number, number>;
  features: PointFeatures;
}
const SURROUNDINGS = {};

const pointArea = (point: SettlementPoint): Area => ({ maxX: point.x, maxZ: point.z, minX: point.x, minZ: point.z });
const pointFeatures = (context: SettlementContext): PointFeatures => {
  const camps = adventureCampNavigationIndex(context);
  return { camps: camps.buckets.size ? camps : null, masonry: hasBridgeGround(context) };
};
const searchSurroundings = (context: SettlementContext) => navigationSearchMemo(context, SURROUNDINGS,
  (): SearchSurroundings => ({ blocks: new Map(), boxes: new Map(), claimed: new Map(),
    features: pointFeatures(context) }));

const boxesOf = (context: SettlementContext, search: SearchSurroundings, building: SettlementBuilding) => {
  let boxes = search.boxes.get(building);
  if (!boxes) {
    boxes = buildingClearanceBoxes(context, building);
    search.boxes.set(building, boxes);
  }
  return boxes;
};
const isTileClaimed = (context: SettlementContext, search: SearchSurroundings, x: number, z: number) => {
  const cell = z * context.options.world.cellsX + x;
  if (context.occupied[cell] !== 1) return true;
  let claimed = search.claimed.get(cell);
  if (claimed === undefined) {
    claimed = isOccupiedTileClaimed(context, x, z) ? 1 : 2;
    search.claimed.set(cell, claimed);
  }
  return claimed === 1;
};

/** Footprints round the area and their probes stay inside the map (the exact test's margins are narrower). */
const isAreaInsideMap = (context: SettlementContext, area: Area) => {
  const { cellsX, cellsZ } = context.options.world;
  return area.minX - REACH >= 0 && area.minZ - REACH >= 0 && area.maxX + REACH < cellsX && area.maxZ + REACH < cellsZ;
};
/** Every tile a footprint probe round the area can touch is walkable and accepted by the yard rule. */
const isAreaGroundOpen = (context: SettlementContext, search: SearchSurroundings, area: Area) => {
  const { cellsX, walkCost } = context.options.world;
  for (let z = Math.floor(area.minZ - REACH); z <= Math.floor(area.maxZ + REACH); z++)
    for (let x = Math.floor(area.minX - REACH); x <= Math.floor(area.maxX + REACH); x++)
      if (!walkCost[z * cellsX + x] || !isTileClaimed(context, search, x, z)) return false;
  return true;
};
/** Squared distance between the area and a box (0 when they overlap). */
const areaBoxDistanceSquared = (area: Area, minX: number, minZ: number, maxX: number, maxZ: number) => {
  const dx = Math.max(minX - area.maxX, 0, area.minX - maxX), dz = Math.max(minZ - area.maxZ, 0, area.minZ - maxZ);
  return dx * dx + dz * dz;
};
const isAreaClearOfBoxes = (boxes: readonly number[], area: Area) => {
  for (let index = 0; index < boxes.length; index += 4)
    if (areaBoxDistanceSquared(area, boxes[index]!, boxes[index + 1]!, boxes[index + 2]!, boxes[index + 3]!) <
      SAFE_DISTANCE_SQUARED) return false;
  return true;
};
/** Every point of the area keeps a horse's radius from each trunk and boulder (this covers the foot test too). */
const isAreaClearOfObstacles = (obstacles: readonly number[], area: Area) => {
  for (let index = 0; index < obstacles.length; index += 3) {
    const x = obstacles[index]!, z = obstacles[index + 1]!;
    if (Math.sqrt(areaBoxDistanceSquared(area, x, z, x, z)) < obstacles[index + 2]! + REACH) return false;
  }
  return true;
};
/** No decoration support, camp dressing or bridge masonry can refuse a point of the area. */
const isAreaFeatureFree = (context: SettlementContext, { camps, masonry }: PointFeatures, area: Area) => {
  if (masonry) return false;
  const decorations = context.roadDecorations;
  // A partial decoration owner (test doubles) without the area lookup is never treated as empty.
  const near = decorations && decorations.framesNear?.({ max: [area.maxX + REACH, ALL_HEIGHTS, area.maxZ + REACH],
    min: [area.minX - REACH, -ALL_HEIGHTS, area.minZ - REACH] });
  if (decorations && (!near || near.length)) return false;
  if (!camps) return true;
  for (let z = Math.floor(area.minZ); z <= Math.floor(area.maxZ); z++)
    for (let x = Math.floor(area.minX); x <= Math.floor(area.maxX); x++)
      if (camps.buckets.has(z * camps.width + x)) return false;
  return true;
};

/** The building boxes and obstacles every point of the tiles of `tiles` can meet. */
const gatherNear = (context: SettlementContext, search: SearchSurroundings, tiles: Area) => {
  const { world } = context.options, cells = buildingNavigationCells(context);
  const fromX = Math.max(0, tiles.minX - FOOTPRINT_REACH);
  const toX = Math.min(world.cellsX - 1, tiles.maxX + FOOTPRINT_REACH);
  const fromZ = Math.max(0, tiles.minZ - FOOTPRINT_REACH);
  const toZ = Math.min(world.cellsZ - 1, tiles.maxZ + FOOTPRINT_REACH);
  const buildings: SettlementBuilding[] = [];
  for (let z = fromZ; z <= toZ; z++) for (let x = fromX; x <= toX; x++)
    for (const building of cells.get(z * world.cellsX + x) ?? [])
      if (!buildings.includes(building)) buildings.push(building);
  const obstacles: number[] = [];
  someObstacleInCells(world, tiles.minX - OBSTACLE_REACH, tiles.minZ - OBSTACLE_REACH, tiles.maxX + OBSTACLE_REACH,
    tiles.maxZ + OBSTACLE_REACH, id => {
      obstacles.push(world.props.x[id]!, world.props.z[id]!, navigationPropRadius(world, id));
      return false;
    });
  const boxes = boxesNear(buildings.map(building => boxesOf(context, search, building)),
    tiles.minX, tiles.minZ, tiles.maxX + 1, tiles.maxZ + 1, REACH);
  return { boxes, obstacles };
};
const isAreaSurelyClear = (context: SettlementContext, search: SearchSurroundings,
  { boxes, obstacles }: Pick<BlockSurroundings, "boxes" | "obstacles">, area: Area) =>
  isAreaInsideMap(context, area) && isAreaClearOfBoxes(boxes, area) && isAreaClearOfObstacles(obstacles, area) &&
  isAreaGroundOpen(context, search, area);
const gatherBlock = (context: SettlementContext, search: SearchSurroundings, blockX: number, blockZ: number):
  BlockSurroundings => {
  const minX = blockX * BLOCK, minZ = blockZ * BLOCK;
  const near = gatherNear(context, search, { maxX: minX + BLOCK - 1, maxZ: minZ + BLOCK - 1, minX, minZ });
  const area = { maxX: minX + BLOCK, maxZ: minZ + BLOCK, minX, minZ };
  return { ...near, open: isAreaSurelyClear(context, search, near, area) &&
    isAreaFeatureFree(context, search.features, area) };
};
const blockAt = (context: SettlementContext, search: SearchSurroundings, blockX: number, blockZ: number) => {
  const key = blockZ * Math.ceil(context.options.world.cellsX / BLOCK) + blockX;
  let block = search.blocks.get(key);
  if (!block) {
    block = gatherBlock(context, search, blockX, blockZ);
    search.blocks.set(key, block);
  }
  return block;
};
const blockOf = (context: SettlementContext, search: SearchSurroundings, point: SettlementPoint) =>
  blockAt(context, search, Math.floor(Math.floor(point.x) / BLOCK), Math.floor(Math.floor(point.z) / BLOCK));
/** Every block the area's tiles lie in passes `test`. */
const everyBlockOf = (context: SettlementContext, search: SearchSurroundings, area: Area,
  test: (block: BlockSurroundings) => boolean) => {
  for (let z = Math.floor(Math.floor(area.minZ) / BLOCK); z <= Math.floor(Math.floor(area.maxZ) / BLOCK); z++)
    for (let x = Math.floor(Math.floor(area.minX) / BLOCK); x <= Math.floor(Math.floor(area.maxX) / BLOCK); x++)
      if (!test(blockAt(context, search, x, z))) return false;
  return true;
};

/** The point features of the exact test, as it evaluates them (skipping those absent from the search). */
const isPointFeatureClear = (context: SettlementContext, { camps, masonry }: PointFeatures, point: SettlementPoint) => {
  const decorations = context.roadDecorations;
  if (decorations && (!decorations.isSupportClear(point, 0) || !decorations.isSupportClear(point, RADIUS)))
    return false;
  if (camps && (!campPointIsClear(camps, point) || !campPointIsClear(camps, point, RADIUS))) return false;
  return !masonry || !isOnBridgeMasonry(context, point);
};
/**
 * Every footprint probe of `point` stands on walkable ground the yard rule accepts (with the boxes clear,
 * each probe's building query then answers true). Tiles are tried first, then the probes themselves.
 */
const isFootprintGroundOpen = (context: SettlementContext, search: SearchSurroundings, point: SettlementPoint) => {
  if (isAreaGroundOpen(context, search, pointArea(point))) return true;
  const { world } = context.options;
  return everyFootprintProbe(world, point, RADIUS, (probe, cell) => world.walkCost[cell]! > 0 &&
    (isTileClaimed(context, search, Math.floor(probe.x), Math.floor(probe.z)) || isYardPointClaimed(context, probe)));
};
const isPointSurelyClear = (context: SettlementContext, search: SearchSurroundings, point: SettlementPoint) => {
  const block = blockOf(context, search, point);
  if (block.open) return true;
  const area = pointArea(point);
  return isAreaInsideMap(context, area) && isAreaClearOfBoxes(block.boxes, area) &&
    isAreaClearOfObstacles(block.obstacles, area) && isPointFeatureClear(context, search.features, point) &&
    isFootprintGroundOpen(context, search, point);
};

/** True only when `isMountedNavigationClear` answers true for `point` (inside an open navigation search). */
export const isMountedPointSurelyClear = (context: SettlementContext, point: SettlementPoint) => {
  const search = searchSurroundings(context);
  return search !== undefined && isPointSurelyClear(context, search, point);
};

/**
 * True only when the yard and volume test of a footprint probe (`isPublicBuildingPointClear` with radius 0)
 * answers true: the probe lies outside every padded volume box and the yard rule accepts it.
 */
export const isFootprintProbeSurelyClear = (context: SettlementContext, probe: SettlementPoint) => {
  const search = searchSurroundings(context);
  if (!search || !isAreaInsideMap(context, pointArea(probe))) return false;
  const { boxes } = blockOf(context, search, probe);
  for (let index = 0; index < boxes.length; index += 4)
    if (probe.x >= boxes[index]! && probe.x <= boxes[index + 2]! && probe.z >= boxes[index + 1]! &&
      probe.z <= boxes[index + 3]!) return false;
  return isYardPointClaimed(context, probe);
};

/**
 * True only when the horse's test passes at every sample of the segment `from`-`to` (`samples` visits them):
 * every block round its box is open, or the box is surely clear of each one and every sample passes the
 * point features.
 */
export const isMountedSegmentSurelyClear = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint,
  samples: (test: (point: SettlementPoint) => boolean) => boolean) => {
  const search = searchSurroundings(context);
  if (!search) return false;
  const area = { maxX: Math.max(from.x, to.x), maxZ: Math.max(from.z, to.z), minX: Math.min(from.x, to.x),
    minZ: Math.min(from.z, to.z) };
  if (everyBlockOf(context, search, area, block => block.open)) return true;
  return everyBlockOf(context, search, area, block => isAreaSurelyClear(context, search, block, area)) &&
    samples(point => isPointFeatureClear(context, search.features, point));
};
