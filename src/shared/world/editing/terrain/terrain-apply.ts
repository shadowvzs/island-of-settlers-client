import { isStandingBlocker } from "../../build-class";
import { computeCoastDistance } from "../../generation/distance-field";
import { getCellTerrain } from "../../generation/gameplay";
import { getHeightLevel } from "../../generation/heights";
import { isGravelGround } from "../../generation/mine-apron";
import {
  type CellRegion,
  clampRegion,
  EMPTY_REGION,
  forEachRegionCell,
  isRegionEmpty,
  unionRegions} from "../../grid-geometry";
import { rebakeTerrainLight, refreshNormals } from "../../lighting";
import { BLOCKING, NO_MINE_ZONE, type WorldData } from "../../world-data";
import {
  createEditGround,
  type EditGround,
  refreshBuildLayers,
  refreshEditGround} from "../build-refresh";
import { addMineLand, removeMineLand } from "../mine-land";
import { reanchorPropsAfterTerrainEdit } from "../prop-grounding";
import { applyTerrainBrush, terrainBrushBounds,type TerrainBrushStroke } from "./terrain-brush";
import { checkStampSite, clearFootprint } from "./terrain-clearing";
import type { StampChange, TerrainEditState } from "./terrain-edit-state";
import { syncStampProps } from "./terrain-props";
import { getStampBounds, getTotalRing, type TerrainStamp } from "./terrain-stamps";
import { shapeRegion, toVertexBounds } from "./terrain-vertices";

/** Coast distance cap (cells), as the generator computes it. */
const COAST_LIMIT = 32;
/** Gravel ring weight from which a cell becomes mine land. */
const RING_CELL = 0.5;

/** What a terrain edit changed, for the build layers and the renderers' rebuild. */
export interface TerrainApply {
  /** Props added (boulders of low stamps). */
  added: number[];
  /** Cells whose ground changed: terrain chunks, rocks, field cover rebuild there. */
  cells: CellRegion;
  /** The fixed ground of the build layers, measured again on the new heights. */
  ground: EditGround;
  mineChanged: boolean;
  /** Props removed (cleared from the footprint, boulders of a raised or lowered stamp). */
  removed: number[];
  /** Sea water changed (land rose from the sea): the water layers rebuild. */
  waterChanged: boolean;
}

/** The ground before the first stamp, kept to derive every stamp from. */
const captureBase = (world: WorldData, state: TerrainEditState) => {
  state.base ??= {
    heights: Float32Array.from(world.heights),
    splat: Uint8Array.from(world.splat),
    waterSurface: Float32Array.from(world.waterSurface)
  };
  state.rise ??= new Float32Array(world.heights.length);
  state.ring ??= new Float32Array(world.heights.length);
  state.lake ??= new Uint8Array(world.heights.length);
  world.lakeWater ??= new Uint8Array(world.heights.length);
  return state.base;
};

/** Cells (clamped) of the change's reach: both versions of the stamp. */
const getChangeRegion = (world: WorldData, change: StampChange) => {
  const stamps = [change.before, change.after].filter((stamp): stamp is TerrainStamp => !!stamp);
  const bounds = stamps.map(getStampBounds);
  return clampRegion(world, {
    maxX: Math.ceil(Math.max(...bounds.map((bound) => bound.maxX))),
    maxZ: Math.ceil(Math.max(...bounds.map((bound) => bound.maxZ))),
    minX: Math.floor(Math.min(...bounds.map((bound) => bound.minX))),
    minZ: Math.floor(Math.min(...bounds.map((bound) => bound.minZ)))
  });
};

/** The cells a pending terrain batch can change (captured before it mutates the world). */
export const getTerrainApplyRegion = (
  world: WorldData,
  state: TerrainEditState,
  changes: readonly StampChange[],
  resets: readonly TerrainBrushStroke[] = []
) => {
  let cells = changes.reduce<CellRegion>((region, change) =>
    unionRegions(region, getChangeRegion(world, change)), EMPTY_REGION);
  for (const brush of resets) {
    const { cells: brushCells, reach } = terrainBrushBounds(world, brush);
    cells = unionRegions(cells, brushCells);
    // Sculpting bakes every intersecting stamp: its whole footprint leaves the stamp list and
    // its vertices are copied into the terrain tool's base arrays.
    for (const stamp of state.stamps) {
      const bounds = getStampBounds(stamp);
      if (bounds.minX > brush.x + reach || bounds.maxX < brush.x - reach ||
        bounds.minZ > brush.z + reach || bounds.maxZ < brush.z - reach) continue;
      cells = unionRegions(cells, clampRegion(world, {
        maxX: Math.ceil(bounds.maxX), maxZ: Math.ceil(bounds.maxZ),
        minX: Math.floor(bounds.minX), minZ: Math.floor(bounds.minZ)
      }));
    }
  }
  return cells;
};

