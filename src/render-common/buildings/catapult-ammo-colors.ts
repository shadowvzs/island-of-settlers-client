import type { CatapultAmmoKind } from "../../shared/settlement/catapult-ammo-kinds";
import { STONE_MATERIAL_WARES } from "../wares/advanced-material-variants";

/**
 * Marble's ware tint is neutral white, which on the textured stone material reads exactly like plain
 * stone; the shot multiplies the texture brighter so marble stays clearly lighter (owner 2026-11-08).
 */
const MARBLE_SHOT_TINT = [1.8, 1.78, 1.7] as const;

/** Existing stone-ware tints; plain stone keeps the building's authored stone material colour. */
export const catapultAmmoColor = (kind: CatapultAmmoKind | undefined) => {
  if (kind === undefined || kind === "stone") return undefined;
  if (kind === "marble") return MARBLE_SHOT_TINT;
  return STONE_MATERIAL_WARES[kind].tint;
};
