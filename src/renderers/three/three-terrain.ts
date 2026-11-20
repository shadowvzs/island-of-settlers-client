import { BufferAttribute, BufferGeometry, type Camera, Frustum, Group, type Material, Matrix4, Mesh } from "three";

import type { RebuiltChunk } from "../../render-common/map-edit/region-rebuild";
import {
  buildOceanFrame,
  type ChunkKey,
  type ChunkVertexData
} from "../../render-common/terrain-chunks";
import { buildTerrainLodIndices } from "../../render-common/terrain-lod";
import type { WorldData } from "../../shared/world/world-data";

const OCEAN_MARGIN = 400;

/** `ground`: the terrain surface, which also carries the surface mask (the water mesh never reads it). */
const createChunkGeometry = (data: ChunkVertexData, ground: boolean) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
  geometry.setAttribute("splatA", new BufferAttribute(data.splatA, 4, true));
  geometry.setAttribute("splatB", new BufferAttribute(data.splatB, 4, true));
  geometry.setAttribute("splatC", new BufferAttribute(data.splatC, 4, true));
  geometry.setAttribute("shading", new BufferAttribute(data.shading, 4, true));
  if (ground) {
    geometry.setAttribute("surface", new BufferAttribute(data.surface, 4, true));
    geometry.setAttribute("theme", new BufferAttribute(data.theme, 4, true));
    geometry.setAttribute("variant", new BufferAttribute(data.variant, 4, true));
    geometry.setAttribute("litter", new BufferAttribute(data.litter, 4, true));
  }
  geometry.setAttribute("water", new BufferAttribute(data.water, 4));
  geometry.setIndex(new BufferAttribute(data.indices.slice(), 1));
  geometry.computeBoundingSphere();
  return geometry;
};

/**
 * The open sea around the map: no flow, and the water material reads depth, coast and fog from
 * the clamped water field, so it shades like the in-map sea at the border.
 */
const createOceanGeometry = (world: WorldData) => {
  const { indices, positions } = buildOceanFrame(world, OCEAN_MARGIN);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute(
    "water",
    new BufferAttribute(new Float32Array((positions.length / 3) * 4), 4)
  );
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
};

const toChunkKey = ({ chunkX, chunkZ }: ChunkKey) => `${chunkX},${chunkZ}`;

/** True when any vertex of a ground chunk sits under water (the refraction pass keeps it). */
export const groundChunkHasWater = (water: ArrayLike<number>) => {
  for (let index = 0; index < water.length; index += 4) if (water[index]! > 0) return true;
  return false;
};

/** Attributes a ground edit changes (the vertices stay where they are). */
const GROUND_ATTRIBUTES = [
  "splatA", "splatB", "splatC", "shading", "surface", "theme", "variant", "litter"
] as const;

/**
 * One surface's chunk meshes by chunk key, in their group with their material; `isGround` (the terrain
 * surface) adds the LOD levels and the surface mask.
 */