/** Highest ground of a region's vertices (the shadow it cast before a change). */
const getHighest = (world: WorldData, cells: CellRegion) => {
  let highest = -Infinity;
  const stride = world.cellsX + 1;
  for (let z = cells.minZ; z <= cells.maxZ + 1; z += 1) {
    for (let x = cells.minX; x <= cells.maxX + 1; x += 1) {
      highest = Math.max(highest, world.heights[z * stride + x]!);
    }
  }
  return highest;
};

/** The coast distance follows the water (lakes, islets). */
export const refreshCoast = (world: WorldData) => {
  world.coastDistance.set(computeCoastDistance(world, world.waterDepth, COAST_LIMIT));
};

/** Whether a cell lies in the apron on open ground (every corner dry, no rock face, no snow). */
const isApronCell = (world: WorldData, state: TerrainEditState, x: number, z: number) => {
  if (getTotalRing(state.stamps, x + 0.5, z + 0.5) < RING_CELL) return false;
  const corner = z * (world.cellsX + 1) + x;
  const corners = [corner, corner + 1, corner + world.cellsX + 1, corner + world.cellsX + 2];
  return corners.every((vertex) => isGravelGround(world, world, vertex));
};

/**
 * The apron cells follow the stamps (after the region is shaped): open ground in an outcrop's,
 * hill's or mountain's footprint and its ring becomes mine land, cells no longer in it go.
 */
const applyRing = (world: WorldData, state: TerrainEditState, cells: CellRegion) => {
  const next = new Set<number>();
  forEachRegionCell(world, cells, (cell, x, z) => {
    if (isApronCell(world, state, x, z)) next.add(cell);
  });
  const gone = [...state.ringCells].filter((cell) => {
    const x = cell % world.cellsX;
    const z = Math.floor(cell / world.cellsX);
    const inside = x >= cells.minX && x <= cells.maxX && z >= cells.minZ && z <= cells.maxZ;
    return inside && !next.has(cell);
  });
  const fresh = [...next].filter((cell) => world.mineZone[cell] === NO_MINE_ZONE);
  removeMineLand(world, gone);
  addMineLand(world, fresh);
  for (const cell of gone) state.ringCells.delete(cell);
  for (const cell of next) state.ringCells.add(cell);
  return gone.length + fresh.length > 0;
};

/** Slope classes and blocking of the region's cells from the new heights and standing props. */
const applyCellTerrain = (world: WorldData, cells: CellRegion) => {
  forEachRegionCell(world, cells, (cell, x, z) => {
    const terrain = getCellTerrain(world, world, x, z);
    world.slopeClass[cell] = terrain.slopeClass;
    world.blocking[cell] = terrain.blocking;
  });
  const { props } = world;
  for (let index = 0; index < props.count; index += 1) {
    const x = Math.floor(props.x[index]!);
    const z = Math.floor(props.z[index]!);
    if (x < cells.minX || x > cells.maxX || z < cells.minZ || z > cells.maxZ) continue;
    const cell = z * world.cellsX + x;
    if (world.blocking[cell] === BLOCKING.free && isStandingBlocker(world, index)) {
      world.blocking[cell] = BLOCKING.prop;
    }
  }
};

/** One change: its footprint cleared, the region shaped, the stamp's props synced. */
const applyOneChange = (world: WorldData, state: TerrainEditState, change: StampChange) => {
  const cells = getChangeRegion(world, change);
  const clearing = change.after
    ? clearFootprint(world, state, change.after)
    : { mineChanged: false, removed: [] };
  const { waterChanged } = shapeRegion(world, state, cells);
  const ringChanged = applyRing(world, state, cells);
  const stampProps = syncStampProps(world, state, {
    after: change.after,
    beforeId: change.before?.id ?? null
  });
  return {
    added: stampProps.added,
    cells,
    mineChanged: clearing.mineChanged || ringChanged,
    removed: [...clearing.removed, ...stampProps.removed],
    waterChanged
  };
};

/** An overlapping edit must re-ground/revalidate the other source stamp's living shelves too. */
const refreshNeighbourShelfProps = (
  world: WorldData, state: TerrainEditState, changes: readonly StampChange[], cells: CellRegion
) => {
  const changed = new Set(changes.flatMap(change => [change.before?.id, change.after?.id]));
  return state.stamps.flatMap(stamp => {
    if (!stamp.template || changed.has(stamp.id)) return [];
    const bounds = getStampBounds(stamp);
    if (bounds.maxX < cells.minX || bounds.minX > cells.maxX ||
      bounds.maxZ < cells.minZ || bounds.minZ > cells.maxZ) return [];
    return [syncStampProps(world, state, { after: stamp, beforeId: stamp.id })];
  });
};

