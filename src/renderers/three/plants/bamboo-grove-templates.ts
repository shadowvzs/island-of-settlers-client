import type { IUniform } from "three";

import type { BambooGroveVariant } from "../../../render-common/plants/bamboo-grove-species";
import type { BambooTier } from "./bamboo-culm-geometry";
import { createBambooGroveModel } from "./bamboo-grove-model";
import { type BambooMaterials, createBambooMaterials } from "./bamboo-materials";
import { createBambooTextures, type BambooTextures } from "./bamboo-textures";

/**
 * Per-map/quality owner: procedural textures and the two wind materials are created on first use and
 * released with the last live template. `uniforms` are the renderer's shared wind/time uniforms.
 */
export const createBambooGroveTemplates = (detailed: boolean, uniforms?: Record<string, IUniform>) => {
  let pack: { materials: BambooMaterials; textures: BambooTextures } | undefined;
  let users = 0, disposed = false;
  const release = () => {
    users--;
    if (users !== 0 || !pack) return;
    pack.materials.dispose(); pack.textures.dispose(); pack = undefined;
  };
  const acquire = () => {
    if (pack) return pack;
    const textures = createBambooTextures(detailed);
    pack = { materials: createBambooMaterials(textures, detailed, uniforms), textures };
    return pack;
  };
  const create = (variant: BambooGroveVariant, tier: "near" | "far") => {
    if (disposed) throw new Error("Bamboo grove template owner is disposed");
    users++;
    let lod: BambooTier = detailed ? "high" : "minimal";
    if (tier === "far") lod = "far";
    const model = createBambooGroveModel(acquire().materials, variant, lod);
    let released = false;
    return { ...model, dispose: () => {
      if (released) return;
      released = true; model.dispose(); release();
    } };
  };
  return { create, dispose: () => { disposed = true; }, statistics: () => ({ users, ready: pack !== undefined }) };
};
