import type { WorldData } from "../../shared/world/world-data";
import { profileStep } from "../load-profile";
import { CHUNK_CELLS, type ChunkKey,getChunkCounts } from "../terrain-chunks";
import { createGeologyMap } from "./geology";
import { collectTrunks, createThemeTintShift, getIslandRocks } from "./island-rock-instances";
import { createMeadowStones } from "./meadow-stones";
import { createMineStones } from "./mine-stones";
import { getRockContact } from "./rock-contact";
import type { RockInstance } from "./rock-instances";
import { buildRockMesh, groupRocksByChunk, isSmallRock, type RockMeshData } from "./rock-mesh";
import { placeContactPebbles } from "./rock-pebbles";
import { createRockLibrary, type RockLibrary } from "./rock-shapes";
import type { RockSkinDetail } from "./rock-skin";
import { createWorldRockTerrain, type RockTerrain } from "./rock-terrain";
import { getRockChunk } from "./rock-tiles";

/**
 * Zoom (iso view) below which rubble and contact pebbles are hidden: they are a few pixels there
 * and only cost triangles. Rotated or cinematic cameras keep them (they can look close).
 */
const SMALL_ROCK_MIN_ZOOM = 0.6;

export const showsSmallRocks = (zoom: number, isIsoView: boolean) =>
  !isIsoView || zoom >= SMALL_ROCK_MIN_ZOOM;

/** Stone groups with their own meshes per chunk (rebuilt after map edits). */
export type StoneGroup = "meadow" | "mine";

/** One draw call worth of rock: `small` meshes (rubble, pebbles) follow the distance LOD. */
export interface IslandRockMesh {
  chunk: number;
  data: RockMeshData;
  /**
   * Stones the map editor rebuilds per chunk (mine chips and meadow stones): their
   * own meshes; unset for the rest of the rock layer.
   */
  group?: StoneGroup;
  small: boolean;
}

/** Rock mesh detail of the island layers (full detail, rubble kept). */
export const ROCK_MESH_OPTIONS = { detail: "auto", skipRubble: false } as const;

/** Rock terrain and geology tint shared by the rock bodies and the mountain skin. */
const createRockGround = (world: WorldData, vertexFog: Float32Array) => {
  const terrain = profileStep("rock terrain", () => createWorldRockTerrain(world, vertexFog));
  const geology = createGeologyMap(terrain, world.seed, {
    tintShift: createThemeTintShift(world)
  });
  return { geology, terrain, tint: geology.tint };
};

/**
 * What turns rock instances into meshes: the shape library, the terrain they sit on and the
 * geology tint.
 */
export interface RockMeshGround {
  library: RockLibrary;
  terrain: RockTerrain;
  tint: (x: number, z: number) => number;
}

/** The mesh ground of the island (map editor: stone rebuilds on the main thread). */
export const createRockMeshGround = (world: WorldData, vertexFog: Float32Array) => {
  const { terrain, tint } = createRockGround(world, vertexFog);
  return { library: createRockLibrary(), terrain, tint };
};

/** Rocks merged per terrain chunk into a main and a small-rock mesh (rubble, pebbles). */
const toChunkMeshes = (
  world: WorldData,
  rocks: RockInstance[],
  ground: Pick<RockMeshGround, "library" | "terrain">,
  group?: StoneGroup
) => {
  const { chunksX } = getChunkCounts(world);
  const toMesh = (chunk: number, list: RockInstance[], small: boolean): IslandRockMesh[] => {
    if (list.length === 0) return [];
    const data = buildRockMesh(list, ground.library, ground.terrain, ROCK_MESH_OPTIONS);
    return [{ chunk, data, group, small }];
  };
  return [...groupRocksByChunk(rocks, chunksX)].flatMap(([chunk, list]) => [
    ...toMesh(
      chunk,
      list.filter((rock) => !isSmallRock(rock)),
      false
    ),
    ...toMesh(chunk, list.filter(isSmallRock), true)
  ]);
};

/**
 * Keeps the points inside the chunks, or within `margin` cells of them (all points without a
 * chunk list).
 */
