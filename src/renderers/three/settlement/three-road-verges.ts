import { BufferAttribute, BufferGeometry, type Camera, Group, InstancedBufferAttribute, InstancedMesh,
  type IUniform } from "three";

import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { createRoadVergeChunks, type RoadVergeChunks,
  vergeKeptCount } from "../../../render-common/road-verges/road-verge-chunks";
import { VERGE_KEEP_LEVELS } from "../../../render-common/road-verges/road-verge-density";
import { createRoadVergeFreeTest, type VergeBlockedRect } from "../../../render-common/road-verges/road-verge-free";
import { createRoadVergePlacements } from "../../../render-common/road-verges/road-verge-placement";
import { createVergePlantMesh, VERGE_SPECIES,
  type VergeDetail } from "../../../render-common/road-verges/verge-plant-geometry";
import type { RoadDecorationFrame } from "../../../shared/settlement/road-decoration-state";
import type { RoadSegment } from "../../../shared/settlement/road-types";
import { displayFogAt } from "../../../shared/world/fog-display";
import { FOG, type WorldData } from "../../../shared/world/world-data";
import type { DecorationFoliageMaterials } from "../plants/decoration-foliage-material";
import { createDecorationFoliageSource, type DecorationFoliageSource } from "../plants/decoration-foliage-source";
import { acquireVergeFoliageAtlas } from "../plants/verge-foliage-atlas";
import { createRoadVergeSelection, type RoadVergeBudget } from "./road-verge-selection";

/** What the verge layer reads from the settlement frame; only its revision/identity drives rebuilds. */
export interface RoadVergeFrame {
  buildings?: readonly { rotation: number; type: number; x: number; z: number }[];
  fields?: readonly { x: number; z: number }[];
  roadDecorations?: readonly Pick<RoadDecorationFrame, "supports" | "volumes">[];
  roadRevision?: number;
  roads?: readonly RoadSegment[];
}

export interface RoadVergeLayerOptions {
  antialias: boolean;
  budget: RoadVergeBudget;
  /** Low/Medium/High: the authored High parts near the camera; Minimal draws whole-plant cards only. */
  detailed: boolean;
  foliage?: DecorationFoliageSource;
  groundHeight: (x: number, z: number) => number;
  /** Water and ground that grows no meadow (sand, bare dirt, rock, snow): no verge plant there. */
  isBare: (x: number, z: number) => boolean;
  uniforms?: Record<string, IUniform>;
  world: WorldData;
}

const createPlantGeometry = (species: typeof VERGE_SPECIES[number], detail: VergeDetail) => {
  const mesh = createVergePlantMesh(species, detail), geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  return geometry;
};

/** Building plots (quarter-turn footprints), field sites and decoration supports as ground rectangles. */
const blockedRects = (frame: RoadVergeFrame): VergeBlockedRect[] => {
  const rects: VergeBlockedRect[] = [];
  for (const building of frame.buildings ?? []) {
    const [baseWidth, baseDepth] = getBuildingDefinition(building.type).gridFootprint;
    const turns = ((Math.round(building.rotation / (Math.PI / 2)) % 4) + 4) % 4;
    const width = turns % 2 ? baseDepth : baseWidth, depth = turns % 2 ? baseWidth : baseDepth;
    rects.push({ maxX: building.x + width / 2, maxZ: building.z + depth / 2, minX: building.x - width / 2,
      minZ: building.z - depth / 2 });
  }
  for (const field of frame.fields ?? [])
    rects.push({ maxX: field.x + .55, maxZ: field.z + .55, minX: field.x - .55, minZ: field.z - .55 });
  for (const decoration of frame.roadDecorations ?? []) {
    const volumes = decoration.supports.length ? decoration.supports : decoration.volumes;
    const floor = Math.min(...volumes.map(box => box.min[1]));
    for (const box of volumes) if (box.min[1] <= floor + .3)
      rects.push({ maxX: box.max[0], maxZ: box.max[2], minX: box.min[0], minZ: box.min[2] });
  }
  return rects;
};

/** FNV-style step over a value quantised to 1/64 unit (stable for unchanged obstacles). */
const mixHash = (hash: number, value: number) => Math.imul(hash ^ Math.round(value * 64), 16777619) >>> 0;

/** Cheap per-frame fingerprint of the obstacles (no allocation): rebuild only when it changes. */
const obstacleSignature = (frame: RoadVergeFrame, world: WorldData) => {
  let hash = mixHash(mixHash(mixHash(2166136261, frame.roadRevision ?? 0), world.terrainRevision ?? 0),
    world.fogRevision ?? 0);
  for (const building of frame.buildings ?? []) {
    hash = mixHash(mixHash(mixHash(mixHash(hash, building.x), building.z), building.type), building.rotation);
  }
  for (const field of frame.fields ?? []) hash = mixHash(mixHash(hash, field.x), field.z);
  return hash;
};

interface TierMeshes { far: InstancedMesh[]; near: InstancedMesh[] }

/**
 * Road verges (cards V-R01b, V-R02a): V-R01a placements drawn as instanced verge plants on the
 * shared decoration foliage material (D04b) with the verge atlas. One InstancedMesh per species and
 * tier; 8-unit chunks are culled and thinned by projected size, within per-preset plant budgets.
 * Instance buffers are refilled only when the drawn subset changes. Presentation only.
 */
