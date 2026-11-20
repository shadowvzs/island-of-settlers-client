import {
  BufferAttribute,
  type Camera,
  DataTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PerspectiveCamera,
  RepeatWrapping} from "three";

import type { CameraState } from "../../render-common/camera-state";
import { PIXELS_PER_UNIT } from "../../render-common/iso-projection";
import { MODEL_LOD, type ModelLod } from "../../render-common/wildlife/model/animal-asset";
import type {
  AnimalModels,
  LoadedAnimal
} from "../../render-common/wildlife/model/animal-asset-loader";
import { type AnimalModel,POSE_CHANNELS } from "../../render-common/wildlife/model/animal-rig";
import { createAnimalVariants } from "../../render-common/wildlife/model/animal-variants";
import { COAT_SPOTS, type CoatSpots } from "../../render-common/wildlife/model/coat-spots";
import { createFurTexture, FUR_TEXTURE_SIZE } from "../../render-common/wildlife/model/fur-texture";
import {
  type AnimalFrame,
  MAX_VISIBLE_ANIMALS} from "../../render-common/wildlife/sim/animal-pool";
import { getSpecies, SPECIES_IDS } from "../../render-common/wildlife/wildlife-species";
import { createAnimalContactShadows } from "./three-animal-contact";
import {
  type AnimalPass,
  type AnimalTextures,
  createAnimalMaterial} from "./three-animal-material";
import { createAtlasTexture } from "./three-materials";

/** Body length on screen (pixels) from which the detailed model is drawn. */
const HIGH_DETAIL_PIXELS = 46;
/** Body length on screen (pixels) from which the close inspection model is drawn. */
const CLOSE_DETAIL_PIXELS = 150;
/** Smaller than this an animal is not drawn at all (LOD3). */
const MIN_PIXELS = 3;
/** Fog of war: animals in unexplored land stay hidden. */
const MIN_VISIBILITY = 0.3;
const INSTANCE_ATTRIBUTES = ["animalPlace", "animalBody", "animalStyle", "animalCoat"] as const;
const POSE_ATTRIBUTES = ["animalPose0", "animalPose1", "animalPose2", "animalPose3"] as const;

/** Fur tiles per world unit: finer hair on rabbits, coarser on elk. */
const FUR_SCALE = [6, 4, 3];
const FUR_SEED = 17;

/** The shared fur stroke texture (one per renderer, mipmapped, repeating). */
export const createFurTextureMap = () => {
  const texture = new DataTexture(createFurTexture(FUR_SEED), FUR_TEXTURE_SIZE, FUR_TEXTURE_SIZE);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

/** Per vertex (part, second part, its weight) for the blended rig. */
const interleaveParts = (model: AnimalModel) => {
  const parts = new Float32Array(model.parts.length * 3);
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    parts[vertex * 3] = model.parts[vertex]!;
    parts[vertex * 3 + 1] = model.blendParts[vertex]!;
    parts[vertex * 3 + 2] = model.blendWeights[vertex]!;
  }
  return parts;
};

