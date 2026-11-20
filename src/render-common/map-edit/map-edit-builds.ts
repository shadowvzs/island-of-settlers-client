import { alignRegion, type CellRegion,isRegionEmpty } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { createVertexFog, type SurfaceMode } from "../chunk-sampling";
import { buildFieldCoverInstances } from "../props/field-cover";
import { clearBuildingGroundCoverCells, excludeFieldCoverRegion, excludeRoadFieldCover,
  releaseFieldCoverRegion, ROAD_COVER_REBUILD_MARGIN, setBuildingGroundCoverCells } from "../props/field-cover-exclusions";
import { buildPropInstanceRange, type PropInstances } from "../props/prop-instances";
import type { RendererMapEdit } from "../renderer-contract";
import { getIslandRocks,getKnownRocks } from "../rocks/island-rock-instances";
import {
  buildIslandRockBodies,
  buildStoneGroupMeshes,
  createRockMeshGround,
  type IslandRockMesh,
  ROCK_MESH_OPTIONS,
  type RockMeshGround,
  type StoneGroup
} from "../rocks/island-rocks";
import { createMeadowPropStones } from "../rocks/meadow-stones";
import { forgetRockContact } from "../rocks/rock-contact";
import { buildRockMesh, type RockMeshData } from "../rocks/rock-mesh";
import { getRockChunk } from "../rocks/rock-tiles";
import {
  buildChunk,
  type ChunkKey,
  type ChunkVertexData,
  getChunkCounts,
  listRegionChunks} from "../terrain-chunks";
import type { WaterWeeds } from "../water/water-weeds";
import type { WaterField, WaterFieldPatch } from "../water-field";
import type { RebuiltChunk, RegionRebuild } from "./region-rebuild";

/** A renderer's field cover: its culling chunk size, density and the swap of whole chunks. */
interface FieldCoverTarget {
  chunkCells: number;
  /** New cover of the region (whole culling chunks); the chunks' old cover goes. */
  replace: (region: CellRegion, instances: PropInstances) => void;
  samplesPerCell: number;
}

/** What a renderer swaps in after an edit (its own GPU objects for the rebuilt data). */
export interface MapEditTargets {
  /** Reanchor surviving trees, decorations and water plants after terrain heights change. */
  refreshPropGround?: (chunks: readonly ChunkKey[]) => void;
  /** null: the renderer draws no field cover (Minimal), so none is rebuilt. */
  fieldCover: FieldCoverTarget | null;
  /** Rewrites the cover-density texels of the edited cells (runs on every preset). */
  patchCoverField?: (cells: CellRegion) => void;
  /** Stops drawing world props (removed by the editor) in the static layers. */
  hideProps: (sourceIndices: readonly number[]) => void;
  /**
   * New stone meshes of a group for the chunks (ids chunkZ * chunksX + chunkX); the chunks' old
   * ones of that group go.
   */
  replaceStones: (group: StoneGroup, chunks: number[], meshes: IslandRockMesh[]) => void;
  /** Every rock mesh of the chunks (ids chunkZ * chunksX + chunkX) replaced by `meshes`. */
  replaceRockChunks: (chunks: number[], meshes: IslandRockMesh[]) => void;
  /** New ground of an existing terrain chunk (same vertices, new splat and shading). */
  setChunkGround: (data: ChunkVertexData) => void;
  /** A rebuilt terrain chunk of a surface mode (new vertices; null: no water chunk now). */
  setTerrainChunk: (chunk: RebuiltChunk) => void;
  /** The whole rebuilt water field texture, or a bounded patch (startup / compatibility). */
  setWaterField: (field: WaterField | WaterFieldPatch) => void;
  /** The water field's edited texel region: uploads only those rows. */
  setWaterFieldPatch?: (patch: WaterFieldPatch) => void;
  /** Replaces the underwater weeds of the edited cells, keeping every other clump. */
  replaceWaterWeeds?: (weeds: WaterWeeds, cells: CellRegion) => void;
  /** The whole rebuilt underwater weeds (startup / a renderer without region merges). */
  setWaterWeeds: (weeds: WaterWeeds) => void;
  /** The placed props' instances (replacing the previous ones). */
  setPlacedProps: (instances: PropInstances) => void;
  /**
   * Shows a returning stone (its rock mesh) growing in around `pivot` (its foot); `onGrown` runs once it
   * is full size. Without it the stones appear at once.
   */
  growStones?: (data: RockMeshData, pivot: GrowPivot, onGrown: () => void) => void;
}

