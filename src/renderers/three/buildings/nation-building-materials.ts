import { DoubleSide, type MeshStandardMaterial, type Texture } from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { ROOF_GEOMETRY_SURFACES } from "../../../render-common/buildings/nation-roof-colours";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { NATION_SURFACES, type NationSurface,nationSurfaceResolution } from "./building-surface-paint";
import { createSurfaceTextures, type PaintedSurfaces } from "./building-surface-textures";
import { createNubianDecorMaterials } from "./nubian-decor-materials";

type Colour = readonly [number, number, number];

/** Timber stain per nation: dark hinoki-and-soot for Japan, pale weathered pine for the Norse. */
const TIMBER_TINTS: Partial<Record<WorkerNation, Colour>> = {
  chinese: [.72, .61, .49], persian: [.76, .65, .5], maya: [.68, .59, .42],
  indigenous: [.84, .76, .62],
  japanese: [.55, .47, .62], viking: [.82, .75, .62]
};

/**
 * Nation architecture maps on top of the shared Roman pack: occupation props and common surfaces
 * keep the Roman materials, walls and roofs get the nation's own painter (normal maps on High).
 * `painted`: the maps the loader already painted (world workers); a missing one is painted here.
 */
export const createNationBuildingMaterials = (
  base: Record<BuildingSurface, MeshStandardMaterial>,
  nation: WorkerNation,
  detailed: boolean,
  painted?: PaintedSurfaces
) => {
  const materials = { ...base }, owned: MeshStandardMaterial[] = [], textures: Texture[] = [];
  const surfaces = Object.entries(NATION_SURFACES[nation] ?? {}) as Array<[BuildingSurface, NationSurface]>;
  for (const [surface, design] of surfaces) {
    const resolution = nationSurfaceResolution(nation, surface, detailed);
    const maps = createSurfaceTextures({ detailed, nation, resolution, surface }, painted);
    const material = (base[surface] ?? base.cloth).clone();
    material.map = maps[0]!;
    material.normalMap = maps[1] ?? null;
    material.normalScale.set(design.normalScale, design.normalScale);
    material.roughnessMap = maps[2] ?? null;
    material.roughness = design.roughness;
    material.metalness = 0;
    if (nation === "indigenous" && (surface.startsWith("cloth") || surface.startsWith("hide"))) {
      material.side = DoubleSide; material.opacity = 1; material.transparent = false;
      material.depthWrite = true; material.alphaTest = 0;
    }
    materials[surface] = material; owned.push(material); textures.push(...maps);
  }
  // One roof colour per nation: roof geometry markers (yagura skirts) share the nation roof.
  for (const surface of ROOF_GEOMETRY_SURFACES)
    if (!NATION_SURFACES[nation]?.[surface]) materials[surface] = materials.roof;
  const tint = TIMBER_TINTS[nation];
  for (const surface of tint ? ["wood", "planks"] as const : []) {
    if (NATION_SURFACES[nation]?.[surface]) {
      materials[surface].color.setRGB(...tint!);
      continue;
    }
    const material = (base[surface] ?? base.cloth).clone(); material.color.setRGB(...tint!);
    materials[surface] = material; owned.push(material);
  }
  // Nubian household decor: woven hangings and the painted jar/shield/skull/hat atlas.
  const decor = nation === "nubian" ? createNubianDecorMaterials(detailed) : undefined;
  if (decor) {
    Object.assign(materials, decor.materials);
    owned.push(...Object.values(decor.materials));
  }
  return {
    materials,
    dispose: () => {
      owned.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      decor?.dispose();
    }
  };
};
