import { BAKE_PASSES, type BakedPasses,mergeBakedPasses } from "../render-common/baker/prop-baker";
import type { BakedTreeViews } from "../render-common/baker/tree-view-baker";
import type { SurfaceMode } from "../render-common/chunk-sampling";
import type { ContentBuilders, SharedContentBuilders } from "../render-common/content-builders";
import { peekGroundZoneField } from "../render-common/ground-zone-field";
import {
  type EditRevision,
  getEditRevision,
  type TaggedEditResult
} from "../render-common/map-edit/edit-revision";
import type { RegionRebuild, RegionRebuildRequest } from "../render-common/map-edit/region-rebuild";
import { ADVENTURE_PROP_CACHE_VERSION } from "../render-common/props/adventure-prop-kinds";
import type { CoverField } from "../render-common/props/cover-field";
import type { PropMesh } from "../render-common/props/mesh-builder";
import type { PropInstances } from "../render-common/props/prop-instances";
import { rememberIslandRocks } from "../render-common/rocks/island-rock-instances";
import type { buildIslandRockBodies } from "../render-common/rocks/island-rocks";
import type { RockInstance } from "../render-common/rocks/rock-instances";
import type { RockSkinDetail } from "../render-common/rocks/rock-skin";
import type { ChunkVertexData } from "../render-common/terrain-chunks";
import type { WaterField } from "../render-common/water-field";
import type { NavWorld } from "../render-common/wildlife/nav/nav-query";
import type { WorldData } from "../shared/world/world-data";
import { islandBuildKeys } from "./island-build-keys";
import { SHARED_GROUP } from "./island-cache";
import type { WorkerPool } from "./worker-pool";

type RockBodies = ReturnType<typeof buildIslandRockBodies>;

/** Workers sharing the chunks of one terrain surface. */
const TERRAIN_PARTS = 2;

/** One promise per key: a build requested twice (prefetch, then the renderer) runs once. */
const memoize = <T>(cache: Map<string, Promise<unknown>>, key: string, build: () => Promise<T>) => {
  const known = cache.get(key) as Promise<T> | undefined;
  if (known) return known;
  const started = build();
  cache.set(key, started);
  return started;
};

/**
 * The world independent builds (prop meshes, sprite bakes), cached in the shared group: code
 * and atlases only, so a new island reuses them. They exist before the world:
 * a renderer may prefetch them while the island is generated.
 */
export const createSharedBuilders = (pool: WorkerPool): SharedContentBuilders => {
  const started = new Map<string, Promise<unknown>>();
  return {
    /** One job per pass (colour, normal, wind): three workers bake the atlas together. */
    bakeSprites: (name, meshes, leafAtlas) =>
      memoize(started, `sprites ${name}`, async () => {
        const parts = BAKE_PASSES.map((pass) =>
          pool.runCached<BakedPasses>(
            { group: SHARED_GROUP, key: `bake ${pass} ${name}` },
            {
              kind: "bakeSprites",
              // Only the normal pass samples the leaf normal atlas; avoid copying it to the others.
              leafAtlas: pass === "normal" ? leafAtlas : {
                pixels: leafAtlas.pixels, size: leafAtlas.size
              },
              meshes,
              passes: [pass]
            },
            `bake ${name} ${pass}`
          )
        );
        return mergeBakedPasses(await Promise.all(parts));
      }),
    /** One job per surface: the pool paints a nation's 27+ map sets side by side. */
    paintBuildingSurface: (paint) => {
      const key = `building surface ${paint.nation} ${paint.surface} ${paint.resolution} ${paint.detailed}`;
      return memoize(started, key, () =>
        pool.runCached<Uint8ClampedArray<ArrayBuffer>[]>(
          { group: SHARED_GROUP, key },
          { kind: "buildingSurface", paint },
          `surface ${paint.nation} ${paint.surface}`
        )
      );
    },
    propMeshes: (seed) =>
      memoize(started, `prop meshes ${seed} ${ADVENTURE_PROP_CACHE_VERSION}`, () =>
        pool.runPacked<PropMesh[]>(
          { group: SHARED_GROUP, key: `prop meshes ${seed} ${ADVENTURE_PROP_CACHE_VERSION}` },
          {
            kind: "propMeshes",
            seed
          }
        )
      )
  };
};