export const createThreeRoadVerges = (options: RoadVergeLayerOptions) => {
  const { budget, detailed, groundHeight, world } = options;
  const root = new Group(); root.name = "road-verges";
  const foliage = options.foliage ?? createDecorationFoliageSource(
    { antialias: options.antialias, detailed, skyLit: true, uniforms: options.uniforms }, acquireVergeFoliageAtlas);
  const geometries = { far: VERGE_SPECIES.map(species => createPlantGeometry(species, "minimal")),
    near: detailed ? VERGE_SPECIES.map(species => createPlantGeometry(species, "high")) : [] };
  let materials: DecorationFoliageMaterials | undefined, meshes: TierMeshes | undefined;
  let data: RoadVergeChunks = createRoadVergeChunks([], groundHeight);
  let selection = createRoadVergeSelection(data, budget, detailed);
  let signature = Number.NaN, decorations: RoadVergeFrame["roadDecorations"], refill = false, disposed = false;

  const disposeMeshes = () => {
    for (const mesh of [...meshes?.far ?? [], ...meshes?.near ?? []]) { mesh.removeFromParent(); mesh.dispose(); }
    meshes = undefined;
  };
  const createMeshes = () => {
    disposeMeshes();
    if (!materials) return;
    const build = (tier: "far" | "near") => geometries[tier].map((geometry, kind) => {
      const capacity = Math.max(1, data.species[kind]!.ranks.length);
      const mesh = new InstancedMesh(geometry, materials!.material, capacity);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.customDepthMaterial = materials!.depth; mesh.frustumCulled = false; mesh.count = 0;
      mesh.name = `road-verge-${VERGE_SPECIES[kind]}-${tier}`; mesh.receiveShadow = detailed;
      root.add(mesh);
      return mesh;
    });
    meshes = { far: build("far"), near: build("near") };
    refill = true;
  };

  const fillTier = (tierMeshes: InstancedMesh[], tier: 1 | 2) => tierMeshes.forEach((mesh, kind) => {
    const source = data.species[kind]!, matrices = mesh.instanceMatrix.array as Float32Array;
    const colours = mesh.instanceColor!.array as Float32Array;
    let written = 0;
    data.chunks.forEach((chunk, index) => {
      if (selection.tiers[index] !== tier) return;
      const keep = vergeKeptCount(data, chunk, kind, VERGE_KEEP_LEVELS[selection.levels[index]!]!);
      const start = chunk.starts[kind]!;
      for (let value = 0; value < keep * 16; value += 1)
        matrices[written * 16 + value] = source.matrices[start * 16 + value]!;
      for (let value = 0; value < keep * 3; value += 1)
        colours[written * 3 + value] = source.colors[start * 3 + value]!;
      written += keep;
    });
    mesh.count = written;
    mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, written * 16);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.clearUpdateRanges(); mesh.instanceColor!.addUpdateRange(0, written * 3);
    mesh.instanceColor!.needsUpdate = true;
  });

  const rebuild = (frame: RoadVergeFrame) => {
    const isFree = createRoadVergeFreeTest({ blocked: blockedRects(frame), isBare: options.isBare,
      roads: frame.roads ?? [] });
    const visible = (x: number, z: number) =>
      displayFogAt(world, Math.floor(z) * world.cellsX + Math.floor(x)) !== FOG.hidden;
    const placements = createRoadVergePlacements(frame.roads ?? [], world,
      (x, z, band, reach) => visible(x, z) && isFree(x, z, band, reach));
    data = createRoadVergeChunks(placements, groundHeight);
    selection = createRoadVergeSelection(data, budget, detailed);
    createMeshes();
  };

  /** The meshes appear once the shared material is leased; a failed atlas load leaves no verge drawn. */
  const attachMaterials = async () => {
    const result = await foliage.acquire().catch(() => undefined);
    if (disposed || !result) return;
    materials = result; createMeshes();
  };
  void attachMaterials();

  const update = (frame: RoadVergeFrame, camera: Camera, viewportHeight: number) => {
    if (disposed) return;
    const next = obstacleSignature(frame, world);
    if (next !== signature || decorations !== frame.roadDecorations) {
      signature = next; decorations = frame.roadDecorations; rebuild(frame);
    }
    if (!meshes) return;
    if (refill) selection.invalidate();
    if (!selection.update(camera, viewportHeight) && !refill) return;
    refill = false;
    fillTier(meshes.far, 1); fillTier(meshes.near, 2);
  };

  const statistics = () => {
    const drawn = [...meshes?.far ?? [], ...meshes?.near ?? []].filter(mesh => mesh.count > 0);
    const plants = (tier: InstancedMesh[] = []) => tier.reduce((sum, mesh) => sum + mesh.count, 0);
    return { draws: drawn.length, far: plants(meshes?.far), near: plants(meshes?.near), placements: data.plants,
      ready: Boolean(meshes),
      triangles: drawn.reduce((sum, mesh) => sum + mesh.count * mesh.geometry.index!.count / 3, 0) };
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true; disposeMeshes();
    for (const geometry of [...geometries.far, ...geometries.near]) geometry.dispose();
    if (!options.foliage) foliage.dispose();
    root.removeFromParent();
  };

  return { dispose, root, statistics, update };
};
