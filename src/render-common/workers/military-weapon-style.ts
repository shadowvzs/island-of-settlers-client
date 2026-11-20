import type { AdventureBanditStyle } from "./adventure-bandit-style";
import type { WorkerNation } from "./worker-nation";

export type RangedWeaponStyle = "bow" | "crossbow" | "javelin";
export type RangedProjectileStyle = "arrow" | "bolt" | "javelin";

/** Equipment appearance never changes the shared troop type, combat timing or recruitment wares. */
export const rangedWeaponStyle = (nation: WorkerNation, bandit?: AdventureBanditStyle): RangedWeaponStyle => {
  if (bandit) return bandit.rangedWeapon;
  if (nation === "maya") return "javelin";
  if (nation === "chinese") return "crossbow";
  return "bow";
};

export const rangedProjectileStyle = (nation: WorkerNation): RangedProjectileStyle => {
  const weapon = rangedWeaponStyle(nation);
  if (weapon === "crossbow") return "bolt";
  if (weapon === "javelin") return "javelin";
  return "arrow";
};

export const hasDualTomahawks = (nation: WorkerNation, type: string) =>
  nation === "indigenous" && type === "heavy";
