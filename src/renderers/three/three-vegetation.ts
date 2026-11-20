import {
  type Camera,
  DataTexture,
  type Frustum,
  type IUniform,
  NearestFilter,
  RGFormat,
  UnsignedByteType,
  type Vector4
} from "three";

import { createVertexFog } from "../../render-common/chunk-sampling";
import type { ContentBuilders } from "../../render-common/content-builders";
import type { FellingFrame } from "../../render-common/felling/felling-simulation";
import type { GrowthFrame } from "../../render-common/growth/tree-growth";
import { profileStep } from "../../render-common/load-profile";
import type { PropMesh } from "../../render-common/props/mesh-builder";
import {
  buildPropInstances, getPropInstanceHeight, type PropInstances
} from "../../render-common/props/prop-instances";
import { PROP_MESH_SEED } from "../../render-common/props/prop-mesh-seed";
import { COVER, getMeshKind } from "../../render-common/props/prop-meshes";
import { createTreeLookup } from "../../render-common/props/tree-lookup";
import type { TreeViewImpostors } from "../../render-common/quality";
import type { RendererPrefetch } from "../../render-common/renderer-contract";
import { getSeasonClass } from "../../render-common/seasonal-appearance/season-palettes";
import { CHUNK_CELLS, type ChunkKey } from "../../render-common/terrain-chunks";
import type { PaintedTexture } from "../../render-common/trees/atlas-canvas";
import type { CellRegion } from "../../shared/world/grid-geometry";
import { PROP_REMOVED, type WorldData } from "../../shared/world/world-data";
import { getGrassRange } from "./grass-range";
import type { LayerWarmup } from "./impostor-warmup";
import { createSeasonalPropMaterials, needsBareWoodDetail } from "./seasonal-prop-materials";
import { createContactShadows } from "./three-contact-shadows";
import { createDeferredImpostors } from "./three-deferred-impostors";
import { createThreeFelling } from "./three-felling";
import { createThreeGrowth, getMatureCapacities } from "./three-growth";
import { isImpostorKind } from "./three-impostors";
import { createThreePlacedProps } from "./three-placed-props";
import { createPropMaterial } from "./three-prop-materials";
import { type ChunkedPropMesh,createThreePropMeshes, groupByMesh } from "./three-props";
import { createSeasonExtras } from "./three-season-extras";
import { getSeasonalFieldCoverInstances, getSeasonalImpostorName } from "./three-seasonal-content";
import { SHADOW_NEAR_CASTER_LAYER } from "./three-shadows";
import { createTreeViewLayer } from "./three-tree-view-layer";
import { reportTreeViewsDrawn, treeViewsEnabled } from "./tree-view-mode";
import {
  type DistanceVisibility,
  refreshDistanceVisibility,
  refreshImpostorMasks,
  refreshShadowCasters,
  refreshVisibleChunks,
  showsSpriteLodMeshes
} from "./three-vegetation-visibility";
import { createChunkVisibility, CULL_CHUNK_CELLS, listCullChunks } from "./three-visibility";

/** Prop meshes are world independent: requested while the island is generated. */
export const prefetchThreeVegetation = ({ builders }: RendererPrefetch) => {
  void builders.propMeshes(PROP_MESH_SEED);
};

/** Impostors exist for trees and world plants: bake just those (sparse, keeps the mesh ids). */
const keepImpostorMeshes = (meshes: PropMesh[]) => {
  const kept: PropMesh[] = [];
  meshes.forEach((mesh, meshId) => {
    if (isImpostorKind(getMeshKind(meshId))) kept[meshId] = mesh;
  });
  return kept;
};

/** Conservative crown height for shadow-caster chunk boxes (ordinary prop culling uses 12). */
const SHADOW_CASTER_MAX_Y = 26;

const applyGrassRange = (
  materials: readonly ReturnType<typeof createPropMaterial>[],
  eye: { x: number; z: number } | undefined,
  grassDistance: number | undefined
) => {
  const range = getGrassRange(eye, eye ? grassDistance : undefined);
  for (const material of materials) material.uniforms.uGrassRange!.value.set(range.x, range.z, range.start, range.end);
  return range;
};

