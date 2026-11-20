import { type BakePass,bakeSpritePasses } from "../render-common/baker/prop-baker";
import { bakeTreeViews } from "../render-common/baker/tree-view-baker";
import type { TreeViewSource } from "../render-common/baker/tree-view-layout";
import { createVertexFog, type SurfaceMode } from "../render-common/chunk-sampling";
import {
  type BakeLeafAtlas,
  type BuildingSurfacePaint,
  buildTerrainChunks} from "../render-common/content-builders";
import { createFlyerAtlas } from "../render-common/flyers/flyer-atlas";
import { getLoadStages } from "../render-common/load-profile";
import { type EditRevision,getEditRevision } from "../render-common/map-edit/edit-revision";
import {
  buildEditedRegion,
  type RegionRebuildPart,
  type RegionRebuildRequest
} from "../render-common/map-edit/region-rebuild";
import { generateMaterialLayer } from "../render-common/materials/material-textures";
import { buildCoverField } from "../render-common/props/cover-field";
import { buildFieldCoverInstances } from "../render-common/props/field-cover";
import { loadBiomeGrassMeshPayload } from "../render-common/props/plants/biome-grass-mesh-loader";
import type { PropMesh } from "../render-common/props/mesh-builder";
import { createPropMeshes } from "../render-common/props/prop-meshes";
import { buildSpringFlowerInstances } from "../render-common/props/spring-flowers";
import { buildIslandRockBodies, buildIslandRockSkins } from "../render-common/rocks/island-rocks";
import type { RockInstance } from "../render-common/rocks/rock-instances";
import type { RockSkinDetail } from "../render-common/rocks/rock-skin";
import { createRockTexture } from "../render-common/rocks/rock-texture";
import { createFoliageAtlas } from "../render-common/trees/foliage-atlas";
import { loadHardwoodMeshPayload } from "../render-common/trees/hardwood-mesh-loader";
import { createWaterField } from "../render-common/water-field";
import { createIslandNav } from "../render-common/wildlife/nav/island-nav";
/** DOM and three.js free: the building surface recipes are plain samplers. */
import { paintBuildingSurface } from "../renderers/three/buildings/building-surface-paint";
import { findExpeditionWorld } from "../shared/settlement/colony-world-choice";
import type { ExpeditionIsland } from "../shared/settlement/settlement-colony-expeditions";
import { DEFAULT_EXPEDITION_RELIEF } from "../shared/world/generation/colony-world";
import { generateWorld, type WorldOptions } from "../shared/world/generation/generate-world";
import { getWorldTransferables, type WorldData } from "../shared/world/world-data";

export type WorkerRequest =
  | { kind: "world"; options: WorldOptions }
  | { kind: "material"; material: number; seed: number; size: number }
  | { kind: "foliage"; seed: number }
  | { kind: "flyerAtlas" }
  | { kind: "rock"; seed: number }
  | { kind: "islandNav"; rocks: RockInstance[]; world: WorldData }
  | { kind: "editedNav"; revision: EditRevision; rocks: RockInstance[]; world: WorldData }
  | { kind: "propMeshes"; seed: number }
  | { kind: "rockBodies"; world: WorldData }
  | { kind: "rockSkins"; detail?: RockSkinDetail; part: number; parts: number; world: WorldData }
  | { kind: "coverField"; world: WorldData }
  | { kind: "fieldCover"; samples: number; world: WorldData }
  | { kind: "springFlowers"; samples: number; world: WorldData }
  | { kind: "terrainChunks"; mode: SurfaceMode; part: number; parts: number; world: WorldData }
  | { kind: "waterField"; world: WorldData }
  | {
      kind: "editRegion";
      part: RegionRebuildPart;
      request: RegionRebuildRequest;
      world: WorldData;
    }
  | { kind: "bakeSprites"; leafAtlas: BakeLeafAtlas; meshes: PropMesh[]; passes: BakePass[] }
  | {
      kind: "bakeTreeViews";
      budgetBytes: number;
      leafAtlas: BakeLeafAtlas;
      meshes: PropMesh[];
      sources: TreeViewSource[];
    }
  | { kind: "buildingSurface"; paint: BuildingSurfacePaint }
  | { kind: "islandWorld"; island: ExpeditionIsland };