/** Vertices around an edit whose normals read a changed height (central differences). */
const NORMAL_HALO = 1;

/**
 * Re-derives the vertex layers an edit changed: normals of the cell region's vertices plus the
 * one-vertex halo their central differences read, and height levels of the region's vertices
 * only. Same values as the full derivations, without rebuilding the rest of the map.
 */
export const refreshEditedVertexLayers = (world: WorldData, cells: CellRegion) => {
  if (isRegionEmpty(cells)) return;
  const region = toVertexBounds(cells);
  const minX = Math.max(0, region.minX), maxX = Math.min(world.cellsX, region.maxX);
  const minZ = Math.max(0, region.minZ), maxZ = Math.min(world.cellsZ, region.maxZ);
  refreshNormals(world, world.heights, world.normals, {
    maxX: Math.min(world.cellsX, maxX + NORMAL_HALO),
    maxZ: Math.min(world.cellsZ, maxZ + NORMAL_HALO),
    minX: Math.max(0, minX - NORMAL_HALO),
    minZ: Math.max(0, minZ - NORMAL_HALO)
  });
  const stride = world.cellsX + 1;
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const vertex = z * stride + x;
      world.heightLevels[vertex] = getHeightLevel(world.heights[vertex]!);
    }
  }
};

/**
 * Shared height/water derivations for stamps, sculpting and authored river strokes;
 * `highestBefore` (the ground before the change) lets a removed peak's old shadow be re-baked.
 */
export const refreshEditedTerrain = (world: WorldData, cells: CellRegion, waterChanged: boolean,
  ground?: EditGround | null, reanchorOnly?: ReadonlySet<number>, highestBefore = -Infinity) => {
  refreshEditedVertexLayers(world, cells);
  if (waterChanged) refreshCoast(world);
  applyCellTerrain(world, cells);
  rebakeTerrainLight(
    world,
    world.heights,
    world.waterSurface,
    world.sun,
    toVertexBounds(cells),
    world,
    highestBefore
  );
  reanchorPropsAfterTerrainEdit(world, cells, reanchorOnly);
  const editGround = ground ? refreshEditGround(world, ground, cells) : createEditGround(world);
  refreshBuildLayers(world, editGround, cells);
  world.terrainRevision = (world.terrainRevision ?? 0) + 1;
  return editGround;
};

/**
 * Applies a batch of stamp changes to the world (map editor, pure on the world data): each
 * clears its footprint first and shapes its region (mountains merged, lakes dug, water, ground,
 * the gravel ring as mine land, the stamps' props); then, once for the batch, everything derived
 * from the heights: normals, height levels, coast, slope and blocking, the baked light, the
 * fixed ground of the build layers (measured again around the region only, `ground` when one
 * exists), terrain cap, walk cost and building spots.
 */
export const applyStampChanges = (
  world: WorldData,
  state: TerrainEditState,
  changes: readonly StampChange[],
  ground: EditGround | null = null,
  resets: readonly TerrainBrushStroke[] = []
): TerrainApply => {
  captureBase(world, state);
  const highestBefore = Math.max(
    ...changes.map((change) => getHighest(world, getChangeRegion(world, change)))
  );
  const applied = changes.map((change) => applyOneChange(world, state, change));
  let cells = applied.reduce<CellRegion>(
    (region, one) => unionRegions(region, one.cells),
    EMPTY_REGION
  );
  let waterChanged = applied.some((one) => one.waterChanged);
  const brushed = resets.map(brush => applyTerrainBrush(world, state, brush));
  for (const brush of brushed) cells = unionRegions(cells, brush.cells);
  waterChanged ||= brushed.some(brush => brush.waterChanged);
  const neighbours = refreshNeighbourShelfProps(world, state, changes, cells);
  const editGround = refreshEditedTerrain(world, cells, waterChanged, ground, undefined, highestBefore);
  return {
    added: [...applied, ...neighbours].flatMap((one) => one.added),
    cells,
    ground: editGround,
    mineChanged: [...applied, ...brushed].some((one) => one.mineChanged),
    removed: [...applied, ...neighbours, ...brushed].flatMap((one) => one.removed),
    waterChanged
  };
};

/** One stamp change (see applyStampChanges). */
export const applyStampChange = (world: WorldData, state: TerrainEditState, change: StampChange) =>
  applyStampChanges(world, state, [change]);

/** Why the change's new stamp may not stand there, or null (see checkStampSite). */
export const checkStampChange = (world: WorldData, state: TerrainEditState, change: StampChange) =>
  change.after ? checkStampSite(world, change.after, state.base ?? world) : null;
