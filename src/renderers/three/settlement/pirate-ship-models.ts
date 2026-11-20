import {
  type BufferGeometry, Float32BufferAttribute, Group, Mesh, type MeshStandardMaterial, type Object3D,
  type WebGLRenderer
} from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

import { SHIP_CLOTH_WIND } from "../../../render-common/ships/ship-cloth-wind";
import { SAILING_SHIP_SCALE } from "../../../render-common/ships/ship-dimensions";
import type { ShipClothMotion } from "./ship-cloth-wind";
import { CLOTH_FORWARD, CLOTH_STARBOARD } from "./ship-sails";

/**
 * The owner's pirate ships (owner-generated, 2026-11-17): the raiders sail the Blackwake (square
 * sail) or the Red Viper (lateen sail) instead of the procedural serpent galley, which stays the
 * fallback while the models load and the rollback (`PIRATE_SHIP_MODELS`). Both share one texture set;
 * `tools/assets/pirate-ship-lods.py` builds the levels, TOOL-2 the KTX2 tiers.
 */
export const PIRATE_SHIP_MODELS = true;

export const PIRATE_SHIP_VARIANTS = ["blackwake", "redviper"] as const;
export type PirateShipVariant = typeof PIRATE_SHIP_VARIANTS[number];

/** Raider ships alternate between the two hulls by ship id. */
export const pirateShipVariant = (shipId: number): PirateShipVariant =>
  PIRATE_SHIP_VARIANTS[Math.abs(shipId) % PIRATE_SHIP_VARIANTS.length]!;

/** Camera zoom from which High draws the full model, and below which every preset draws the far one. */
export const PIRATE_NEAR_ZOOM = .9;
export const PIRATE_FAR_ZOOM = .5;

const HIGH_URL = new URL("../../../../assets/ships/pirate/pirate-ships-high.ktx2.glb", import.meta.url).href;
const MINIMAL_URL = new URL("../../../../assets/ships/pirate/pirate-ships-minimal.ktx2.glb", import.meta.url).href;

/** Sail belly direction per hull: the square sail fills forward, the lateen to starboard. */
const SAIL_DIRECTION: Readonly<Record<PirateShipVariant, number>> = {
  blackwake: CLOTH_FORWARD, redviper: CLOTH_STARBOARD
};

const isCloth = (material: MeshStandardMaterial) => material.name.endsWith("-cloth");
const isPennant = (material: MeshStandardMaterial) => material.name === "pennant";

/**
 * SHIP-WIND data of an authored sail: the rest belly is the depth along the fill direction above the
 * cloth's pinned (shallowest) edge, and the deepest cloth flutters most.
 */
export const authoredSailWind = (geometry: BufferGeometry, direction: number) => {
  const position = geometry.getAttribute("position");
  const dx = Math.cos(direction), dz = Math.sin(direction);
  const depths = Array.from({ length: position.count }, (_, index) =>
    position.getX(index) * dx + position.getZ(index) * dz);
  const shallowest = Math.min(...depths), span = Math.max(...depths) - shallowest || 1;
  const wind = new Float32Array(position.count * 4);
  depths.forEach((depth, index) => wind.set([direction, depth - shallowest, (depth - shallowest) / span, 1], index * 4));
  geometry.setAttribute(SHIP_CLOTH_WIND.attribute, new Float32BufferAttribute(wind, 4));
};

/** The pennant is pinned at the mast (x 0) and flutters across its face towards the fly end. */
export const pennantWind = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute("position");
  let fly = 0;
  for (let index = 0; index < position.count; index++) fly = Math.max(fly, position.getX(index));
  const wind = new Float32Array(position.count * 4);
  for (let index = 0; index < position.count; index++)
    wind.set([CLOTH_FORWARD, 0, Math.max(0, position.getX(index)) / (fly || 1), 0], index * 4);
  geometry.setAttribute(SHIP_CLOTH_WIND.attribute, new Float32BufferAttribute(wind, 4));
};

interface TemplatePart { geometry: BufferGeometry; material: MeshStandardMaterial; pennant: boolean; sail: boolean }
type Templates = ReadonlyMap<PirateShipVariant, readonly (readonly TemplatePart[])[]>;

