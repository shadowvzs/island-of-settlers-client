import { courtyardInventoryKey } from "../../render-common/buildings/building-courtyard";
import { getKnownRocks } from "../../render-common/rocks/island-rock-instances";
import type { RockInstance } from "../../render-common/rocks/rock-instances";
import type { TileRect } from "../world/navigation-change-log";
import type { WorldData } from "../world/world-data";
import { navigationInvalidation } from "./navigation-change-journal";
import { someObstacleInCells } from "./navigation-prop-geometry";
import { buildingNavigationReach, buildingNavigationShape } from "./settlement-building-navigation";
import {
  buildingKey, buildingRect, decorationKey, decorationRect, pointsRect, ROAD_REACH, roadKey
} from "./settlement-charting-object-changes";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * JETTY-FRAMES: exact copies of the settlement inputs one cached harbour geometry (a boat jetty, a
 * ship dock) read inside its tile rectangle. Equal copies mean that every read answers as before, so
 * the geometry is reused; otherwise it is computed again. Three rectangles (`InputRects`) bound the reads:
 * - terrain (everything read): heights, lake vertices, slope classes, visible rocks, standing trunks;
 * - cells (scans and ground searches): blocking, walking cost and occupancy;
 * - navigation (ground searches, the only readers of settlement objects): buildings (plot, model,
 *   stage, level, stock and navigation volumes), roads and bridges, road decorations and field sites
 *   whose reach meets it.
 * Whole-map inputs (map shape, sea level, nation, adventure camps, rollback modes) are the
 * `inputIdentity`; a change there renews every geometry.
 */
export interface InputRects {
  cells: TileRect | null;
  navigation: TileRect | null;
  terrain: TileRect;
}
export interface InputFingerprint {
  bytes: Uint8Array;
  objects: string;
  rects: InputRects;
}

type Grid = Uint8Array | Float32Array;
/** The cell grids the scans and ground searches read (build ground classes are never read). */
const CELL_GRIDS = ["blocking", "walkCost"] as const;
type CellGrid = typeof CELL_GRIDS[number] | "slopeClass";
/** Where a visited row lies: its first tile column, bytes per value and vertex (1) or cell (0) grid. */
interface RowPlace { edge: number; minX: number; size: number }
type RowVisitor = (bytes: Uint8Array, start: number, length: number, z: number, place: RowPlace) => void;

const byteViews = new WeakMap<Grid, Uint8Array>();
const bytesOf = (grid: Grid) => {
  let view = byteViews.get(grid);
  if (!view || view.buffer !== grid.buffer) {
    view = new Uint8Array(grid.buffer, grid.byteOffset, grid.byteLength);
    byteViews.set(grid, view);
  }
  return view;
};

/** Visits the rectangle's rows of one grid with `width` columns and an inclusive extra edge. */
const visitRows = (grid: Grid | undefined, width: number, rect: TileRect, edge: number, visit: RowVisitor) => {
  if (!grid) return;
  const bytes = bytesOf(grid), size = grid.BYTES_PER_ELEMENT, length = (rect.maxX - rect.minX + 1 + edge) * size;
  const place = { edge, minX: rect.minX, size };
  for (let z = rect.minZ; z <= rect.maxZ + edge; z++) visit(bytes, (z * width + rect.minX) * size, length, z, place);
};

/** Every grid byte read in a fixed order: cell grids and occupancy, then slope, height and lake vertices. */
const visitGridBytes = (context: SettlementContext, rects: InputRects, visit: RowVisitor) => {
  const { world } = context.options, grids = world as unknown as Record<CellGrid, Grid | undefined>;
  const { cells, terrain } = rects;
  if (cells) {
    for (const name of CELL_GRIDS) visitRows(grids[name], world.cellsX, cells, 0, visit);
    visitRows(context.occupied, world.cellsX, cells, 0, visit);
  }
  visitRows(grids.slopeClass, world.cellsX, terrain, 0, visit);
  visitRows(world.heights, world.cellsX + 1, terrain, 1, visit);
  visitRows(world.lakeWater, world.cellsX + 1, terrain, 1, visit);
};