/** One species variant at one level of detail: an instanced draw plus its sun shadow twin. */
export const createAnimalLayer = (
  model: AnimalModel,
  uniforms: Record<string, IUniform>,
  textures: AnimalTextures,
  spots: CoatSpots | undefined
) => {
  const geometry = new InstancedBufferGeometry();
  const { mesh } = model;
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  geometry.setAttribute("parts", new BufferAttribute(interleaveParts(model), 3));
  geometry.setAttribute("spotRegion", new BufferAttribute(model.spotRegion, 1));
  geometry.setAttribute("fur", new BufferAttribute(model.fur, 4));
  geometry.setAttribute("roughness", new BufferAttribute(model.roughness, 1));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  const attributes = [...INSTANCE_ATTRIBUTES, ...POSE_ATTRIBUTES].map((name) => {
    const attribute = new InstancedBufferAttribute(new Float32Array(MAX_VISIBLE_ANIMALS * 4), 4);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    return attribute;
  });
  geometry.instanceCount = 0;
  const createPass = (pass: AnimalPass) =>
    new Mesh(geometry, createAnimalMaterial(uniforms, model, textures, spots, pass));
  const main = createPass("main");
  const caster = createPass("shadow");
  const silhouette = createPass("silhouette");
  for (const item of [main, caster, silhouette]) {
    item.frustumCulled = false;
    item.visible = false;
  }
  const arrays = attributes.map((attribute) => attribute.array as Float32Array);

  const writeVec4 = (
    target: Float32Array,
    offset: number,
    a: number,
    b: number,
    c: number,
    d: number
  ) => {
    target[offset] = a;
    target[offset + 1] = b;
    target[offset + 2] = c;
    target[offset + 3] = d;
  };

  /** Copies animal `index` of the frame into instance `slot` (no allocation). */
  const write = (slot: number, frame: AnimalFrame, index: number) => {
    const offset = slot * 4;
    const [place, body, style, coat] = arrays as [
      Float32Array,
      Float32Array,
      Float32Array,
      Float32Array
    ];
    for (let channel = 0; channel < 4; channel += 1) {
      coat[offset + channel] = frame.coat[index * 4 + channel]!;
    }
    writeVec4(
      place,
      offset,
      frame.x[index]!,
      frame.y[index]!,
      frame.z[index]!,
      frame.heading[index]!
    );
    writeVec4(
      body,
      offset,
      frame.pitch[index]!,
      frame.roll[index]!,
      frame.scale[index]!,
      frame.antlers[index]!
    );
    writeVec4(
      style,
      offset,
      frame.shade[index]!,
      frame.appear[index]!,
      frame.visibility[index]!,
      frame.tone[index]!
    );
    const pose = index * POSE_CHANNELS;
    for (let channel = 0; channel < POSE_CHANNELS; channel += 1) {
      arrays[INSTANCE_ATTRIBUTES.length + (channel >> 2)]![offset + (channel & 3)] =
        frame.pose[pose + channel]!;
    }
  };

  const commit = (count: number) => {
    geometry.instanceCount = count;
    for (const item of [main, caster, silhouette]) item.visible = count > 0;
    if (count === 0) return;
    for (const attribute of attributes) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * 4);
      attribute.needsUpdate = true;
    }
  };

  return { caster, commit, main, silhouette, triangles: mesh.indices.length / 3, write };
};

type AnimalLayer = ReturnType<typeof createAnimalLayer>;

/** On screen body length (pixels) of an animal: perspective by distance, iso by zoom. */
const getScreenLength = (camera: Camera, state: CameraState, frame: AnimalFrame, index: number) => {
  const length = getSpecies(frame.species[index]!).length * frame.scale[index]!;
  if (!(camera instanceof PerspectiveCamera)) return length * PIXELS_PER_UNIT * state.zoom;
  const distance = Math.hypot(
    camera.position.x - frame.x[index]!,
    camera.position.y - frame.y[index]!,
    camera.position.z - frame.z[index]!
  );
  const viewHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(distance, 0.1);
  return (length / viewHeight) * state.viewportHeight;
};

/** Level of detail by on-screen size: close inspection, gameplay, distant. */
const pickLayer = <Layer>(species: { close: Layer; high: Layer; low: Layer }, pixels: number) => {
  if (pixels >= CLOSE_DETAIL_PIXELS) return species.close;
  return pixels >= HIGH_DETAIL_PIXELS ? species.high : species.low;
};

/**
 * The textures of a loaded species (albedo and normal atlases, the shared fur strokes);
 * `clumps` adds the hair clump detail.
 */