/** Bakes node transforms and the ×4 ship scale into the template geometry (ship model units). */
const templateParts = (level: Object3D, variant: PirateShipVariant, cloth: ShipClothMotion) => {
  const parts: TemplatePart[] = [];
  level.updateMatrixWorld(true);
  level.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as MeshStandardMaterial;
    const geometry = (object.geometry as BufferGeometry).applyMatrix4(object.matrixWorld)
      .scale(1 / SAILING_SHIP_SCALE, 1 / SAILING_SHIP_SCALE, 1 / SAILING_SHIP_SCALE);
    const sail = isCloth(material), pennant = isPennant(material);
    if (sail) authoredSailWind(geometry, SAIL_DIRECTION[variant]);
    if (pennant) pennantWind(geometry);
    if (sail || pennant) cloth.prepareGeometry(geometry);
    else geometry.computeBoundingSphere();
    parts.push({ geometry, material, pennant, sail });
  });
  return parts;
};

const readTemplates = (scene: Group, detailed: boolean, cloth: ShipClothMotion): Templates => {
  const levels = detailed ? ["lod0", "lod1", "lod2"] : ["lod1", "lod2"];
  const materials = new Set<MeshStandardMaterial>();
  const templates = new Map(PIRATE_SHIP_VARIANTS.map(variant => [variant, levels.map(level => {
    const node = scene.getObjectByName(`${variant}_${level}`);
    if (!node) throw new Error(`Pirate ship model lacks ${variant}_${level}`);
    const parts = templateParts(node, variant, cloth);
    parts.forEach(part => materials.add(part.material));
    return parts;
  })] as const));
  for (const material of materials) if (isCloth(material) || isPennant(material)) cloth.prepareMaterial(material);
  return templates;
};

/** One drawn pirate ship: its detail levels and the pennant pivots that turn with the wind. */
export interface PirateCraftModel {
  root: Group;
  /** Shows the level for `zoom` and turns the pennant to `pennantYaw` (ship space). */
  update: (zoom: number, pennantYaw: number) => void;
}

const partName = (part: TemplatePart) => {
  if (part.sail) return "ship_sail";
  return part.pennant ? "ship_flag" : "pirate_ship_part";
};

const levelIndex = (zoom: number, levels: number) => {
  if (zoom < PIRATE_FAR_ZOOM) return levels - 1;
  return levels > 2 && zoom < PIRATE_NEAR_ZOOM ? 1 : 0;
};

const createCraft = (parts: readonly (readonly TemplatePart[])[]): PirateCraftModel => {
  const root = new Group(); root.name = "pirate_ship_model";
  const pennants: Group[] = [];
  const levels = parts.map((levelParts, index) => {
    const level = new Group(); level.name = `pirate_ship_lod${index}`; level.visible = false;
    const pennant = new Group(); pennant.name = "pirate_pennant";
    for (const part of levelParts) {
      const mesh = new Mesh(part.geometry, part.material);
      mesh.name = partName(part);
      mesh.castShadow = !part.sail && !part.pennant; mesh.receiveShadow = true;
      (part.pennant ? pennant : level).add(mesh);
    }
    level.add(pennant); pennants.push(pennant); root.add(level);
    return level;
  });
  let shown = -1;
  const update = (zoom: number, pennantYaw: number) => {
    const index = levelIndex(zoom, levels.length);
    if (index !== shown) {
      if (shown >= 0) levels[shown]!.visible = false;
      levels[index]!.visible = true; shown = index;
    }
    pennants[index]!.rotation.y = pennantYaw;
  };
  return { root, update };
};

/**
 * Loads the pirate models on first request (zero cost while no raider sails); `craft` returns null until
 * they are ready, so the caller draws the procedural raider meanwhile.
 */
export const createPirateShipModels = (renderer: WebGLRenderer, transcoderPath: string, detailed: boolean,
  cloth: ShipClothMotion) => {
  let templates: Templates | undefined;
  let loading: Promise<void> | undefined;
  const geometries: BufferGeometry[] = [], materials = new Set<MeshStandardMaterial>();
  const request = () => {
    if (loading || !PIRATE_SHIP_MODELS) return;
    const textures = new KTX2Loader().setTranscoderPath(transcoderPath).detectSupport(renderer);
    loading = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(textures)
      .loadAsync(detailed ? HIGH_URL : MINIMAL_URL)
      .then(gltf => {
        templates = readTemplates(gltf.scene, detailed, cloth);
        for (const levels of templates.values()) for (const parts of levels) for (const part of parts) {
          geometries.push(part.geometry); materials.add(part.material);
        }
      })
      .catch(error => console.warn("Pirate ship models failed to load; raiders keep the galley", error))
      .finally(() => textures.dispose());
  };
  const craft = (variant: PirateShipVariant) => {
    request();
    const parts = templates?.get(variant);
    return parts ? createCraft(parts) : null;
  };
  const dispose = () => {
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    });
  };
  return { craft, dispose, isReady: () => templates !== undefined, request };
};

export type PirateShipModels = ReturnType<typeof createPirateShipModels>;
