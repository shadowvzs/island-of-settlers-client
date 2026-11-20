import type { Material, Object3D, Scene, Texture } from "three/webgpu";

import { createTslContactShadowMaterial, isContactShadowMaterial } from "../../webgpu/tsl/contact-shadow";
import { createTslGrassRingMaterial, isGrassRingMaterial } from "../../webgpu/tsl/grass-ring";
import { createTslImpostorMaterial, isImpostorMaterial } from "../../webgpu/tsl/impostor";
import { createTslPropMaterial, isPropMaterial } from "../../webgpu/tsl/props";
import { createTslRoadMaterial, isRoadMaterial } from "../../webgpu/tsl/road";
import { createTslRockMaterial, isRockMaterial } from "../../webgpu/tsl/rock";
import { createTslShipWakeMaterial, isShipWakeMaterial } from "../../webgpu/tsl/ship-wake";
import { createTslExplorationSkyMaterial, isExplorationSkyMaterial } from "../../webgpu/tsl/sky/exploration-sky";
import { createTslIsoSkyMaterial, isIsoSkyMaterial } from "../../webgpu/tsl/sky/iso-sky";
import { createTslTerritoryMarkerMaterial, isTerritoryMarkerMaterial } from "../../webgpu/tsl/territory-marker";
import { createTslWaterMaterial, type WaterPassInputs } from "../../webgpu/tsl/water";
import { createTslTerrainMaterial } from "../../webgpu/tsl/terrain";
import {
  copySourceTexture, type CopyTexture, retainedPixelsOf, STAND_IN_MAP_KEYS, syncStandInMaps, textureOf
} from "./stand-in-map";
import { spikeCategoryOf } from "./spike-categories";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type CreateStandIn = (
  source: Material, object: Object3D, usedTextures: boolean, copyTexture: CopyTexture, sunVisibility: TslNode | null
) => Material;
type PostUniforms = Record<string, import("three").IUniform>;

interface MaterialPortingDeps {
  createStandIn: CreateStandIn;
  hasPostUniforms: () => boolean;
  setPostUniforms: (uniforms: PostUniforms) => void;
  sunVisibility: () => TslNode | null;
  waterInputs: WaterPassInputs;
}

const isNodeMaterial = (material: Material) => (material as { isNodeMaterial?: boolean }).isNodeMaterial === true;

/**
 * C-3 material porting: one TSL port per source material, one texture copy and stand-in per object/material,
 * and the scene traversal that swaps them. The caller keeps its renderer and draw loop.
 */