/**
 * Chunk culled field cover. OD-T6: the short-grass tufts get their own material (same program, own
 * uniforms), so only they leave room for the possessed grass ring's thin blades; flowers, clover,
 * weeds and the other grasses keep the shared field-cover material.
 */
const createFieldCoverMeshes = (
  meshes: PropMesh[],
  instances: PropInstances,
  cellsX: number,
  uniforms: Record<string, IUniform>
) => {
  const grassMaterial = createPropMaterial(uniforms, true);
  const shortGrassMaterial = createPropMaterial(uniforms, true);
  const grass = createThreePropMeshes(meshes, instances, cellsX, { depth: null, main: grassMaterial });
  for (const prop of grass) if (prop.kind === COVER.shortGrass) prop.mesh.material = shortGrassMaterial;
  return { grass, grassMaterials: [grassMaterial, shortGrassMaterial], shortGrassMaterial };
};

export interface VegetationFrame {
  camera: Camera;
  /** Spring meadow flowers' fade (the grass fade even where a preset draws no field cover). */
  flowerFade: number;
  /** View focus (cells) and frame time of the seasonal falling leaves. */
  leafFocus: { time: number; x: number; z: number };
  felling: FellingFrame;
  growth: GrowthFrame;
  grassVisible: boolean;
  /** Optional FPS eye position for per-chunk distance culling; iso omits it. */
  eyePosition?: { x: number; z: number };
  /** Grass fades out beyond this eye distance; undefined keeps the existing visibility. */
  grassDistance?: number;
  /** Small plants/bushes fade beyond this eye distance. */
  plantDistance?: number;
  /** The fitted sun light camera's frustum: near chunks outside the main view must still cast. */
  shadowFrustum?: Frustum | null;
  /** Trees switch to the existing baked impostor layer beyond this eye distance. */
  treeDistance?: number;
  /** Plant LOD: full stems and foliage when close, the simplified plants further out. */
  plantDetail: boolean;
  useImpostors: boolean;
}

/**
 * All Three.js vegetation: chunk culled instanced props (3D trees with leaves, plants with
 * stems, rocks) with a plant LOD, chunk culled field cover, plant contact shadows, baked
 * impostors that replace trees and plants at far zoom, and the felling layer (trees being
 * chopped, stumps, falling leaves).
 */
