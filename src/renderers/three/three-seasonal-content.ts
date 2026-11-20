import type { IUniform } from "three";

import type { ContentBuilders } from "../../render-common/content-builders";
import { ADVENTURE_PROP } from "../../render-common/props/adventure-prop-kinds";
import { getTreeSpecies } from "../../render-common/props/island-trees";
import type { PropMesh } from "../../render-common/props/mesh-builder";
import { allocatePropInstances, type PropInstances } from "../../render-common/props/prop-instances";
import { COVER, getMeshKind } from "../../render-common/props/prop-meshes";
import { getWinterPropMesh, type WinterPropKind } from "../../render-common/seasonal-appearance/winter-props";
import { getWinterTerrainChunk } from "../../render-common/seasonal-appearance/winter-terrain";
import type { ChunkVertexData } from "../../render-common/terrain-chunks";
import { PROP } from "../../shared/world/world-data";

const SHRUB_KINDS = new Set<number>([
  ADVENTURE_PROP.cactus, PROP.berryBush, PROP.broadleafShrub, PROP.bush, PROP.fieldShrub,
  PROP.riverShrub, PROP.sapling, PROP.willowShrub
]);
const GRASS_KINDS = new Set<number>([
  COVER.clover, COVER.dryTuft, COVER.fieldWeed, COVER.forestGrass, COVER.jungleGrass, COVER.pinkFlower,
  COVER.savannaGrass, COVER.seedGrass, COVER.shortGrass, COVER.tallGrass, COVER.thistle,
  COVER.whiteFlower, COVER.yellowFlower,
  PROP.cattail, PROP.fern, PROP.flowers, PROP.mushrooms, PROP.reeds, PROP.sedge
]);
const STONE_KINDS = new Set<number>([PROP.largeRock, PROP.pebbles, PROP.smallRock]);

/** An explicit allowlist keeps aquatic props, shells and future gameplay content in their original form. */
export const getSeasonalPropKind = (kind: number): WinterPropKind | undefined => {
  if (getTreeSpecies(kind) || kind === ADVENTURE_PROP.sparseOak || kind === ADVENTURE_PROP.sparseBirch)
    return "tree";
  if (SHRUB_KINDS.has(kind)) return "shrub";
  if (GRASS_KINDS.has(kind)) return "grass";
  if (STONE_KINDS.has(kind)) return "stone";
  return undefined;
};

const meshTables = new WeakMap<PropMesh[], PropMesh[]>();
const terrainTables = new WeakMap<ChunkVertexData[], ChunkVertexData[]>();
const fieldCoverTables = new WeakMap<PropInstances, PropInstances>();

/** Bakes of prepainted meshes must never reuse the canonical foliage sprite atlas cache entry. */
export const getSeasonalImpostorName = (visualWinter: boolean) => {
  const name = "impostors-foliage-v3-junction-foliage";
  if (!visualWinter) return name;
  return `${name}-global-winter-v2-dry-cover`;
};

/** Cached CPU-only variants retain all canonical positions, dimensions and gameplay source meshes. */
export const getSeasonalPropMeshes = (source: PropMesh[]) => {
  const cached = meshTables.get(source);
  if (cached) return cached;
  const meshes = source.map((mesh, meshId) => {
    const kind = getSeasonalPropKind(getMeshKind(meshId));
    if (!kind) return mesh;
    return getWinterPropMesh(mesh, kind);
  });
  meshTables.set(source, meshes);
  return meshes;
};

/**
 * Chance that a natural tuft stays visible in winter (owner 2026-11-07: one third of the grass).
 * Stiff tall stems poke through the snow; soft blades mostly lie flat; flowers are gone. On real
 * islands short grass is ~80 % of the cover, so these shares keep about one third overall. Other
 * cover (shells, sea stars) is not grass and always stays.
 */
