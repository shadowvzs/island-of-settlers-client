import { Box3, type BufferGeometry, type Mesh, type Object3D, type Scene } from "three";

import type { BuildingFrame } from "../../../render-common/buildings/building-catalog";
import type { createBuildingUpgradeStock } from "../settlement/building-upgrade-stock";
import type { createConstructionPlan } from "../settlement/construction-plan";
import type { createBuildingBurnEffects } from "./building-burn-effects";
import type { createBuildingShadowCaster } from "./building-shadows";
import type { createFortSiegeFires } from "./building-siege-fire";
import type { createRomanBuilding } from "./roman-building";

/**
 * R16a memory ceiling for parked detail variants (the recipe the current zoom does not show): their
 * CPU geometry plus their hidden static-batch copy. Past it, further variants are rebuilt on demand.
 */
export const PARKED_VARIANT_BYTE_LIMIT = 96 * 1024 * 1024;

export type BuildingModel = ReturnType<typeof createRomanBuilding>;

/** Everything built from one detail recipe of a building: switching detail swaps the whole set. */
export type BuildingVariant = {
  burn?: ReturnType<ReturnType<typeof createBuildingBurnEffects>["create"]>;
  /** CPU geometry of the model, its plan and its shadow caster (the parked-variant memory ledger). */
  bytes: number;
  caster: ReturnType<typeof createBuildingShadowCaster>;
  detailed: boolean;
  /**
   * The model was last posed for a finished building. Static batches copy only such a pose: a
   * parked variant posed during construction is re-posed once the building finishes.
   */
  finishedPose?: boolean;
  model: BuildingModel;
  originalScaleY?: number;
  pauseHeight: number;
  plan: ReturnType<typeof createConstructionPlan>;
  siegeFire?: ReturnType<ReturnType<typeof createFortSiegeFires>["create"]>;
  upgradeStock?: ReturnType<typeof createBuildingUpgradeStock>;
};

const geometryBytes = (geometry: BufferGeometry) => {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
  return bytes;
};

/** Unique geometry bytes under `roots` (shared geometry counts once). */
export const ownedGeometryBytes = (roots: readonly Object3D[]) => {
  const seen = new Set<BufferGeometry>();
  let bytes = 0;
  for (const root of roots) root.traverse(object => {
    const geometry = (object as Mesh).isMesh ? (object as Mesh).geometry : undefined;
    if (!geometry || seen.has(geometry)) return;
    seen.add(geometry);
    bytes += geometryBytes(geometry);
  });
  return bytes;
};

/** Pause badge height above the authored model, measured on the fresh, unplaced root. */
export const variantPauseHeight = (type: number, model: BuildingModel) =>
  (type === 7 ? Number(model.root.userData.authoredHeight) : new Box3().setFromObject(model.root).max.y) + .55;

/** Places a variant built off-scene, so its static-batch copy sits where the frame stands. */
export const placeVariant = (variant: BuildingVariant, frame: BuildingFrame) => {
  for (const root of [variant.model.root, variant.plan.root]) {
    root.position.set(frame.x, frame.y, frame.z);
    root.rotation.y = frame.rotation;
  }
  variant.model.root.updateMatrixWorld(true);
};

const variantSceneRoots = (variant: BuildingVariant) => [variant.model.root, variant.plan.root,
  variant.upgradeStock?.root, variant.burn?.root, variant.siegeFire?.root].filter(root => root !== undefined);

export const attachVariant = (scene: Scene, shadowScene: Scene, variant: BuildingVariant) => {
  for (const root of variantSceneRoots(variant)) scene.add(root);
  shadowScene.add(variant.caster.root);
};

export const detachVariant = (scene: Scene, shadowScene: Scene, variant: BuildingVariant) => {
  for (const root of variantSceneRoots(variant)) scene.remove(root);
  shadowScene.remove(variant.caster.root);
};

export const disposeVariant = (scene: Scene, shadowScene: Scene, variant: BuildingVariant) => {
  detachVariant(scene, shadowScene, variant);
  variant.caster.dispose();
  for (const mesh of (variant.model.root.userData.windowMeshes ?? []) as Mesh[])
    mesh.userData.windowGlowMaterial?.dispose();
  variant.model.dispose();
  variant.burn?.dispose();
  variant.siegeFire?.dispose();
  variant.plan.dispose();
  variant.upgradeStock?.dispose();
};

type VariantHolder = { active: BuildingVariant; parked?: BuildingVariant };

/**
 * The parked detail variants and their memory ledger. A holder keeps at most one parked variant
 * (the recipe the zoom does not show); a variant that would exceed the ceiling is disposed instead.
 */
export const createParkedVariants = (scene: Scene, shadowScene: Scene, limit = PARKED_VARIANT_BYTE_LIMIT) => {
  let bytes = 0, count = 0;
  const take = (holder: VariantHolder) => {
    const variant = holder.parked;
    if (!variant) return undefined;
    bytes -= variant.bytes; count--;
    holder.parked = undefined;
    return variant;
  };
  const park = (holder: VariantHolder, variant: BuildingVariant) => {
    if (bytes + variant.bytes > limit) {
      disposeVariant(scene, shadowScene, variant);
      return false;
    }
    holder.parked = variant;
    bytes += variant.bytes; count++;
    return true;
  };
  return {
    hasRoom: () => bytes < limit,
    park,
    /** Draws `next` (built now or taken from the parking) and parks the variant drawn so far. */
    activate: (holder: VariantHolder, next: BuildingVariant) => {
      if (holder.parked === next) take(holder);
      const previous = holder.active;
      detachVariant(scene, shadowScene, previous);
      holder.active = next;
      attachVariant(scene, shadowScene, next);
      park(holder, previous);
    },
    release: (holder: VariantHolder) => {
      const variant = take(holder);
      if (variant) disposeVariant(scene, shadowScene, variant);
    },
    stats: () => ({ buildingParkedBytes: bytes, buildingParkedVariants: count })
  };
};