const createChunkLayer = (
  group: Group, chunks: ChunkVertexData[], material: Material, isGround = false
) => {
  const levels = new Map<Mesh, { applied?: boolean; full: Uint16Array; coarse?: Uint16Array; source: ChunkVertexData }>();
  const pending = new Set<Mesh>();
  let coarse = false;
  const applyLod = (mesh: Mesh, indices: Uint16Array, applied?: boolean) => {
    const attribute = mesh.geometry.getIndex()!;
    (attribute.array as Uint16Array).set(indices);
    attribute.needsUpdate = true;
    mesh.geometry.setDrawRange(0, indices.length);
    const level = levels.get(mesh);
    if (level && applied !== undefined) level.applied = applied;
  };
  const registerLod = (mesh: Mesh, data: ChunkVertexData) => {
    if (!isGround) return;
    const full = data.indices.slice();
    levels.set(mesh, { full, source: data });
    pending.add(mesh);
  };
  const meshes = new Map<string, Mesh>();
  const wet = new Map<Mesh, boolean>();
  let triangles = 0;
  for (const data of chunks) {
    const mesh = new Mesh(createChunkGeometry(data, isGround), material);
    group.add(mesh);
    registerLod(mesh, data);
    meshes.set(toChunkKey(data), mesh);
    wet.set(mesh, groundChunkHasWater(data.water));
    triangles += data.indices.length / 3;
  }
  /** A rebuilt chunk: new geometry, a new mesh, or none any more (a water chunk run dry). */
  const replace = (key: ChunkKey, data: ChunkVertexData | null) => {
    const mesh = meshes.get(toChunkKey(key));
    mesh?.geometry.dispose();
    if (mesh && data) {
      mesh.geometry = createChunkGeometry(data, isGround);
      registerLod(mesh, data);
      wet.set(mesh, groundChunkHasWater(data.water));
    }
    if (mesh && !data) {
      levels.delete(mesh);
      pending.delete(mesh);
      wet.delete(mesh);
      mesh.removeFromParent();
      meshes.delete(toChunkKey(key));
    }
    if (mesh || !data) return;
    const added = new Mesh(createChunkGeometry(data, isGround), material);
    group.add(added);
    registerLod(added, data);
    meshes.set(toChunkKey(key), added);
    wet.set(added, groundChunkHasWater(data.water));
  };
  /** Refraction: hide dry ground chunks; the restore touches only the meshes hidden here. */
  const hideWaterless = () => {
    const hidden: Mesh[] = [];
    for (const [mesh, isWet] of wet) {
      if (isWet || !mesh.visible) continue;
      mesh.visible = false;
      hidden.push(mesh);
    }
    return () => {
      for (const mesh of hidden) mesh.visible = true;
    };
  };
  const farFromEye = (mesh: Mesh, eye: { x: number; z: number }, distance: number) => {
    const sphere = mesh.geometry.boundingSphere;
    if (!sphere) return false;
    const dx = sphere.center.x - eye.x;
    const dz = sphere.center.z - eye.z;
    return Math.max(0, Math.hypot(dx, dz) - sphere.radius) > distance;
  };
  const buildPending = (max = 4) => {
    if (!pending.size) return;
    // Close views/editor strokes need no simplification. At distance, amortize fresh LOD work
    // across frames; complete geometry stays visible until its conservative replacement is ready.
    const deadline = performance.now() + 2;
    let rebuilt = 0;
    for (const mesh of pending) {
      const level = levels.get(mesh)!;
      level.coarse = buildTerrainLodIndices(level.source);
      if (level.coarse) applyLod(mesh, level.coarse, true);
      pending.delete(mesh);
      if (++rebuilt >= max || performance.now() >= deadline) break;
    }
  };
  const updateLod = (
    zoom: number,
    isIsoView: boolean,
    eye?: { x: number; z: number },
    distance = 55
  ) => {
    if (isIsoView) {
      const next = zoom < (coarse ? .68 : .58);
      if (next !== coarse) {
        coarse = next;
        levels.forEach((level, mesh) => {
          const useCoarse = coarse && level.coarse;
          if (level.applied === Boolean(useCoarse)) return;
          applyLod(mesh, useCoarse ? level.coarse! : level.full, Boolean(useCoarse));
        });
      }
      if (coarse) buildPending();
      return;
    }
    if (!eye) {
      levels.forEach((level, mesh) => applyLod(mesh, level.full));
      return;
    }
    levels.forEach((level, mesh) => {
      const far = farFromEye(mesh, eye, distance);
      if (far && !level.coarse) {
        pending.add(mesh);
        return;
      }
      if (level.applied === far) return;
      applyLod(mesh, far ? level.coarse! : level.full, far);
    });
    buildPending();
  };
  const refreshLod = (key: ChunkKey, data: ChunkVertexData) => {
    const mesh = meshes.get(toChunkKey(key));
    if (!mesh || !isGround) return;
    const level = levels.get(mesh);
    if (!level) return;
    level.source = data;
    level.coarse = undefined;
    level.applied = undefined;
    pending.add(mesh);
    if (coarse) applyLod(mesh, level.full, false);
  };
  return { hideWaterless, meshes, replace, refreshLod, triangles, updateLod };
};

/**
 * Real 3D: ground chunks on the true heights; the water surface chunks and the ocean frame sit in
 * their own group, so the ground alone can be rendered for refraction.
 */
export const createThreeTerrain = (
  world: WorldData,
  chunks: { terrain: ChunkVertexData[]; water: ChunkVertexData[] },
  terrainMaterial: Material,
  waterMaterial: Material
) => {
  const ground = new Group();
  const water = new Group();
  const groundData = new Map(chunks.terrain.map(data => [toChunkKey(data), data]));
  const groundLayer = createChunkLayer(ground, chunks.terrain, terrainMaterial, true);
  const waterLayer = createChunkLayer(water, chunks.water, waterMaterial);
  water.add(new Mesh(createOceanGeometry(world), waterMaterial));
  /** Map editor: new ground of a chunk (splat, ore, canopy shade). */
  const setChunkGround = (data: ChunkVertexData) => {
    const geometry = groundLayer.meshes.get(toChunkKey(data))?.geometry;
    if (!geometry) return;
    for (const name of GROUND_ATTRIBUTES) {
      const attribute = geometry.getAttribute(name) as BufferAttribute;
      (attribute.array as Uint8Array).set(data[name]);
      attribute.needsUpdate = true;
    }
    const current = groundData.get(toChunkKey(data));
    if (current) {
      for (const name of GROUND_ATTRIBUTES) current[name].set(data[name]);
      // Re-evaluate material boundaries after painting, ore changes or fog updates.
      groundLayer.refreshLod(data, current);
    }
  };
  /** Map editor: a rebuilt chunk of the ground or the water surface (terrain edits). */
  const setTerrainChunk = ({ data, key, mode }: RebuiltChunk) => {
    if (mode === "terrain") {
      if (data) groundData.set(toChunkKey(key), data);
      else groundData.delete(toChunkKey(key));
    }
    (mode === "water" ? waterLayer : groundLayer).replace(key, data);
  };
  const frustum = new Frustum(), projectionView = new Matrix4();
  /** Occluded water needs no refraction capture; the ocean frame counts as water. */
  const hasVisibleWater = (camera: Camera) => {
    projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projectionView);
    return water.children.some(child => child.visible && frustum.intersectsObject(child));
  };
  return {
    ground,
    hasVisibleWater,
    hideWaterlessGround: groundLayer.hideWaterless,
    meshes: ground.children.length + water.children.length,
    setChunkGround,
    setTerrainChunk,
    updateLod: groundLayer.updateLod,
    triangles: groundLayer.triangles + waterLayer.triangles,
    water
  };
};