/** The foot of a growing stone: it scales up from here. */
export interface GrowPivot {
  x: number;
  y: number;
  z: number;
}

/**
 * The map editor's rebuilds for one renderer, on the main thread (a few chunks per edit): terrain
 * chunk ground in the renderer's surface mode, the mine stones of the touched chunks, the field
 * cover of edited ground, removed props (and the meadow stones of removed rock props), the placed
 * props. The vertex fog is redone only when the fog of war changed; the rock mesh ground (shape
 * library) is created on the first stone rebuild.
 */
export const createRendererMapEdit = (
  world: WorldData,
  surfaceModes: SurfaceMode[],
  targets: MapEditTargets
): RendererMapEdit => {
  const mode = surfaceModes[0]!;
  let fog: Float32Array | null = null;
  let fogRevision = -1;
  let rockGround: RockMeshGround | null = null;
  /** World props the static layers stopped drawing (an undo may bring them back). */
  const hidden = new Set<number>();
  const getFog = () => {
    if (!fog || fogRevision !== (world.fogRevision ?? 0)) {
      fog = createVertexFog(world);
      fogRevision = world.fogRevision ?? 0;
    }
    return fog;
  };
  const getRockGround = () => {
    rockGround ??= createRockMeshGround(world, getFog());
    return rockGround;
  };
  const refreshStones = (group: StoneGroup, chunks: readonly ChunkKey[]) => {
    const rockGround = getRockGround();
    const { chunksX } = getChunkCounts(world);
    const ids = chunks.map(({ chunkX, chunkZ }) => chunkZ * chunksX + chunkX);
    targets.replaceStones(group, ids, buildStoneGroupMeshes(world, rockGround, group, chunks));
  };
  /** New field cover of the cells' culling chunks (the exclusions are already updated). */
  const rebuildFieldCover = (cells: CellRegion) => {
    targets.patchCoverField?.(cells);
    if (!targets.fieldCover) return;
    const { chunkCells, replace, samplesPerCell } = targets.fieldCover;
    const region = alignRegion(world, cells, chunkCells);
    if (isRegionEmpty(region)) return;
    replace(region, buildFieldCoverInstances(world, getFog(), samplesPerCell, region));
  };
  const applyRegion = (rebuild: RegionRebuild) => {
    for (const chunk of rebuild.chunks) targets.setTerrainChunk(chunk);
    targets.refreshPropGround?.(rebuild.chunks.map(chunk => chunk.key));
    const { chunksX } = getChunkCounts(world);
    const ids = [...new Set(rebuild.chunks.map(({ key }) => key.chunkZ * chunksX + key.chunkX))];
    targets.replaceRockChunks(ids, rebuild.rocks);
    if (rebuild.waterField) {
      if (targets.setWaterFieldPatch) targets.setWaterFieldPatch(rebuild.waterField);
      else targets.setWaterField(rebuild.waterField);
    }
    if (rebuild.waterWeeds) {
      if (targets.replaceWaterWeeds) targets.replaceWaterWeeds(rebuild.waterWeeds, rebuild.cells);
      else targets.setWaterWeeds(rebuild.waterWeeds);
    }
  };
  /** An instant look at edited heights: the chunks rebuilt here without the rock band. */
  const previewRegion = (chunks: readonly ChunkKey[], omitRockBand = true) => {
    for (const key of chunks) {
      for (const surface of surfaceModes) {
        const data = buildChunk(world, getFog(), key.chunkX, key.chunkZ, surface, omitRockBand);
        targets.setTerrainChunk({ data, key, mode: surface });
      }
    }
    targets.refreshPropGround?.(chunks);
  };
  return {
    applyRegion,
    previewRegion,
    surfaceModes,
    refreshChunks: (chunks, mineStones) => {
      for (const { chunkX, chunkZ } of chunks) {
        const data = buildChunk(world, getFog(), chunkX, chunkZ, mode);
        if (data) targets.setChunkGround(data);
      }
      if (mineStones) refreshStones("mine", chunks);
    },
    refreshRockClearance: () => {
      const previous = getKnownRocks(world), current = getIslandRocks(world);
      if (previous === current) return;
      const retained = new Set(current);
      const { chunksX } = getChunkCounts(world);
      const ids = [...new Set(previous.filter(rock => !retained.has(rock))
        .map(rock => getRockChunk(rock, chunksX)))];
      if (!ids.length) return;
      forgetRockContact(world);
      const chunks = ids.map(id => ({ chunkX: id % chunksX, chunkZ: Math.floor(id / chunksX) }));
      targets.replaceRockChunks(ids, buildIslandRockBodies(world, getFog(), chunks).chunks);
    },
    refreshFieldCover: rebuildFieldCover,
    reserveRoadGround: (segments) => {
      excludeRoadFieldCover(world, segments);
      if (!segments.length) return;
      const points = segments.flatMap(({ end, start }) => [start, end]);
      const margin = ROAD_COVER_REBUILD_MARGIN;
      const cells = {
        minX: Math.floor(Math.min(...points.map((p) => p.x)) - margin),
        maxX: Math.ceil(Math.max(...points.map((p) => p.x)) + margin),
        minZ: Math.floor(Math.min(...points.map((p) => p.z)) - margin),
        maxZ: Math.ceil(Math.max(...points.map((p) => p.z)) + margin)
      };
      rebuildFieldCover(cells);
    },
    releaseConstructionGround: (cells) => {
      releaseFieldCoverRegion(world, cells);
      rebuildFieldCover(cells);
    },
    reserveConstructionGround: (cells) => {
      excludeFieldCoverRegion(world, cells);
      rebuildFieldCover(cells);
    },
    reserveBuildingGroundCover: (uid, cells, region) => {
      setBuildingGroundCoverCells(world, uid, cells);
      rebuildFieldCover(region);
    },
    reserveBuildingGroundCovers: (entries) => {
      if (!entries.length) return;
      const region = entries.reduce<CellRegion>((merged, entry) => ({
        maxX: Math.max(merged.maxX, entry.region.maxX),
        maxZ: Math.max(merged.maxZ, entry.region.maxZ),
        minX: Math.min(merged.minX, entry.region.minX),
        minZ: Math.min(merged.minZ, entry.region.minZ)
      }), { ...entries[0]!.region });
      for (const entry of entries) setBuildingGroundCoverCells(world, entry.uid, entry.cells);
      rebuildFieldCover(region);
    },
    releaseBuildingGroundCover: (uid, region) => {
      if (clearBuildingGroundCoverCells(world, uid).length) rebuildFieldCover(region);
    },
    removeProps: (sourceIndices, rockCells) => {
      targets.hideProps(sourceIndices);
      for (const index of sourceIndices) hidden.add(index);
      const chunks = listRegionChunks(world, rockCells);
      if (chunks.length > 0) refreshStones("meadow", chunks);
    },
    growProps: (sourceIndices, rockCells) => {
      const chunks = listRegionChunks(world, rockCells);
      const settle = () => {
        if (chunks.length > 0) refreshStones("meadow", chunks);
      };
      for (const index of sourceIndices) hidden.delete(index);
      const ground = getRockGround();
      const grown = sourceIndices.map(index => ({
        index, stones: createMeadowPropStones(world, ground.terrain, ground.tint, index)
      })).filter(({ stones }) => stones.length > 0);
      if (!targets.growStones || !grown.length) {
        settle();
        return;
      }
      let pending = grown.length;
      const onGrown = () => {
        pending -= 1;
        if (pending === 0) settle();
      };
      for (const { index, stones } of grown) {
        const { props } = world;
        const pivot = { x: props.x[index]!, y: props.y[index]!, z: props.z[index]! };
        targets.growStones(buildRockMesh(stones, ground.library, ground.terrain, ROCK_MESH_OPTIONS), pivot, onGrown);
      }
    },
    refreshPlacedProps: (firstIndex) => {
      const restored = [...hidden].filter((index) => index < firstIndex);
      const { count } = world.props;
      targets.setPlacedProps(buildPropInstanceRange(world, getFog(), firstIndex, count, restored));
    }
  };
};