export const createAnimalTextures = (
  animal: LoadedAnimal,
  species: number,
  furTexture: DataTexture,
  clumps: boolean
): AnimalTextures => {
  const { albedo, normal } = animal;
  return {
    albedo: createAtlasTexture(albedo.pixels, albedo.width, albedo.height),
    fur: { clumps, scale: FUR_SCALE[species]!, texture: furTexture },
    normal: normal ? createAtlasTexture(normal.pixels, normal.width, normal.height) : null
  };
};

/** Every life stage / coat variant of a species at one level of detail (summer or winter coat). */
const createVariantLayers = (
  species: number,
  animal: LoadedAnimal,
  lod: ModelLod,
  uniforms: Record<string, IUniform>,
  textures: AnimalTextures,
  winter: boolean
) =>
  createAnimalVariants(species, animal.asset, lod, winter).map((model) =>
    createAnimalLayer(model, uniforms, textures, COAT_SPOTS[species])
  );

/**
 * Animals in 3D (the cosmetic season picks the summer or winter coat once, when built): per
 * species and life stage variant a close, a gameplay and a distant level of
 * the loaded model (screen size LOD, the smallest not drawn), skinned on the GPU from the
 * shared pose, lit like the props, casting sun shadows, over one soft contact shade per animal
 * (one draw). Layers without animals this frame cost no draw call; a species whose model did
 * not load is not drawn.
 */
/** How the animals are drawn: preset detail and the cosmetic season. */
export interface AnimalDrawOptions {
  /** Hair clump detail (every preset but Minimal). */
  furDetail: boolean;
  /** Sun shadows drawn (the contact shade is lighter then). */
  sunShadows: boolean;
  /** Cosmetic winter: winter coats. */
  visualWinter: boolean;
}

export const createThreeAnimals = (
  uniforms: Record<string, IUniform>,
  animals: AnimalModels,
  { furDetail, sunShadows, visualWinter }: AnimalDrawOptions
) => {
  const furTexture = createFurTextureMap();
  const contactShadows = createAnimalContactShadows(uniforms, sunShadows);
  const layers = SPECIES_IDS.map((species) => {
    const animal = animals[species];
    if (!animal) return null;
    const textures = createAnimalTextures(animal, species, furTexture, furDetail);
    const create = (lod: ModelLod) =>
      createVariantLayers(species, animal, lod, uniforms, textures, visualWinter);
    return {
      close: create(MODEL_LOD.close),
      high: create(MODEL_LOD.high),
      low: create(MODEL_LOD.low)
    };
  });
  const all = layers.flatMap((species) =>
    species ? [...species.close, ...species.high, ...species.low] : []
  );
  const counts = new Map<AnimalLayer, number>();
  let triangles = 0;
  let drawnLayers = 0;

  const update = (frame: AnimalFrame, camera: Camera, state: CameraState) => {
    for (const layer of all) counts.set(layer, 0);
    triangles = 0;
    contactShadows.begin();
    for (let index = 0; index < frame.count; index += 1) {
      const species = layers[frame.species[index]!];
      if (!species || frame.visibility[index]! < MIN_VISIBILITY) continue;
      const pixels = getScreenLength(camera, state, frame, index);
      if (pixels < MIN_PIXELS) continue;
      const layer = pickLayer(species, pixels)[frame.variant[index]!]!;
      const slot = counts.get(layer)!;
      layer.write(slot, frame, index);
      counts.set(layer, slot + 1);
      triangles += layer.triangles;
      contactShadows.write(frame, index);
    }
    contactShadows.commit();
    drawnLayers = 0;
    for (const layer of all) {
      const count = counts.get(layer)!;
      layer.commit(count);
      if (count > 0) drawnLayers += 1;
    }
  };

  return {
    casters: all.map((layer) => layer.caster),
    meshes: [contactShadows.mesh, ...all.map((layer) => layer.main)],
    silhouettes: all.map((layer) => layer.silhouette),
    /** Instanced layers drawn this frame (one main draw each, plus its shadow and silhouette). */
    getDrawnLayers: () => drawnLayers,
    getTriangles: () => triangles,
    update
  };
};