type RequestOf<Kind extends WorkerRequest["kind"]> = Extract<WorkerRequest, { kind: Kind }>;

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Every distinct buffer under a result (typed arrays in objects and arrays): moved, not copied. */
const collectBuffers = (value: unknown, found = new Set<ArrayBuffer>()) => {
  if (ArrayBuffer.isView(value)) found.add(value.buffer as ArrayBuffer);
  else if (Array.isArray(value)) value.forEach((item) => collectBuffers(item, found));
  else if (value && typeof value === "object")
    Object.values(value).forEach((item) => collectBuffers(item, found));
  return found;
};

const HANDLERS: { [Kind in WorkerRequest["kind"]]: (request: RequestOf<Kind>) => unknown } = {
  bakeSprites: ({ leafAtlas, meshes, passes }) => bakeSpritePasses(meshes, leafAtlas, passes),
  bakeTreeViews: ({ budgetBytes, leafAtlas, meshes, sources }) =>
    bakeTreeViews(meshes, sources, leafAtlas, budgetBytes),
  buildingSurface: ({ paint }) => paintBuildingSurface(paint),
  coverField: ({ world }) => buildCoverField(world),
  editRegion: ({ part, request, world }) => buildEditedRegion(world, request, part),
  editedNav: ({ rocks, world }) => ({
    revision: getEditRevision(world),
    value: createIslandNav(world, rocks)
  }),
  fieldCover: ({ samples, world }) =>
    buildFieldCoverInstances(world, createVertexFog(world), samples),
  flyerAtlas: () => createFlyerAtlas(),
  springFlowers: ({ samples, world }) =>
    buildSpringFlowerInstances(world, createVertexFog(world), samples),
  foliage: ({ seed }) => createFoliageAtlas(seed),
  islandNav: ({ rocks, world }) => createIslandNav(world, rocks),
  islandWorld: ({ island }) => findExpeditionWorld(island, DEFAULT_EXPEDITION_RELIEF),
  material: ({ material, seed, size }) => generateMaterialLayer(material, size, seed),
  propMeshes: ({ seed }) => createPropMeshes(seed),
  rock: ({ seed }) => createRockTexture(seed),
  rockBodies: ({ world }) => buildIslandRockBodies(world, createVertexFog(world)),
  rockSkins: ({ detail, part, parts, world }) =>
    buildIslandRockSkins(world, createVertexFog(world), part, parts, undefined, detail),
  terrainChunks: ({ mode, part, parts, world }) =>
    buildTerrainChunks(world, createVertexFog(world), mode, part, parts),
  waterField: ({ world }) => createWaterField(world, createVertexFog(world)),
  world: ({ options }) => generateWorld(options)
};

/** A world moves its own buffers (getWorldTransferables); an island without a world has none. */
const isWorldResult = (kind: WorkerRequest["kind"], result: unknown) =>
  (kind === "world" || kind === "islandWorld") && result !== null;

const getTransferables = (kind: WorkerRequest["kind"], result: unknown) =>
  isWorldResult(kind, result) ? getWorldTransferables(result as WorldData) : [...collectBuffers(result)];

/**
 * Runs one request and posts its result (buffers transferred) with the worker-side compute
 * time and the sub-stages it profiled (load profile).
 */
const handleRequest = (request: WorkerRequest) => {
  const startedAt = performance.now();
  const firstStage = getLoadStages().length;
  const handler = HANDLERS[request.kind] as (request: WorkerRequest) => unknown;
  const result = handler(request);
  scope.postMessage(
    {
      ms: performance.now() - startedAt,
      origin: performance.timeOrigin,
      result,
      stages: getLoadStages().slice(firstStage)
    },
    getTransferables(request.kind, result)
  );
};

/** Data a request needs before it runs, fetched once per worker (tree and biome-grass vertex payloads). */
const PRELOADS: Partial<Record<WorkerRequest["kind"], () => Promise<void>>> = {
  propMeshes: async () => {
    await Promise.all([loadHardwoodMeshPayload(), loadBiomeGrassMeshPayload()]);
  }
};

const runRequest = (request: WorkerRequest) => {
  try { handleRequest(request); }
  catch (error) {
    // An exhausted layout search is an expected refusal, not a crashed worker pool.
    if (request.kind !== "world" || !(error instanceof Error) ||
      !error.message.startsWith("Could not create valid islands")) throw error;
    scope.postMessage({ error: error.message, result: null, ms: 0, origin: performance.timeOrigin, stages: [] });
  }
};

/** A failed preload or a throw after it reaches the pool as a worker error, like a synchronous throw. */
const raiseWorkerError = (error: unknown) => setTimeout(() => { throw error; });

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const preload = PRELOADS[request.kind];
  if (!preload) return runRequest(request);
  preload().then(() => runRequest(request)).catch(raiseWorkerError);
};