export const createThreeVegetation = async (
  world: WorldData,
  uniforms: Record<string, IUniform>,
  foliageAtlas: PaintedTexture,
  content: {
    builders: ContentBuilders;
    /** The impostor bake starts once the first frame is drawn (far zoom only needs it). */
    firstFrame: Promise<void>;
    grass: Promise<PropInstances>;
    /** Uploads and links the far-zoom impostors in leftover frame time before they show. */
    impostorWarmup?: LayerWarmup;
    /** R15a view atlas memory budget (MiB) of the preset. */
    treeViewAtlasMiB?: number;
    /** R15a possessed far trees as hemispherical view impostors ("off" keeps the iso sprites). */
    treeViews?: TreeViewImpostors;
    /** Seasonal falling leaves pool (getSeasonLeafCapacity); 0 or unset (Minimal): none. */
    seasonalLeafCapacity?: number;
    /** Spring meadow flower samples per cell (getSpringFlowerSamples); 0 or unset: no spring flowers. */
    springFlowerSamples?: number;
    /** Prepared CPU assets replace the native per-fragment winter path for this vegetation. */
    visualWinter?: boolean;
  }
) => {
  const fog = createVertexFog(world);
  const meshes = await content.builders.propMeshes(PROP_MESH_SEED);
  const leafAtlas = { normalPixels: foliageAtlas.normal, pixels: foliageAtlas.color, size: foliageAtlas.width };
  const bake = content.firstFrame.then(() =>
    content.builders.bakeSprites(getSeasonalImpostorName(content.visualWinter === true), keepImpostorMeshes(meshes),
      leafAtlas)
  );
  const propInstances = profileStep("prop instances", () => buildPropInstances(world, fog));
  const chunksX = Math.ceil(world.cellsX / CULL_CHUNK_CELLS);
  const chunksZ = Math.ceil(world.cellsZ / CULL_CHUNK_CELLS);
  const chunkMaskPixels = new Uint8Array(chunksX * chunksZ * 2);
  chunkMaskPixels.fill(255);
  const chunkMask = new DataTexture(chunkMaskPixels, chunksX, chunksZ, RGFormat, UnsignedByteType);
  chunkMask.minFilter = NearestFilter;
  chunkMask.magFilter = NearestFilter;
  chunkMask.needsUpdate = true;
  /** The depth-only sprite mask may cover off-view sunward chunks that the colour mask does not. */
  const casterMaskPixels = new Uint8Array(chunksX * chunksZ * 2);
  const casterMask = new DataTexture(casterMaskPixels, chunksX, chunksZ, RGFormat, UnsignedByteType);
  casterMask.minFilter = NearestFilter;
  casterMask.magFilter = NearestFilter;
  casterMask.needsUpdate = true;
  const propMaterials = createSeasonalPropMaterials(uniforms);
  const props = profileStep("three prop instanced meshes", () =>
    createThreePropMeshes(
      meshes,
      propInstances,
      world.cellsX,
      propMaterials.forKind,
      getMatureCapacities(propInstances)
    )
  );
  const isPresent = (sourceIndex: number) => world.props.types[sourceIndex] !== PROP_REMOVED;
  const impostors = createDeferredImpostors(bake, propInstances, uniforms, isPresent,
    { chunkMask, chunksX, warmup: content.impostorWarmup });
  const treeViews = content.treeViews && content.treeViews !== "off"
    ? createTreeViewLayer(propInstances, uniforms, {
      budgetBytes: (content.treeViewAtlasMiB ?? 0) * 1024 * 1024,
      builders: content.builders,
      chunksX,
      chunksZ,
      elevationBlend: content.treeViews === "full",
      isPresent,
      leafAtlas,
      meshes,
      warmup: content.impostorWarmup
    })
    : null;
  /** Far tree layers that follow felling, growth and editor edits. */
  const farTrees = treeViews ? [impostors, treeViews] : [impostors];
  const grassInstances = await content.grass;
  const { grass, grassMaterials, shortGrassMaterial } = profileStep("three field cover meshes", () =>
    createFieldCoverMeshes(meshes, grassInstances, world.cellsX, uniforms));
  const setStaticVisible = (sourceIndex: number, visible: boolean) => {
    visible = visible && world.props.types[sourceIndex] !== PROP_REMOVED;
    props.some((prop) =>
      visible ? prop.showInstance(sourceIndex) : prop.hideInstance(sourceIndex)
    );
    for (const layer of farTrees) layer.setTreeVisible(sourceIndex, visible);
  };
  const propsByMeshId = new Map(props.map((prop) => [prop.meshId, prop]));
  /** Moves a world tree to another static mesh (grown mature or back to its world variant). */
  const setStaticMesh = (index: number, meshId: number) => {
    const sourceIndex = propInstances.sourceIndex[index]!;
    if (world.props.types[sourceIndex] === PROP_REMOVED) {
      setStaticVisible(sourceIndex, false);
      return;
    }
    propsByMeshId.get(propInstances.meshIds[index]!)?.removeInstance(sourceIndex);
    propInstances.meshIds[index] = meshId;
    propsByMeshId.get(meshId)?.addInstance(index);
    for (const layer of farTrees) {
      layer.refreshTree(sourceIndex);
      layer.setTreeVisible(sourceIndex, true);
    }
  };
  const trees = createTreeLookup(propInstances);
  const felling = profileStep("three felling", () =>
    createThreeFelling(uniforms, {
      hideStatic: (sourceIndex) => setStaticVisible(sourceIndex, false),
      meshes,
      treeKinds: impostors.treeKinds,
      trees,
      visualWinter: content.visualWinter
    })
  );
  const growth = profileStep("three growth (stage meshes)", () =>
    createThreeGrowth(uniforms, {
      instances: propInstances,
      meshes,
      seed: PROP_MESH_SEED,
      setStaticMesh,
      setStaticVisible,
      trees,
      visualWinter: content.visualWinter
    })
  );
  const placed = createThreePlacedProps(meshes, uniforms);
  const contactShadows = profileStep("three contact shadows", () =>
    createContactShadows(propInstances, meshes, uniforms)
  );
  const visibility = createChunkVisibility(world.cellsX, world.cellsZ);
  const casterVisibility = createChunkVisibility(world.cellsX, world.cellsZ, {
    maxY: SHADOW_CASTER_MAX_Y
  });
  const farLod = props.filter((prop) => isImpostorKind(prop.kind));
  // R08 per-cascade vegetation mask: the 3D tree and plant casters only exist within the plant and
  // tree distances (55), so only the detailed cascades draw them; the far cascade gets the sprites.
  for (const prop of props) prop.caster?.layers.set(SHADOW_NEAR_CASTER_LAYER);
  let all: ChunkedPropMesh[] = [...props, ...grass];
  const seasonExtras = createSeasonExtras({
    builders: content.builders,
    isPresent,
    leafCapacity: content.seasonalLeafCapacity ?? 0,
    meshes,
    onFlowers: (flowers, material) => {
      for (const prop of flowers) prop.showChunks(visibility.visible);
      grass.push(...flowers);
      grassMaterials.push(material);
      all = [...props, ...grass];
    },
    propInstances,
    springFlowerSamples: content.springFlowerSamples ?? 0,
    uniforms,
    world
  });
  const combined = new Uint8Array(visibility.visible.length);
  const casterCombined = new Uint8Array(visibility.visible.length);
  let castersSeparate = false;
  let grassVisibility: DistanceVisibility | null = null;
  let plantVisibility: DistanceVisibility | null = null;
  let treeVisibility: DistanceVisibility | null = null;
  let grassDistanceValue: number | undefined;
  let plantDistanceValue: number | undefined;
  let treeDistanceValue: number | undefined;
  let chunkMaskEnabled = false;

  /** Culling (rebuilds instance buffers only when the visible chunk set changed) and LOD. */
  const update = ({
    camera,
    eyePosition,
    felling: fellingFrame,
    flowerFade,
    leafFocus,
    grassDistance,
    grassVisible,
    growth: growthFrame,
    plantDetail,
    plantDistance,
    shadowFrustum,
    treeDistance,
    useImpostors
  }: VegetationFrame) => {
    const baseChanged = visibility.update(camera);
    const shadowChanged = shadowFrustum ? casterVisibility.updateFrustum(shadowFrustum) : false;
    const grassRange = applyGrassRange(grassMaterials, eyePosition, grassDistance);
    const grassState = refreshDistanceVisibility(
      grassVisibility, grassDistanceValue,
      eyePosition && grassDistance !== undefined ? grassRange.chunkDistance : undefined,
      world.cellsX, world.cellsZ
    );
    grassVisibility = grassState.visibility;
    grassDistanceValue = grassState.distance;
    const plantState = refreshDistanceVisibility(
      plantVisibility, plantDistanceValue, eyePosition ? plantDistance : undefined,
      world.cellsX, world.cellsZ
    );
    plantVisibility = plantState.visibility;
    plantDistanceValue = plantState.distance;
    const treeState = refreshDistanceVisibility(
      treeVisibility, treeDistanceValue, eyePosition ? treeDistance : undefined,
      world.cellsX, world.cellsZ
    );
    treeVisibility = treeState.visibility;
    treeDistanceValue = treeState.distance;
    const grassChanged = grassVisibility && eyePosition ? grassVisibility.update(eyePosition) : false;
    const plantChanged = plantVisibility && eyePosition ? plantVisibility.update(eyePosition) : false;
    const treeChanged = treeVisibility && eyePosition ? treeVisibility.update(eyePosition) : false;
    const impostorReady = impostors.isReady();
    const treeLod = impostorReady && treeVisibility !== null;
    const showImpostors = useImpostors && impostorReady;
    const eyeTreeLod = showImpostors && treeLod;
    if (eyePosition) treeViews?.start();
    const viewTrees = eyeTreeLod && treeViews?.isReady() === true && treeViewsEnabled();
    refreshVisibleChunks(props, grass, visibility.visible, combined, treeVisibility, plantVisibility,
      treeLod, impostorReady, grassVisibility, baseChanged, treeChanged, plantChanged, grassChanged);
    if (shadowFrustum) {
      // Keep near casters outside the main camera: their shadows can still land in the focus.
      if (!castersSeparate || baseChanged || shadowChanged || treeChanged || plantChanged) {
        refreshShadowCasters(props, visibility.visible, casterVisibility.visible,
          treeVisibility, plantVisibility, treeLod, impostorReady, casterCombined);
      }
      castersSeparate = true;
    } else if (castersSeparate) {
      for (const prop of props) prop.useMainCaster();
      castersSeparate = false;
    }
    if (impostorReady && eyePosition && treeVisibility && plantVisibility) {
      // The impostor shows only where the corresponding 3D chunk is hidden: near chunks keep
      // their full tree/plant meshes, far chunks use the baked sprite layers.
      if (!chunkMaskEnabled || baseChanged || treeChanged || plantChanged || shadowChanged) {
        refreshImpostorMasks(treeVisibility, plantVisibility, visibility.visible,
          casterVisibility.visible, Boolean(shadowFrustum), chunkMaskPixels, chunkMask,
          casterMaskPixels, casterMask);
        treeViews?.plantMask.copyPlants(chunkMaskPixels);
      }
      if (!chunkMaskEnabled) {
        treeViews?.setChunkMask(chunkMask);
        chunkMaskEnabled = true;
      }
      // R15a: with the view impostors drawing the far trees, the iso sprites keep only the plants.
      impostors.setChunkMask(viewTrees ? treeViews!.plantMask.texture : chunkMask);
      impostors.setCasterChunkMask(shadowFrustum ? casterMask : chunkMask);
    } else if (chunkMaskEnabled) {
      impostors.setChunkMask(null);
      impostors.setCasterChunkMask(null);
      treeViews?.setChunkMask(null);
      chunkMaskEnabled = false;
    }
    // D1: a bare (dormant) broadleaf shows its twig levels on every preset; its leaves no longer hide them.
    const bareWood = needsBareWoodDetail(uniforms);
    felling.update(fellingFrame, plantDetail || bareWood);
    growth.update(growthFrame, plantDetail || bareWood);
    placed.update(fellingFrame, growthFrame);
    for (const prop of all) prop.commitInstances();
    for (const prop of all) prop.setDetail(plantDetail || (bareWood && getSeasonClass(prop.kind) > 0));
    for (const prop of grass) prop.mesh.visible = grassVisible;
    seasonExtras.update(flowerFade, leafFocus);
    const farLodVisible = showsSpriteLodMeshes(eyeTreeLod, showImpostors);
    for (const prop of farLod) {
      prop.mesh.visible = farLodVisible;
      if (prop.caster) prop.caster.visible = farLodVisible;
    }
    impostors.mesh.visible = showImpostors;
    impostors.caster.visible = showImpostors;
    if (!treeViews) return;
    treeViews.mesh.visible = viewTrees;
    reportTreeViewsDrawn(viewTrees);
  };

  /** Hides everything above the seabed for the refraction pass; returns a restore function. */
  const hideForRefraction = () => {
    const previous = [...all.map((prop) => prop.mesh.visible), impostors.mesh.visible];
    const viewTreesVisible = treeViews?.mesh.visible ?? false;
    for (const prop of all) prop.mesh.visible = false;
    impostors.mesh.visible = false;
    if (treeViews) treeViews.mesh.visible = false;
    const dynamic = [felling.group, growth.group, placed.group, seasonExtras.group];
    for (const layer of dynamic) layer.visible = false;
    contactShadows.mesh.visible = false;
    return () => {
      for (const layer of dynamic) layer.visible = true;
      contactShadows.mesh.visible = true;
      all.forEach((prop, index) => {
        prop.mesh.visible = previous[index]!;
      });
      impostors.mesh.visible = previous[previous.length - 1]!;
      if (treeViews) treeViews.mesh.visible = viewTreesVisible;
    };
  };

  /** Map editor: new field cover for the culling chunks of a region. */
  const replaceGrass = (region: CellRegion, instances: PropInstances) => {
    if (content.visualWinter) instances = getSeasonalFieldCoverInstances(instances);
    const chunks = listCullChunks(region, Math.ceil(world.cellsX / CULL_CHUNK_CELLS));
    const byMesh = groupByMesh(instances);
    for (const prop of grass) {
      if (!seasonExtras.isFlower(prop)) prop.replaceChunks(chunks, instances, byMesh.get(prop.meshId) ?? []);
    }
    seasonExtras.replaceRegion(region);
  };

  /** Map editor: the placed props join the tree lookup (felling, growth) and their layer. */
  const setPlacedProps = (instances: PropInstances) => {
    trees.setPlaced(instances);
    placed.setInstances(instances);
  };

  /** Map editor: removed world props leave the meshes, impostors and plant decals. */
  const hideProps = (sourceIndices: readonly number[]) => {
    for (const id of sourceIndices) {
      props.some((prop) => prop.removeInstance(id));
      for (const layer of farTrees) layer.setTreeVisible(id, false);
    }
    contactShadows.removePlants(sourceIndices);
  };

  const countTriangles = (list: ChunkedPropMesh[]) =>
    list.reduce((sum, prop) => sum + prop.triangles, 0);

  const refreshPropGround = (chunks: readonly ChunkKey[]) => {
    const chunksX = Math.ceil(world.cellsX / CHUNK_CELLS);
    // Cubic interpolation can move a prop just across the edited chunk boundary.
    const touched = new Set<number>();
    const chunksZ = Math.ceil(world.cellsZ / CHUNK_CELLS);
    for (const key of chunks) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = key.chunkX + dx, z = key.chunkZ + dz;
      if (x >= 0 && z >= 0 && x < chunksX && z < chunksZ) touched.add(z * chunksX + x);
    }
    const heights = new Map<number, number>();
    for (let id = 0; id < world.props.count; id++) {
      if (world.props.types[id] === PROP_REMOVED) continue;
      const x = world.props.x[id]!, z = world.props.z[id]!;
      const chunk = Math.floor(z / CHUNK_CELLS) * chunksX + Math.floor(x / CHUNK_CELLS);
      if (!touched.has(chunk)) continue;
      const slot = trees.find(id);
      if (!slot) continue;
      const height = getPropInstanceHeight(world, id);
      if (Math.abs(slot.instances.y[slot.index]! - height) > .00001) heights.set(id, height);
    }
    if (!heights.size) return;
    for (let index = 0; index < propInstances.count; index++) {
      const id = propInstances.sourceIndex[index]!;
      const height = heights.get(id);
      if (height === undefined) continue;
      propInstances.y[index] = height;
      for (const layer of farTrees) layer.refreshTree(id);
    }
    for (const prop of props) prop.refreshHeights(heights);
    contactShadows.refreshHeights(heights);
    placed.refreshHeights(heights);
  };

  return {
    ready: impostors.ready,
    casters: [
      ...props.flatMap((prop) => (prop.caster ? [prop.caster] : [])),
      impostors.caster,
      felling.casters,
      growth.casters,
      placed.casters
    ],
    dispose: () => {
      for (const layer of farTrees) layer.dispose();
    },
    grassCount: grassInstances.count,
    hideForRefraction,
    hideProps,
    refreshPropGround,
    setPlacedProps,
    placed,
    meshes: [
      ...all.map((prop) => prop.mesh),
      contactShadows.mesh,
      impostors.mesh,
      ...(treeViews ? [treeViews.mesh] : []),
      felling.group,
      growth.group,
      placed.group,
      seasonExtras.group
    ],
    propTriangles: countTriangles(props) + countTriangles(grass),
    replaceGrass,
    shortGrassHole: shortGrassMaterial.uniforms.uGrassHole!.value as Vector4,
    shortGrassHoleShape: shortGrassMaterial.uniforms.uGrassHoleShape!.value as Vector4,
    update
  };
};
