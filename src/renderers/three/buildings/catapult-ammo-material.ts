import { type Material, Mesh, type Object3D } from "three";

import { catapultAmmoColor } from "../../../render-common/buildings/catapult-ammo-colors";
import type { CatapultAmmoKind } from "../../../shared/settlement/catapult-ammo-kinds";

const tintedMaterials = new WeakMap<Material, Map<CatapultAmmoKind, Material>>();

/** Reuses one material clone per base material and kind; no per-instance material or draw-call growth. */
export const tintCatapultMaterial = <T extends Material>(base: T, kind: CatapultAmmoKind | undefined): T => {
  const color = catapultAmmoColor(kind);
  if (!color || !kind) return base;
  let variants = tintedMaterials.get(base);
  if (!variants) { variants = new Map(); tintedMaterials.set(base, variants); }
  const known = variants.get(kind);
  if (known) return known as T;
  const material = base.clone() as T;
  (material as Material & { color?: { setRGB: (r: number, g: number, b: number) => void } }).color
    ?.setRGB(color[0]!, color[1]!, color[2]!);
  variants.set(kind, material);
  return material;
};

/** Applies the kind tint to every mesh material under a presented stone object (stone restores). */
export const tintCatapultObject = (object: Object3D, kind: CatapultAmmoKind | undefined) => {
  object.traverse((child) => {
    if (!(child instanceof Mesh) || child.userData.catapultBundle) return;
    const base = (child.userData.catapultBaseMaterial ??= child.material) as Material | Material[];
    child.material = Array.isArray(base)
      ? base.map(material => tintCatapultMaterial(material, kind))
      : tintCatapultMaterial(base, kind);
  });
};
