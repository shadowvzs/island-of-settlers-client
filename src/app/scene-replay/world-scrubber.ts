import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { listRegionChunks } from "../../render-common/terrain-chunks";
import type { CellRegion } from "../../shared/world/grid-geometry";
import { PROP_REMOVED, type WorldData } from "../../shared/world/world-data";
import { decodeSceneData, unpackSceneData } from "./codec";
import type { SceneSegment } from "./journal";
import { applySceneWorldEdits, type SceneWorldEdit } from "./world-delta";

/** World fields whose edits never change terrain geometry. */
const NON_TERRAIN_FIELDS = ["props", "fog", "permanentFog", "fogRevision", "buildRevision", "buildClass", "blocking"];
/** Grid margin around edited cells (normals and blends reach the neighbours). */
const MARGIN = 1;

type GridArray = ArrayLike<number>;

const fullRegion = (world: WorldData): CellRegion => ({ maxX: world.cellsX - 1, maxZ: world.cellsZ - 1, minX: 0,
  minZ: 0 });

const readArray = (world: WorldData, path: readonly string[]) => {
  let item: unknown = world;
  for (const key of path) item = (item as Record<string, unknown> | undefined)?.[key];
  return ArrayBuffer.isView(item) ? item as unknown as GridArray : undefined;
};

/** The grid cell of an array index: vertex grids ((cellsX + 1)²) and cell grids, any stride. */
const gridCell = (world: WorldData, length: number, index: number) => {
  const vertices = (world.cellsX + 1) * (world.cellsZ + 1);
  const cells = world.cellsX * world.cellsZ;
  if (length % vertices === 0) {
    const vertex = Math.floor(index / (length / vertices));
    return { x: vertex % (world.cellsX + 1), z: Math.floor(vertex / (world.cellsX + 1)) };
  }
  if (length % cells !== 0) return undefined;
  const cell = Math.floor(index / (length / cells));
  return { x: cell % world.cellsX, z: Math.floor(cell / world.cellsX) };
};

const growRegion = (region: CellRegion | undefined, world: WorldData, x: number, z: number): CellRegion => ({
  maxX: Math.min(world.cellsX - 1, Math.max(region?.maxX ?? -Infinity, Math.floor(x) + MARGIN)),
  maxZ: Math.min(world.cellsZ - 1, Math.max(region?.maxZ ?? -Infinity, Math.floor(z) + MARGIN)),
  minX: Math.max(0, Math.min(region?.minX ?? Infinity, Math.floor(x) - MARGIN)),
  minZ: Math.max(0, Math.min(region?.minZ ?? Infinity, Math.floor(z) - MARGIN))
});

/** Cells the terrain edits touched; the whole map when an edit is not a grid array entry list. */
const terrainRegion = (world: WorldData, edits: readonly SceneWorldEdit[]) => {
  let region: CellRegion | undefined;
  for (const edit of edits) {
    const array = edit.entries && readArray(world, edit.path);
    if (!array || !edit.entries) return fullRegion(world);
    for (const [index] of edit.entries) {
      const cell = gridCell(world, array.length, index);
      if (!cell) return fullRegion(world);
      region = growRegion(region, world, cell.x, cell.z);
    }
  }
  return region;
};

/** Props the deltas removed, or undefined when they did more (appended or changed props). */
const removedProps = (world: WorldData, edits: readonly SceneWorldEdit[]) => {
  const removed: number[] = [];
  let region: CellRegion | undefined;
  for (const edit of edits) {
    const removal = edit.path.join(".") === "props.types" && edit.entries?.every(([, type]) => type === PROP_REMOVED);
    if (!removal) return undefined;
    for (const [id] of edit.entries!) {
      removed.push(id);
      region = growRegion(region, world, world.props.x[id]!, world.props.z[id]!);
    }
  }
  return { region: region ?? fullRegion(world), removed };
};

/** Prop removals redraw only their cells; anything else (or a full rebuild) re-reads every prop. */
const refreshProps = (world: WorldData, renderer: TerrainRenderer, edits?: readonly SceneWorldEdit[]) => {
  const removal = edits && removedProps(world, edits);
  if (removal) {
    renderer.mapEdit.removeProps(removal.removed, removal.region);
    return;
  }
  renderer.mapEdit.refreshPlacedProps(0);
  const removed = Array.from({ length: world.props.count }, (_, id) => id)
    .filter(id => world.props.types[id] === PROP_REMOVED);
  renderer.mapEdit.removeProps(removed, fullRegion(world));
};

/** Rebuild only the renderer parts (and cells) a world delta touched; no delta: a full rebuild. */
const refreshRenderedWorld = (world: WorldData, renderer: TerrainRenderer, edits?: SceneWorldEdit[]) => {
  const terrain = edits ? edits.filter(edit => !NON_TERRAIN_FIELDS.includes(edit.path[0]!)) : undefined;
  const props = edits ? edits.filter(edit => edit.path[0] === "props") : undefined;
  const region = terrain ? terrainRegion(world, terrain) : fullRegion(world);
  if (region) renderer.mapEdit.refreshChunks(listRegionChunks(world, region), true);
  if (!props || props.length) refreshProps(world, renderer, props);
  if (region) renderer.mapEdit.refreshFieldCover(region);
};

/**
 * Applies the recorded world deltas up to a sample's revision. The renderer was built from the
 * segment's start world (`start`: its packed bytes), so revision 0 needs nothing; backward seeks
 * restore that start world and replay the deltas.
 */
export const createWorldScrubber = (
  world: WorldData,
  renderer: TerrainRenderer,
  segment: SceneSegment,
  start: Uint8Array
) => {
  let appliedRevision = 0;
  return (revision: number) => {
    if (revision === appliedRevision) return;
    const resetting = revision < appliedRevision;
    if (resetting) {
      Object.assign(world, unpackSceneData(start) as WorldData);
      appliedRevision = 0;
    }
    const edits: SceneWorldEdit[] = [];
    for (let index = appliedRevision; index < revision; index++) {
      const delta = decodeSceneData(segment.deltas[index]!.data) as SceneWorldEdit[];
      applySceneWorldEdits(world, delta);
      edits.push(...delta);
    }
    appliedRevision = revision;
    refreshRenderedWorld(world, renderer, resetting ? undefined : edits);
  };
};
