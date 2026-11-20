import type { CellRegion } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { createVertexFog, type SurfaceMode } from "../chunk-sampling";
import { installGroundZoneField } from "../ground-zone-field";
import { placeIslandRocks, rememberIslandRocks } from "../rocks/island-rock-instances";
import {
  buildIslandRockBodies,
  buildIslandRockSkins,
  createChunkFilter,
  createRockOwnerFilter,
  type IslandRockMesh
} from "../rocks/island-rocks";
import { useAreaRockContact } from "../rocks/rock-contact";
import type { RockInstance } from "../rocks/rock-instances";
import type { RockSkinDetail } from "../rocks/rock-skin";
import { createWorldRockTerrain } from "../rocks/rock-terrain";
import { buildChunk, type ChunkKey, type ChunkVertexData } from "../terrain-chunks";
import { buildWaterWeedsRegion, type WaterWeeds } from "../water/water-weeds";
import { createWaterFieldPatch, type WaterFieldPatch } from "../water-field";
import { type EditRevision,getEditRevision } from "./edit-revision";

/** Cells around the rebuilt chunks the rock contact covers (its band reaches into them). */
const CONTACT_MARGIN = 3;

/** What a terrain edit's rebuild needs besides the edited world. */
export interface RegionRebuildRequest {
  /** The edited cells (the water field patch and regional weed rebuild stay inside them). */
  cells: CellRegion;
  chunks: ChunkKey[];
  /** Surface modes of the renderer's terrain chunks ("terrain" and "water"). */
  modes: SurfaceMode[];
  /** The island's placed rocks so far (the area's are placed afresh, the rest kept). */
  placed: RockInstance[];
  /** Same geometry quality as the loaded island; edit rebuilds must preserve chunk seams. */
  rockSkinDetail?: RockSkinDetail;
  /** The sea changed: the water field texture is rebuilt too. */
  waterField: boolean;
  /** The world revision the requester queued this build for (echoed back and checked before install). */
  revision?: EditRevision;
  /** The requester's ground zones, already patched around the edit (the worker skips its whole-map build). */
  groundZones?: Float32Array;
}

/** One rebuilt terrain chunk of a surface mode (null: a water chunk without water now). */
export interface RebuiltChunk {
  data: ChunkVertexData | null;
  key: ChunkKey;
  mode: SurfaceMode;
}

/** Everything a renderer swaps in after a terrain edit. */
export interface RegionRebuild {
  /** The edited cells this result covers (a bounded water field patch and weed region). */
  cells: CellRegion;
  chunks: RebuiltChunk[];
  /** Every placed rock of the island after the edit (navigation colliders, rock contact). */
  placed: RockInstance[];
  /** Every rock mesh of the chunks (bodies, stone groups, skin): the chunks' old ones go. */
  rocks: IslandRockMesh[];
  /** The water field's edited texel region (null when the water did not change). */
  waterField: WaterFieldPatch | null;
  /** Underwater weeds of the edited cells (rebuilt with the water field). */
  waterWeeds: WaterWeeds | null;
  /** The exact world revision this result was computed from (stale results are never installed). */
  revision: EditRevision;
}

/**
 * A part of the rebuild for one worker: everything but the skin, or the skin of chunks. The
 * editor now schedules the main part only (the terrain surface supplies the mountain surface);
 * the empty skin part remains for the historical audit fixture and worker API compatibility.
 */
export type RegionRebuildPart = "main" | "skin";

/** The mountain skin of the chunks (empty since the terrain surface supplies the mountain). */
const buildSkinPart = (world: WorldData, request: RegionRebuildRequest): RegionRebuild => ({
  cells: request.cells,
  chunks: [],
  placed: [],
  rocks: buildIslandRockSkins(world, createVertexFog(world), 0, 1,
    request.chunks, request.rockSkinDetail),
  revision: getEditRevision(world),
  waterField: null,
  waterWeeds: null
});

/**
 * The heavy rebuild of a terrain edit (worker jobs): the rocks the edited chunks own placed
 * afresh on the new terrain, exactly as a full build places them there (the rest of the island
 * keeps its rocks; the rock contact is measured around the chunks only), their meshes, the
 * chunks' terrain in every surface mode, the water field and the underwater weeds when the water
 * changed ("main"); the mountain skin of the chunks ("skin", split over workers).
 */
export const buildEditedRegion = (
  world: WorldData,
  request: RegionRebuildRequest,
  part: RegionRebuildPart = "main"
): RegionRebuild => {
  if (part === "skin") return buildSkinPart(world, request);
  if (request.groundZones) installGroundZoneField(world, request.groundZones);
  const fog = createVertexFog(world);
  const terrain = {
    ...createWorldRockTerrain(world, fog),
    area: createChunkFilter(request.chunks)
  };
  const isRebuilt = createRockOwnerFilter(world, request.chunks);
  const outside = request.placed.filter((rock) => !isRebuilt(rock));
  const placed = [...outside, ...placeIslandRocks(world, terrain)];
  rememberIslandRocks(world, placed);
  useAreaRockContact(world, createChunkFilter(request.chunks, CONTACT_MARGIN));
  const rocks = buildIslandRockBodies(world, fog, request.chunks).chunks;
  const chunks = request.modes.flatMap((mode) =>
    request.chunks.map((key): RebuiltChunk => ({
      data: buildChunk(world, fog, key.chunkX, key.chunkZ, mode),
      key,
      mode
    }))
  );
  const waterField = request.waterField ? createWaterFieldPatch(world, fog, request.cells) : null;
  const waterWeeds = request.waterField ? buildWaterWeedsRegion(world, fog, request.cells) : null;
  return {
    cells: request.cells,
    chunks, placed, revision: getEditRevision(world), rocks, waterField, waterWeeds
  };
};