export const rectsIntersect = (first: TileRect, second: TileRect) => first.minX <= second.maxX &&
  first.maxX >= second.minX && first.minZ <= second.maxZ && first.maxZ >= second.minZ;

/** A clamped rectangle (null when it lies outside the world). */
export const clampInputRect = (world: WorldData, rect: TileRect): TileRect | null => {
  const clamped = { maxX: Math.min(world.cellsX - 1, Math.floor(rect.maxX)),
    maxZ: Math.min(world.cellsZ - 1, Math.floor(rect.maxZ)),
    minX: Math.max(0, Math.floor(rect.minX)), minZ: Math.max(0, Math.floor(rect.minZ)) };
  return clamped.minX > clamped.maxX || clamped.minZ > clamped.maxZ ? null : clamped;
};

/** The tiles both rectangles hold (null when they do not meet). */
export const intersectInputRect = (first: TileRect, second: TileRect): TileRect | null => {
  const rect = { maxX: Math.min(first.maxX, second.maxX), maxZ: Math.min(first.maxZ, second.maxZ),
    minX: Math.max(first.minX, second.minX), minZ: Math.max(first.minZ, second.minZ) };
  return rect.minX > rect.maxX || rect.minZ > rect.maxZ ? null : rect;
};

/** The smallest rectangle holding both (`second` may be missing). */
export const unionInputRect = (first: TileRect, second: TileRect | null): TileRect => second ? {
  maxX: Math.max(first.maxX, second.maxX), maxZ: Math.max(first.maxZ, second.maxZ),
  minX: Math.min(first.minX, second.minX), minZ: Math.min(first.minZ, second.minZ)
} : first;

/** The tiles whose point queries consult the building (A03 index reach); bridge sites keep their span. */
const buildingReadRect = (world: WorldData, building: SettlementBuilding) =>
  building.bridgeSite ? buildingRect(building) : buildingNavigationReach(world, building);

/** Stock and navigation volumes: what courtyard and public point queries read beyond the plot. */
const buildingStockKey = (context: SettlementContext, building: SettlementBuilding) =>
  `${courtyardInventoryKey(building.output)}|${courtyardInventoryKey(building.input)}|` +
  `${Boolean(building.nurserySeedlingTaken)}|${JSON.stringify(buildingNavigationShape(context, building).volumes)}`;

const buildingParts = (context: SettlementContext, rect: TileRect, parts: string[]) => {
  const { world } = context.options;
  for (const building of context.buildings) if (rectsIntersect(buildingReadRect(world, building), rect))
    parts.push(`b${building.uid}:${buildingKey(building)}:${buildingStockKey(context, building)}`);
};

interface KeyedRect { key: string; rect: TileRect }
/**
 * Road segment keys and reaches, built once per road graph revision (copying every edge is costly).
 * Ground searches read the road graph only for bridges (decks, masonry, mouths); without any bridge
 * segment no road is read, and the first bridge anywhere lists the plain roads again (a change).
 */
const roadEntries = new WeakMap<object, { entries: KeyedRect[]; revision: number }>();
const roadEntriesOf = (context: SettlementContext) => {
  const { roads } = context.options;
  if (!roads) return [];
  const known = roadEntries.get(roads);
  if (known && known.revision === roads.revision) return known.entries;
  const segments = roads.segments?.() ?? [];
  const entries = segments.some(segment => segment.bridge) ? segments.map(segment => ({
    key: `r${roadKey(segment)}`, rect: pointsRect([segment.start, segment.end], ROAD_REACH) })) : [];
  if (roads.revision !== undefined) roadEntries.set(roads, { entries, revision: roads.revision });
  return entries;
};

const roadParts = (context: SettlementContext, rect: TileRect, parts: string[]) => {
  for (const road of roadEntriesOf(context)) if (rectsIntersect(road.rect, rect)) parts.push(road.key);
};

const decorationParts = (context: SettlementContext, rect: TileRect, parts: string[]) => {
  for (const frame of context.roadDecorations?.frames() ?? [])
    if (rectsIntersect(decorationRect(frame), rect)) parts.push(`d${frame.uid}:${decorationKey(frame)}`);
};