export const createMaterialPorting = (deps: MaterialPortingDeps) => {
  const standIns = new Map<string, Material>();
  const overrideStandIns = new Map<Material, Material>();
  const standInSources = new Map<Material, Material>();
  const copiedTextures = new Set<Texture>();
  const textureCopies = new Map<Texture, Texture>();
  const portedMaterials = new Map<Material, Material | null>();
  const portedSync = new Set<() => void>();
  const materialTypes = new Map<string, number>();

  /** C-3/G-W7: one copy per source texture; the owner town shares far fewer atlases than materials. */
  const copyTextureOnce: CopyTexture = texture => {
    if (texture == null) return undefined;
    const cached = textureCopies.get(texture);
    if (cached !== undefined) return cached;
    const copy = copySourceTexture(texture);
    if (copy !== undefined) {
      textureCopies.set(texture, copy);
      copiedTextures.add(copy);
    }
    return copy;
  };

  /** One TSL port per source material; a port that cannot start falls back to the stand-in. */
  const portMaterial = (source: Material, kind: string, create: (material: Material) => Material | null) => {
    if (portedMaterials.has(source)) return portedMaterials.get(source) ?? undefined;
    try {
      const material = create(source);
      portedMaterials.set(source, material);
      if (material === null) return undefined;
      const uniforms = (source as { uniforms?: PostUniforms }).uniforms;
      if (!deps.hasPostUniforms() && uniforms?.uColorToneMapper !== undefined &&
        uniforms.uDaylight !== undefined && uniforms.uSunDirection !== undefined)
        deps.setPostUniforms(uniforms);
      const sync = material.userData.syncUniforms;
      if (typeof sync === "function") portedSync.add(sync as () => void);
      materialTypes.set(kind, (materialTypes.get(kind) ?? 0) + 1);
      return material;
    } catch (error) {
      console.warn(`[${kind}] TSL material could not start; using the stand-in`, error);
      portedMaterials.set(source, null);
      return undefined;
    }
  };

  const portOf = (source: Material, category: string) => {
    if (isContactShadowMaterial(source))
      return portMaterial(source, "wg4:contact-shadow", createTslContactShadowMaterial);
    if (isGrassRingMaterial(source))
      return portMaterial(source, "wg:grass-ring", createTslGrassRingMaterial);
    if (isExplorationSkyMaterial(source))
      return portMaterial(source, "wg:sky", createTslExplorationSkyMaterial);
    if (isIsoSkyMaterial(source))
      return portMaterial(source, "wg:iso-sky", createTslIsoSkyMaterial);
    if (isTerritoryMarkerMaterial(source))
      return portMaterial(source, "wg4:territory-marker", createTslTerritoryMarkerMaterial);
    if (isRoadMaterial(source))
      return portMaterial(source, "wg4:road", material =>
        createTslRoadMaterial(material, copyTextureOnce, deps.sunVisibility()));
    if (isPropMaterial(source)) return portMaterial(source, "wg:prop", createTslPropMaterial);
    if (isImpostorMaterial(source)) return portMaterial(source, "wg:impostor", createTslImpostorMaterial);
    if (isRockMaterial(source)) return portMaterial(source, "wg:rock", createTslRockMaterial);
    if (isShipWakeMaterial(source)) return portMaterial(source, "wg5:ship-wake", createTslShipWakeMaterial);
    if (category === "terrain") return portMaterial(source, "wg2:terrain", createTslTerrainMaterial);
    if (category === "water")
      return portMaterial(source, "wg3:water", material => createTslWaterMaterial(material, deps.waterInputs));
    return undefined;
  };

  /** Swaps an object's non-node materials for their TSL port or stand-in (kept for later frames). */
  const replaceObjectMaterials = (object: Object3D) => {
    const material = (object as { material?: Material | Material[] }).material;
    if (material === undefined) return;
    const replace = (source: Material) => {
      if (isNodeMaterial(source)) return source;
      const category = spikeCategoryOf(object);
      const ported = portOf(source, category);
      if (ported !== undefined) return ported;
      const key = `${source.uuid}:${category}:${object.type}`;
      const cached = standIns.get(key);
      if (cached !== undefined) {
        syncStandInMaps(cached, source, copyTextureOnce);
        return cached;
      }
      const standIn = deps.createStandIn(source, object, false, copyTextureOnce, deps.sunVisibility());
      standInSources.set(standIn, source);
      const sync = standIn.userData.syncUniforms;
      if (typeof sync === "function") portedSync.add(sync as () => void);
      standIns.set(key, standIn);
      for (const key of STAND_IN_MAP_KEYS) {
        const copied = textureOf(standIn, key);
        if (copied?.userData.wg0Copied === true) copiedTextures.add(copied);
      }
      materialTypes.set(source.type, (materialTypes.get(source.type) ?? 0) + 1);
      const surface = (object.userData as { buildingSurface?: unknown }).buildingSurface;
      if (typeof surface === "string" && retainedPixelsOf(textureOf(source, "map")) !== undefined)
        materialTypes.set("wg0:building-texture", (materialTypes.get("wg0:building-texture") ?? 0) + 1);
      return standIn;
    };
    (object as unknown as { material: Material | Material[] }).material = Array.isArray(material)
      ? material.map(replace)
      : replace(material);
  };

  /** The node twin of a scene override (the placement preview's depth prepass material). */
  const overrideStandInFor = (override: Material, scene: Scene) => {
    const cached = overrideStandIns.get(override);
    if (cached !== undefined) return cached;
    const standIn = deps.createStandIn(override, scene, false, copyTextureOnce, null);
    overrideStandIns.set(override, standIn);
    standInSources.set(standIn, override);
    standIns.set(`override:${override.uuid}`, standIn);
    return standIn;
  };

  /** Material swaps for every object plus a scene-level override (shadow/placement passes). */
  const replaceSceneMaterials = (scene: Scene) => {
    scene.traverse(replaceObjectMaterials);
    const override = (scene as { overrideMaterial?: Material | null }).overrideMaterial;
    if (override != null && !isNodeMaterial(override))
      (scene as { overrideMaterial?: Material | null }).overrideMaterial = overrideStandInFor(override, scene);
  };

  return {
    copiedTextures, copyTextureOnce, materialTypes, overrideStandInFor, overrideStandIns, portedMaterials, portedSync,
    replaceObjectMaterials, replaceSceneMaterials, standInSources, standIns, textureCopies
  };
};

export type MaterialPorting = ReturnType<typeof createMaterialPorting>;