/** The renderers' content builds plus the app's own island builds (animal navigation). */
export interface IslandBuilders extends ContentBuilders {
  /** Map editor: the heavy rebuild of an edited area (uncached, the world as edited). */
  editRegion: (request: RegionRebuildRequest) => Promise<RegionRebuild>;
  /** Map editor: keeps the workers warm for its rebuilds. */
  keepEditWorkers: () => void;
  /** Map editor: the animals' navigation again, from the rocks after an edit (uncached). */
  editedNav: (rocks: RockInstance[], revision?: EditRevision) => Promise<TaggedEditResult<NavWorld>>;
  islandNav: () => Promise<NavWorld>;
}

/**
 * The content builds of one island as worker jobs (the world is copied to each job's worker),
 * cached in the island's group: rocks, terrain, field cover and water field by their inputs;
 * plus the shared builders.
 */
export const createPoolBuilders = (
  pool: WorkerPool,
  shared: SharedContentBuilders,
  world: WorldData,
  island: string
): IslandBuilders => {
  const slot = (key: string) => ({ group: island, key });
  const keys = islandBuildKeys(world);

  /** Rock bodies once: the rock layer and the animal navigation both use them. */
  let rockBodies: Promise<RockBodies> | null = null;
  const getRockBodies = () =>
    (rockBodies ??= pool.runCached<RockBodies>(slot(keys.rockBodies), { kind: "rockBodies", world }));

  let activeRockSkinDetail: RockSkinDetail = "full";
  const islandRocks = async (detail: RockSkinDetail = "full") => {
    activeRockSkinDetail = detail;
    const { placed, ...bodies } = await getRockBodies();
    rememberIslandRocks(world, placed);
    // The terrain surface supplies the mountain skin; the worker skin job has returned no meshes
    // since that replacement, so do not copy the world and rebuild fog for empty results.
    return bodies;
  };

  /** Terrain chunks in contiguous parts (far to near), joined back in order. */
  const terrainChunks = async (mode: SurfaceMode) => {
    const parts = Array.from({ length: TERRAIN_PARTS }, (_, part) =>
      pool.runCached<ChunkVertexData[]>(
        slot(keys.terrainChunks(mode, part, TERRAIN_PARTS)),
        { kind: "terrainChunks", mode, part, parts: TERRAIN_PARTS, world },
        `terrain ${mode} ${part + 1}/${TERRAIN_PARTS}`
      )
    );
    return (await Promise.all(parts)).flat();
  };

  /** The animals' navigation (worker), from the placed rocks. */
  const islandNav = async () => {
    const { placed } = await getRockBodies();
    return pool.runPacked<NavWorld>(slot(keys.islandNav), { kind: "islandNav", rocks: placed, world });
  };

  return {
    ...shared,
    bakeTreeViews: (meshes, sources, leafAtlas, budgetBytes) => pool.runUncached<BakedTreeViews>(
      { kind: "bakeTreeViews", budgetBytes, leafAtlas, meshes, sources }, "bake tree views"
    ),
    editRegion: async (request) => {
      // The mountain skin is empty (the terrain surface supplies it), so scheduling its workers
      // only copies the world and rebuilds the vertex fog: one main job is the whole rebuild.
      request = {
        ...request,
        groundZones: request.groundZones ?? peekGroundZoneField(world),
        revision: request.revision ?? getEditRevision(world),
        rockSkinDetail: request.rockSkinDetail ?? activeRockSkinDetail
      };
      return pool.runUrgent<RegionRebuild>(
        { kind: "editRegion", part: "main", request, world },
        "edit region"
      );
    },
    keepEditWorkers: pool.keepAlive,
    editedNav: (rocks, revision = getEditRevision(world)) =>
      pool.runUrgent<TaggedEditResult<NavWorld>>(
        { kind: "editedNav", revision, rocks, world },
        "edit animal nav"
      ),
    coverField: () => pool.runCached<CoverField>(slot(keys.coverField), { kind: "coverField", world }),
    fieldCover: (samples) =>
      pool.runCached<PropInstances>(slot(keys.fieldCover(samples)), {
        kind: "fieldCover",
        samples,
        world
      }),
    islandNav,
    islandRocks,
    springFlowers: (samples) =>
      pool.runCached<PropInstances>(slot(keys.springFlowers(samples)), { kind: "springFlowers", samples, world }),
    terrainChunks,
    waterField: () => pool.runCached<WaterField>(slot(keys.waterField), { kind: "waterField", world })
  };
};