const fieldParts = (context: SettlementContext, rect: TileRect, parts: string[]) => {
  for (const site of context.fieldCycles?.snapshot() ?? []) {
    const x = Math.floor(site.x), z = Math.floor(site.z);
    if (rectsIntersect({ maxX: x + 1, maxZ: z + 1, minX: x - 1, minZ: z - 1 }, rect))
      parts.push(`f${site.x}:${site.z}`);
  }
};

/** Footprint rectangles of the visible rocks (one per rock list; the list is replaced when it changes). */
const rockRects = new WeakMap<readonly RockInstance[], { key: string; rect: TileRect }[]>();
const rockEntries = (rocks: readonly RockInstance[]) => {
  let entries = rockRects.get(rocks);
  if (entries) return entries;
  entries = rocks.map(rock => {
    const halfX = rock.axes.reduce((sum, axis) => sum + Math.abs(axis[0]), 0) / 2;
    const halfZ = rock.axes.reduce((sum, axis) => sum + Math.abs(axis[2]), 0) / 2;
    return { key: JSON.stringify([rock.centre, rock.axes, rock.role]), rect: pointsRect([
      { x: rock.centre[0] - halfX, z: rock.centre[2] - halfZ }, { x: rock.centre[0] + halfX, z: rock.centre[2] + halfZ }
    ], 1) };
  });
  rockRects.set(rocks, entries);
  return entries;
};

const rockParts = (world: WorldData, rect: TileRect, parts: string[]) => {
  for (const rock of rockEntries(getKnownRocks(world))) if (rectsIntersect(rock.rect, rect)) parts.push(`k${rock.key}`);
};

/**
 * Trunks and boulders are filed by the cell of their centre; a boulder's visible footprint (road rock
 * test) reaches up to 1.55 × its scale beyond it, so neighbouring cells are copied too.
 */
const PROP_FOOTPRINT_MARGIN = 4;

const obstacleKey = ({ props }: WorldData, index: number) =>
  `p${index}:${props.types[index]}:${props.x[index]}:${props.z[index]}:${props.scale[index]}`;

const visitObstacles = (world: WorldData, rect: TileRect, visit: (index: number) => void) => {
  const margin = PROP_FOOTPRINT_MARGIN;
  someObstacleInCells(world, rect.minX - margin, rect.minZ - margin, rect.maxX + margin, rect.maxZ + margin, index => {
    visit(index);
    return false;
  });
};

const obstacleParts = (world: WorldData, rect: TileRect, parts: string[]) =>
  visitObstacles(world, rect, index => parts.push(obstacleKey(world, index)));

/** The tiles whose reads meet an obstacle: its filing cell widened by the footprint margin. */
const obstacleReach = (world: WorldData, index: number): TileRect => {
  const x = Math.min(world.cellsX - 1, Math.max(0, Math.floor(world.props.x[index]!)));
  const z = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(world.props.z[index]!)));
  const margin = PROP_FOOTPRINT_MARGIN;
  return { maxX: x + margin, maxZ: z + margin, minX: x - margin, minZ: z - margin };
};

const objectKey = (context: SettlementContext, { navigation, terrain: rect }: InputRects) => {
  const parts: string[] = [], { world } = context.options;
  if (navigation) {
    buildingParts(context, navigation, parts);
    roadParts(context, navigation, parts);
    decorationParts(context, navigation, parts);
    fieldParts(context, navigation, parts);
  }
  rockParts(world, rect, parts);
  obstacleParts(world, rect, parts);
  return parts.join("\n");
};

const gridByteCount = (context: SettlementContext, rects: InputRects) => {
  let count = 0;
  visitGridBytes(context, rects, (_bytes, _start, length) => { count += length; });
  return count;
};

/** Copies the inputs inside the rectangles (already clamped to the world). */
export const captureInputFingerprint = (context: SettlementContext, rects: InputRects): InputFingerprint => {
  const bytes = new Uint8Array(gridByteCount(context, rects));
  let write = 0;
  visitGridBytes(context, rects, (source, start, length) => {
    bytes.set(source.subarray(start, start + length), write);
    write += length;
  });
  return { bytes, objects: objectKey(context, rects), rects };
};

