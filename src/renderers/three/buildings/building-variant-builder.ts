import type { IUniform, MeshBasicMaterial } from "three";

import { type BuildingFrame, getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import type { BuildingLevel } from "../../../render-common/buildings/levels/building-level";
import {
  type EnemyBuildingStyle, enemyBuildingStyleKey
} from "../../../render-common/buildings/themed-neutral-building-style";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { createConstructionPlan } from "../settlement/construction-plan";
import type { ConstructionGround } from "../settlement/construction-site-ground";
import { type BuildingVariant, ownedGeometryBytes, variantPauseHeight } from "./building-detail-variants";
import { connectSunShadowReceivers, createBuildingShadowCaster } from "./building-shadows";
import type { PaintedSurfaces } from "./building-surface-textures";
import { createMonumentSceneAssets, monumentShadowMaterial } from "./monument-building";
import { createNationBuilding } from "./nation-building";
import { createNationBuildingMaterials } from "./nation-building-materials";
import { createNeutralBuilding } from "./neutral-building";
import { createNeutralBuildingMaterials } from "./neutral-building-materials";
import { createRomanMaterials } from "./roman-materials";
import type { PreparedPartGroups } from "./roman-building";
import { createThemedNeutralBuildingMaterials } from "./themed-neutral-building-materials";

/** What a frame asks the model to show, apart from the detail recipe (the camera zoom decides that). */
export type VariantRequest = { breached?: number[]; level: BuildingLevel; nation: WorkerNation; neutral: boolean };

type BuilderOptions = {
  casterMaterial: MeshBasicMaterial;
  constructionGround?: ConstructionGround;
  enemyStyle: EnemyBuildingStyle;
  high: boolean;
  painted?: PaintedSurfaces;
  shadowUniforms: Record<string, IUniform>;
  updateShadows: boolean;
};

/** Authored editor themes override only presentation; runtime frames retain the island style. */
const frameEnemyStyle = (frame: BuildingFrame, fallback: EnemyBuildingStyle, neutral: boolean,
  breached: number[] | undefined): EnemyBuildingStyle | undefined => {
  const style = frame.enemyStyle ?? fallback;
  if (frame.type === 16 && frame.enemyCatapultVariant) return { ...style,
    theme: frame.enemyCatapultVariant === "pirate" ? "tropical" : "forest", variant: frame.enemyCatapultVariant };
  if (neutral && frame.bandit !== undefined) return { ...style,
    bandit: frame.bandit, breachedWalls: breached, enclosure: frame.enemyCampEnclosure };
  return undefined;
};

/**
 * Owns the shared surface material packs and builds one detail variant of a building (model,
 * construction plan, shadow caster) off-scene; the caller places and attaches it.
 */
export const createBuildingVariantBuilder = (options: BuilderOptions) => {
  const { casterMaterial, constructionGround, enemyStyle, high, painted, shadowUniforms } = options;
  let pack: ReturnType<typeof createRomanMaterials> | undefined;
  let neutralPack: ReturnType<typeof createNeutralBuildingMaterials> | undefined;
  const enemyPacks = new Map<string, ReturnType<typeof createThemedNeutralBuildingMaterials>>();
  const nationPacks = new Map<WorkerNation, ReturnType<typeof createNationBuildingMaterials>>();
  const monuments = createMonumentSceneAssets(shadowUniforms);
  /** The shared surface materials of a nation (allocated on first use, also by the placement ghost). */
  const materialsFor = (nation: WorkerNation) => {
    if (!pack) {
      pack = createRomanMaterials(high, undefined, painted);
      connectSunShadowReceivers(Object.values(pack.materials), shadowUniforms);
    }
    if (nation === "roman") return pack.materials;
    let nationPack = nationPacks.get(nation);
    if (!nationPack) {
      nationPack = createNationBuildingMaterials(pack.materials, nation, high, painted);
      connectSunShadowReceivers(Object.values(nationPack.materials), shadowUniforms);
      nationPacks.set(nation, nationPack);
    }
    return nationPack.materials;
  };
  const neutralMaterials = () => {
    if (!neutralPack) {
      neutralPack = createNeutralBuildingMaterials(materialsFor("roman"));
      connectSunShadowReceivers(Object.values(neutralPack.materials), shadowUniforms);
    }
    return neutralPack.materials;
  };
  const themedMaterials = (style: EnemyBuildingStyle) => {
    const key = enemyBuildingStyleKey(style);
    let themed = enemyPacks.get(key);
    if (!themed) {
      themed = createThemedNeutralBuildingMaterials(neutralMaterials(), style, true);
      connectSunShadowReceivers(Object.values(themed.materials), shadowUniforms);
      enemyPacks.set(key, themed);
    }
    return themed.materials;
  };
  const createModel = (frame: BuildingFrame, request: VariantRequest, detailed: boolean,
    prepared?: PreparedPartGroups) => {
    const { breached, level, nation, neutral } = request;
    const nationMaterials = materialsFor(nation);
    const style = frameEnemyStyle(frame, enemyStyle, neutral, breached);
    let materials = neutral ? neutralMaterials() : nationMaterials;
    if (style) materials = themedMaterials(style);
    const definition = getBuildingDefinition(frame.type);
    const model = neutral ? createNeutralBuilding(definition, materials, detailed, style)
      : createNationBuilding(definition, materials, nation, detailed, level, prepared);
    model.fitToGrid();
    if (frame.type === 7) monuments.watch(model.root, nation, detailed);
    return { materials, model };
  };
  /** `prepared`: the model's merged geometry from the building recipe worker, if any. */
  const create = (frame: BuildingFrame, request: VariantRequest, detailed: boolean,
    prepared?: PreparedPartGroups): BuildingVariant => {
    const { materials, model } = createModel(frame, request, detailed, prepared);
    const plan = createConstructionPlan(getBuildingDefinition(frame.type), detailed, materials, constructionGround,
      request.neutral ? "roman" : request.nation);
    const caster = createBuildingShadowCaster(model.root, monumentShadowMaterial(model.root) ?? casterMaterial,
      options.updateShadows);
    return { bytes: ownedGeometryBytes([model.root, plan.root, caster.root]), caster, detailed, model,
      pauseHeight: variantPauseHeight(frame.type, model), plan };
  };
  return {
    create,
    materialsFor,
    monuments,
    /** Every allocated pack's materials (startup texture uploads). */
    packMaterials: () => [pack?.materials, neutralPack?.materials,
      ...[...enemyPacks.values()].map(themed => themed.materials),
      ...[...nationPacks.values()].map(nationPack => nationPack.materials)],
    dispose: () => {
      monuments.dispose();
      for (const nationPack of nationPacks.values()) nationPack.dispose();
      nationPacks.clear();
      neutralPack?.dispose();
      for (const enemyPack of enemyPacks.values()) enemyPack.dispose();
      enemyPacks.clear();
      neutralPack = undefined;
      pack?.dispose();
    }
  };
};