const WINTER_KEEP_CHANCE: Partial<Record<number, number>> = {
  [COVER.dryTuft]: 0.8,
  [COVER.forestGrass]: 0.32,
  [COVER.jungleGrass]: 0.18,
  [COVER.savannaGrass]: 0.82,
  [COVER.seedGrass]: 0.8,
  [COVER.tallGrass]: 0.8,
  [COVER.thistle]: 0.8,
  [COVER.clover]: 0.28,
  [COVER.fieldWeed]: 0.28,
  [COVER.shortGrass]: 0.28,
  [COVER.pinkFlower]: 0,
  [COVER.whiteFlower]: 0,
  [COVER.yellowFlower]: 0
};
const SCALAR_FIELDS = [
  "fog", "meshIds", "phase", "rotation", "scale", "sourceIndex", "stretch", "sunVisibility", "x", "y", "z"
] as const;

/** Stable 0..1 hash of a tuft position: map-editor chunk rebuilds keep the same survivors. */
const hashPosition = (x: number, z: number) => {
  let hash = (Math.imul(Math.round(x * 64), 0x27d4eb2d) ^ Math.imul(Math.round(z * 64), 0x165667b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) >>> 0;
  return ((hash ^ (hash >>> 13)) >>> 0) / 4294967296;
};

const survivesWinter = (source: PropInstances, index: number) => {
  const chance = WINTER_KEEP_CHANCE[getMeshKind(source.meshIds[index]!)] ?? 1;
  return hashPosition(source.x[index]!, source.z[index]!) < chance;
};

const getTintBrightness = (tint: Float32Array, index: number) =>
  tint[index * 3]! * 0.3 + tint[index * 3 + 1]! * 0.59 + tint[index * 3 + 2]! * 0.11;

/**
 * Winter field cover: about one third of the natural tufts stays, in the original far-to-near
 * order, tinted to the ground brightness so prepainted snow is not tinted green. Cached per source.
 */
export const getSeasonalFieldCoverInstances = (source: PropInstances) => {
  const cached = fieldCoverTables.get(source);
  if (cached) return cached;
  const survivors: number[] = [];
  for (let index = 0; index < source.count; index++) if (survivesWinter(source, index)) survivors.push(index);
  const instances = allocatePropInstances(survivors.length);
  survivors.forEach((from, to) => {
    for (const key of SCALAR_FIELDS) instances[key][to] = source[key][from]!;
    instances.tint.fill(getTintBrightness(source.tint, from), to * 3, to * 3 + 3);
  });
  fieldCoverTables.set(source, instances);
  return instances;
};

const getSeasonalTerrainChunks = (source: ChunkVertexData[]) => {
  const cached = terrainTables.get(source);
  if (cached) return cached;
  const chunks = source.map(getWinterTerrainChunk);
  terrainTables.set(source, chunks);
  return chunks;
};

/**
 * Only the renderer sees converted CPU assets. Workers, saves and shared builder caches keep their
 * canonical results; water, rocks, buildings, collision and simulation receive the original data.
 */
export const createSeasonalContentBuilders = (builders: ContentBuilders, visualWinter: boolean): ContentBuilders => {
  if (!visualWinter) return builders;
  return {
    ...builders,
    fieldCover: async samples => getSeasonalFieldCoverInstances(await builders.fieldCover(samples)),
    propMeshes: async seed => getSeasonalPropMeshes(await builders.propMeshes(seed)),
    terrainChunks: async mode => {
      const chunks = await builders.terrainChunks(mode);
      if (mode !== "terrain") return chunks;
      return getSeasonalTerrainChunks(chunks);
    }
  };
};

/** Globally prepainted props use the existing summer shader; native rock and weather snow stays shared. */
export const getSeasonalVegetationUniforms = (uniforms: Record<string, IUniform>, visualWinter: boolean) => {
  if (!visualWinter) return uniforms;
  return { ...uniforms, uSnowMap: { value: null } };
};