/** True when every input inside the fingerprint's rectangles still equals its copy. */
export const sameInputFingerprint = (context: SettlementContext, fingerprint: InputFingerprint) => {
  const { bytes, rects } = fingerprint;
  let read = 0, same = gridByteCount(context, rects) === bytes.length;
  if (same) visitGridBytes(context, rects, (source, start, length) => {
    for (let index = 0; same && index < length; index++) same = source[start + index] === bytes[read + index];
    read += length;
  });
  return same && objectKey(context, rects) === fingerprint.objects;
};

/**
 * Whole-map inputs; null when reuse is off (A03 rollback mode, `findWorkerPath` contexts), so every
 * geometry is renewed as before.
 */
export const inputIdentity = (context: SettlementContext) => {
  if (navigationInvalidation().mode === "global" || context.options.findWorkerPath) return null;
  const { world } = context.options, camps = context.adventure?.campCount?.() ?? 0;
  return [world.cellsX, world.cellsZ, world.seaLevel, context.playerNation ?? "roman",
    camps ? `${camps}:${context.adventure?.campRevision?.() ?? 0}` : ""].join(":");
};

/** Rocks and trunks inside a terrain rectangle, keyed as in the fingerprint, with the tiles they reach. */
const terrainObjectReaches = (world: WorldData, rect: TileRect) => {
  const reaches = new Map<string, TileRect>();
  for (const rock of rockEntries(getKnownRocks(world)))
    if (rectsIntersect(rock.rect, rect)) reaches.set(`k${rock.key}`, rock.rect);
  visitObstacles(world, rect, index => reaches.set(obstacleKey(world, index), obstacleReach(world, index)));
  return reaches;
};

/** A terrain-only copy (no cell grids, no settlement objects) with its rocks' and trunks' reaches. */
export interface TerrainInputCopy {
  fingerprint: InputFingerprint;
  reaches: Map<string, TileRect>;
}

export const captureTerrainInputs = (context: SettlementContext, terrain: TileRect): TerrainInputCopy => ({
  fingerprint: captureInputFingerprint(context, { cells: null, navigation: null, terrain }),
  reaches: terrainObjectReaches(context.options.world, terrain)
});

/** The tiles whose grid bytes differ from the copy (a changed vertex counts for its four tiles). */
const changedGridTiles = (context: SettlementContext, { bytes, rects }: InputFingerprint): TileRect | null => {
  if (gridByteCount(context, rects) !== bytes.length) return rects.terrain;
  const changed = { maxX: -Infinity, maxZ: -Infinity, minX: Infinity, minZ: Infinity };
  let read = 0;
  visitGridBytes(context, rects, (source, start, length, z, { edge, minX, size }) => {
    for (let index = 0; index < length; index++) {
      if (source[start + index] === bytes[read + index]) continue;
      const x = minX + Math.floor(index / size);
      changed.minX = Math.min(changed.minX, x - edge);
      changed.maxX = Math.max(changed.maxX, x);
      changed.minZ = Math.min(changed.minZ, z - edge);
      changed.maxZ = Math.max(changed.maxZ, z);
    }
    read += length;
  });
  return changed.minX > changed.maxX ? null : changed;
};

/**
 * PERF-FOLLOWUPS: the tile rectangles whose terrain inputs changed since `copy` was taken: one
 * rectangle round the changed grid bytes plus the reach of every rock or trunk that appeared,
 * disappeared or moved. A value whose reads (inside the copy) meet none of them still holds.
 */
export const changedTerrainTiles = (context: SettlementContext, copy: TerrainInputCopy): TileRect[] => {
  const { fingerprint, reaches } = copy, { world } = context.options;
  const changed: TileRect[] = [];
  const grid = changedGridTiles(context, fingerprint);
  if (grid) changed.push(grid);
  if (objectKey(context, fingerprint.rects) === fingerprint.objects) return changed;
  const now = terrainObjectReaches(world, fingerprint.rects.terrain);
  for (const [key, reach] of now) if (!reaches.has(key)) changed.push(reach);
  for (const [key, reach] of reaches) if (!now.has(key)) changed.push(reach);
  return changed;
};


