import { MeshStandardMaterial, type Texture,Vector2 } from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { ROOF_GEOMETRY_SURFACES } from "../../../render-common/buildings/nation-roof-colours";
import {
  buildingSurfaceResolution,
  type PaintedSurface,
  ROMAN_SURFACE_COLOURS} from "./building-surface-paint";
import { createSurfaceTextures, type PaintedSurfaces } from "./building-surface-textures";

const SURFACE_ROUGHNESS: Partial<Record<PaintedSurface, number>> = { copper: .68, gold: .42, steel: 0.38 };
const SURFACE_METALNESS: Partial<Record<PaintedSurface, number>> = { copper: .7, gold: .55, iron: 0.65, steel: 0.45 };

/**
 * The shared Roman surface pack. `painted`: the maps the loader already painted (world workers,
 * island cache); a missing one is painted here, on the page.
 */
export const createRomanMaterials = (
  detailed: boolean,
  resolution = buildingSurfaceResolution(detailed),
  painted?: PaintedSurfaces
) => {
  const materials = {} as Record<BuildingSurface, MeshStandardMaterial>;
  const textures: Texture[] = [];
  for (const surface of Object.keys(ROMAN_SURFACE_COLOURS) as PaintedSurface[]) {
    const maps = createSurfaceTextures({ detailed, nation: "roman", resolution, surface }, painted);
    textures.push(...maps);
    materials[surface] = new MeshStandardMaterial({
      map: maps[0],
      normalMap: detailed ? maps[1] : undefined,
      normalScale: new Vector2(
        surface === "stone" ? 0.95 : 0.55,
        surface === "stone" ? 0.95 : 0.55
      ),
      vertexColors: true,
      roughnessMap: detailed ? maps[2] : undefined,
      roughness: SURFACE_ROUGHNESS[surface] ?? 0.95,
      // Polished gold (coins, ornaments) reads as metal; iron stays half-metallic.
      metalness: SURFACE_METALNESS[surface] ?? 0,
      emissive: surface === "amber" ? 0xb25f1b : 0,
      emissiveIntensity: 0.6
    });
    if (surface === "feed-water" || surface === "tanning-liquid") {
      materials[surface].roughness = .32;
      materials[surface].metalness = 0;
      materials[surface].normalScale.set(.8, .8);
    }
  }
  // One roof colour per nation: the flat-tile roofs share the terracotta material (and its batch).
  for (const surface of ROOF_GEOMETRY_SURFACES) materials[surface] = materials.roof;
  return {
    materials,
    dispose: () => {
      new Set(Object.values(materials)).forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
    }
  };
};
