import { TEAM_TINT_MATERIAL } from "@workers/character-lods/lod-policy";
import { type Color, type Material, MeshStandardMaterial } from "three";

import { CrowdBodyMaterial, setCrowdBodyTint } from "./worker-crowd-body";

/** Materials whose colour is the team/bandit tint; every other body material is shared as loaded. */
export const isTintedBodyMaterial = (material: Material) =>
  material instanceof CrowdBodyMaterial || material.name === TEAM_TINT_MATERIAL;

/** Stable cache key of a tint colour (hex string, hex number or `Color`), one per actual colour. */
export const tintColourKey = (color: string | number | Color) => {
  if (typeof color === "number") return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
  if (typeof color === "string") {
    const value = color.trim().toLowerCase();
    return value.startsWith("#") ? value : `#${value}`;
  }
  return `#${color.getHexString()}`;
};

export type BodyMaterialLookup = (material: Material, color: string | number | Color) => Material;

export interface BodyMaterials {
  /** The material an actor of this body type draws with for `color`. */
  get: BodyMaterialLookup;
  dispose(): void;
}

/**
 * C02 (b): every actor of one body type shares one material per (source material × tint colour).
 * Untinted materials are the loaded body's own objects, so two civilians of the same body draw with
 * the same state; only the team/bandit tint gets one shared variant per colour instead of a clone
 * per worker. The palette is owned by the body type's lease (`worker-body-pool.ts`) and keeps the
 * material objects of its LOD templates too.
 */
export const createBodyMaterials = (): BodyMaterials => {
  const tinted = new Map<Material, Map<string, Material>>();
  /** A shared tint variant back to the loaded material it was cloned from. */
  const origins = new WeakMap<Material, Material>();
  const created: Material[] = [];

  const share = (source: Material, key: string, color: string | number | Color) => {
    let byColour = tinted.get(source);
    if (!byColour) { byColour = new Map(); tinted.set(source, byColour); }
    const existing = byColour.get(key);
    if (existing) return existing;
    const shared = source.clone();
    origins.set(shared, source);
    if (shared instanceof CrowdBodyMaterial) setCrowdBodyTint(shared, color);
    else if (shared instanceof MeshStandardMaterial) shared.color.set(color);
    byColour.set(key, shared);
    created.push(shared);
    return shared;
  };

  return {
    get: (material, color) => {
      const source = origins.get(material) ?? material;
      if (!isTintedBodyMaterial(source)) return source;
      return share(source, tintColourKey(color), color);
    },
    dispose: () => {
      for (const material of created) material.dispose();
      created.length = 0;
      tinted.clear();
    }
  };
};
