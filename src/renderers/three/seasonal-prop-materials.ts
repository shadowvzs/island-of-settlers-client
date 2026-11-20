import type { IUniform, RawShaderMaterial, Vector4 } from "three";

import { getTreeVariants } from "../../render-common/props/island-trees";
import { getMeshKind, getMeshVariant } from "../../render-common/props/prop-meshes";
import {
  getSeasonClass,
  SEASON_CLASS,
  type SeasonClass
} from "../../render-common/seasonal-appearance/season-palettes";
import { PROP } from "../../shared/world/world-data";
import { BROADLEAF, getFormArchetype } from "../../shared/world/tree-forms";
import { createPropDepthMaterial, createPropMaterial } from "./three-prop-materials";

interface SeasonalMaterials {
  depth: RawShaderMaterial;
  main: RawShaderMaterial;
}

/**
 * Vegetation prop materials per season class (A1, D1): one colour and one sun-depth material per class
 * that occurs, created on first use (same programs, their own uSeasonClass); class 0 keeps the plain
 * programs. The depth material is per class because dormant crowns drop their leaves from the shadow too.
 */
export const createSeasonalPropMaterials = (uniforms: Record<string, IUniform>, choppable = false) => {
  const byClass = new Map<SeasonClass, SeasonalMaterials>();
  const forKind = (kind: number) => {
    const seasonClass = getSeasonClass(kind);
    const known = byClass.get(seasonClass);
    if (known) return known;
    const created = {
      depth: createPropDepthMaterial(uniforms, choppable, seasonClass),
      main: createPropMaterial(uniforms, false, choppable, seasonClass)
    };
    byClass.set(seasonClass, created);
    return created;
  };
  return { forKind };
};

/** Dormant weight from which bare broadleaf trees draw their LOD twig levels (core-only presets too). */
const BARE_WOOD_DORMANT = 0.3;

/**
 * D1: true while the crowns are bare enough that their twigs must show. The Minimal core draw keeps
 * only the main limbs (the leaf cards hid the rest), so a bare tree would read as a stick: the full
 * wood (+10-17 % triangles per oak/cherry/walnut, +50 % birch) is drawn while the leaves are discarded.
 */
export const needsBareWoodDetail = (uniforms: Record<string, IUniform>) =>
  ((uniforms.uSeason?.value as Vector4 | undefined)?.y ?? 0) > BARE_WOOD_DORMANT;

/**
 * The season class of a prop mesh for the far sprites (impostors, tree views): the blossoming cherry
 * form of the broadleaf tree is cherry (the 3D crowns read it from their atlas uv instead).
 */
export const getMeshSeasonClass = (meshId: number): SeasonClass => {
  const kind = getMeshKind(meshId);
  if (kind !== PROP.broadleafTree) return getSeasonClass(kind);
  const form = getTreeVariants(kind)[getMeshVariant(meshId)]?.form ?? 0;
  return getFormArchetype(form) === BROADLEAF.cherry ? SEASON_CLASS.cherry : SEASON_CLASS.oak;
};