export const createChunkFilter = (chunks?: readonly ChunkKey[], margin = 0) => {
  if (!chunks) return () => true;
  const wanted = new Set(chunks.map(({ chunkX, chunkZ }) => `${chunkX},${chunkZ}`));
  const has = (x: number, z: number) =>
    wanted.has(`${Math.floor(x / CHUNK_CELLS)},${Math.floor(z / CHUNK_CELLS)}`);
  if (margin === 0) return has;
  return (x: number, z: number) =>
    has(x, z) ||
    has(x - margin, z - margin) ||
    has(x + margin, z - margin) ||
    has(x - margin, z + margin) ||
    has(x + margin, z + margin);
};

/**
 * Keeps the rocks the chunks own (placed by their tiles, see rock-tiles.ts); all rocks without a
 * chunk list.
 */
export const createRockOwnerFilter = (world: WorldData, chunks?: readonly ChunkKey[]) => {
  if (!chunks) return () => true;
  const { chunksX } = getChunkCounts(world);
  const owners = new Set(chunks.map(({ chunkX, chunkZ }) => chunkZ * chunksX + chunkX));
  return (rock: RockInstance) => owners.has(getRockChunk(rock, chunksX));
};

/**
 * The stones of a group (mine fields, meadow stones) as meshes per chunk, flagged with the group;
 * with `chunks` only those chunks (map editor: the touched chunks are rebuilt, the rest keep
 * their stones).
 */
export const buildStoneGroupMeshes = (
  world: WorldData,
  ground: RockMeshGround,
  group: StoneGroup,
  chunks?: readonly ChunkKey[]
) => {
  const keep = createChunkFilter(chunks);
  const { terrain, tint } = ground;
  const stones =
    group === "mine"
      ? createMineStones(world, { keepCell: keep, seed: world.seed, terrain })
      : createMeadowStones(world, terrain, tint, keep);
  return toChunkMeshes(world, stones, ground, group);
};

/**
 * Loose stones and contact pebbles where rock meets the ground, merged per
 * terrain chunk (culled with the chunk) into a main mesh and a small-rock mesh (rubble,
 * pebbles: hidden when zoomed out). With `chunks` only those chunks are built (map editor: an
 * edited area; the placed rocks are the remembered ones there).
 */
export const buildIslandRockBodies = (
  world: WorldData,
  vertexFog: Float32Array,
  chunks?: readonly ChunkKey[]
) => {
  const ground = createRockGround(world, vertexFog);
  const { tint } = ground;
  const keep = createChunkFilter(chunks);
  const terrain = chunks ? { ...ground.terrain, area: keep } : ground.terrain;
  const library = profileStep("rock library", createRockLibrary);
  const rocks = profileStep("rock placement", () =>
    getIslandRocks(world, terrain).filter(createRockOwnerFilter(world, chunks))
  );
  const pebbles = profileStep("rock pebbles", () =>
    placeContactPebbles(world, getRockContact(world), {
      seed: world.seed,
      terrain,
      tint,
      trunks: collectTrunks(world)
    })
  );
  // Mountain relief is the authoritative terrain mesh. Raised skins and fitted masses
  // introduce a second silhouette and a dark seam at its feet; keep only loose stones.
  const all = [...rocks, ...pebbles];
  const bodies = profileStep("rock chunk meshes", () =>
    toChunkMeshes(world, all, { library, terrain })
  );
  const meshGround = { library, terrain, tint };
  const meadow = profileStep("meadow stones", () =>
    buildStoneGroupMeshes(world, meshGround, "meadow", chunks)
  );
  const mine = profileStep("mine stones", () =>
    buildStoneGroupMeshes(world, meshGround, "mine", chunks)
  );
  return {
    chunks: [...bodies, ...meadow, ...mine],
    count: rocks.length,
    masses: 0,
    pebbles: pebbles.length,
    placed: rocks
  };
};

/**
 * Mountain skins are intentionally omitted: the ground mesh supplies the seamless surface.
 * The worker signature remains compatible with terrain loading and editor rebuilds.
 */
export const buildIslandRockSkins = (
  _world: WorldData,
  _vertexFog: Float32Array,
  _part = 0,
  _parts = 1,
  _chunks?: readonly ChunkKey[],
  _detail: RockSkinDetail = "full"
) => {
  // Retain the worker API: the terrain itself now supplies the continuous mountain surface.
  return [] as IslandRockMesh[];
};

/** The island's whole rock layer (bodies first, then the skin). */
export interface IslandRocks {
  chunks: IslandRockMesh[];
  count: number;
  pebbles: number;
}
