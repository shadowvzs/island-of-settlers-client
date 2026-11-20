import { banditCampPlan, type BanditSiteRef } from "../../render-common/buildings/bandit-camp-plan";
import { GARRISON_ARCHER_POSTS, GARRISON_CAPACITIES } from "../balance/military";
import type { MilitaryTroopType } from "./military-combat-rules";

/** Foot troops that may hold a military building; mounted commanders remain field units. */
export type GarrisonTroop = Exclude<MilitaryTroopType, "cavalry">;
export type GarrisonComposition = Record<GarrisonTroop, number>;
export const GARRISON_TROOPS: readonly GarrisonTroop[] = ["shield", "heavy", "archer"];
const MELEE: readonly GarrisonTroop[] = ["shield", "heavy"];

/** Captured small camps keep their physical capacity; larger enemy camps use player limits. */
export const militaryBuildingCapacity = (building: { bandit?: BanditSiteRef; typeId: number }) => {
  const capacity = GARRISON_CAPACITIES[building.typeId] ?? 0;
  if (building.bandit === undefined) return capacity;
  return Math.min(capacity, banditCampPlan(building.bandit).capacity);
};

export const emptyComposition = (): GarrisonComposition => ({ archer: 0, heavy: 0, shield: 0 });

export const isGarrisonTroop = (type: MilitaryTroopType | undefined): type is GarrisonTroop =>
  type === "shield" || type === "heavy" || type === "archer";

export const compositionTotal = (composition: Readonly<GarrisonComposition>) =>
  GARRISON_TROOPS.reduce((sum, type) => sum + composition[type], 0);

/** A manual composition is whole, non-negative and fits the building. */
export const isValidComposition = (typeId: number, composition: unknown): composition is GarrisonComposition => {
  if (!composition || typeof composition !== "object") return false;
  const counts = GARRISON_TROOPS.map(type => (composition as Record<string, unknown>)[type]);
  if (!counts.every(count => Number.isSafeInteger(count) && (count as number) >= 0)) return false;
  if (typeId === 16 && ((composition as GarrisonComposition).archer !== 0 ||
    (compositionTotal(composition as GarrisonComposition) > 0 && (composition as GarrisonComposition).heavy < 1))) return false;
  return compositionTotal(composition as GarrisonComposition) <= (GARRISON_CAPACITIES[typeId] ?? 0);
};

type Available = (type: GarrisonTroop) => boolean;
/** The melee type with stored soldiers; swordsmen first. */
const availableMelee = (available: Available) => MELEE.find(available) ?? null;

/**
 * The troop type a building asks for next; "recruit" when storage holds no fitting soldier but a
 * new swordsman may be trained, null when it is full or nothing fits.
 * Automatic: archers take the tower posts, melee fill the rest; whoever is stored fills the gaps.
 * Manual: exactly the chosen count of each type. `limit` is the player's total cap.
 */
export const nextGarrisonTroop = (
  typeId: number, current: Readonly<GarrisonComposition>, manual: Readonly<GarrisonComposition> | undefined,
  available: Available, limit = GARRISON_CAPACITIES[typeId] ?? 0
): GarrisonTroop | "recruit" | null => {
  if (compositionTotal(current) >= limit) return null;
  if (typeId === 16) {
    if (manual) return MELEE.find(type => current[type] < manual[type] && available(type)) ?? null;
    if (current.heavy < 1 && available("heavy")) return "heavy";
    return availableMelee(available);
  }
  if (manual) {
    const wanted = GARRISON_TROOPS.filter(type => current[type] < manual[type]);
    return wanted.find(available) ?? (wanted.includes("shield") ? "recruit" : null);
  }
  if (current.archer < (GARRISON_ARCHER_POSTS[typeId] ?? 0) && available("archer")) return "archer";
  return availableMelee(available) ?? (available("archer") ? "archer" : "recruit");
};

/**
 * The troop type to send back to storage, if any: soldiers beyond a manual count or the capacity,
 * or (automatic only) a swap: a melee soldier gives way to a stored archer for an empty tower
 * post, and a spare window archer gives way to a stored melee soldier.
 */
export const surplusGarrisonTroop = (
  typeId: number, current: Readonly<GarrisonComposition>, manual: Readonly<GarrisonComposition> | undefined,
  available: Available, limit = GARRISON_CAPACITIES[typeId] ?? 0
): GarrisonTroop | null => {
  if (typeId === 16 && current.archer > 0) return "archer";
  const total = compositionTotal(current), melee = MELEE.find(type => current[type] > 0) ?? null;
  const overflow = melee ?? (current.archer > 0 ? "archer" : null);
  if (manual) {
    const extra = GARRISON_TROOPS.find(type => current[type] > manual[type]);
    return extra ?? (total > limit ? overflow : null);
  }
  const capacity = Math.min(limit, GARRISON_CAPACITIES[typeId] ?? 0);
  if (total > capacity) return overflow;
  if (typeId === 16 && current.heavy < 1 && current.shield > 0 && total >= capacity && available("heavy")) return "shield";
  if (total < capacity) return null;
  const posts = GARRISON_ARCHER_POSTS[typeId] ?? 0;
  if (current.archer < posts && available("archer")) return melee;
  // Spare archers only hold window places until a melee soldier is stored.
  return current.archer > posts && availableMelee(available) ? "archer" : null;
};

/** The Catapult's operator leaves the engine to meet the first doorway attacker. */
export const garrisonDefenderPriority = (typeId: number | undefined, type: MilitaryTroopType | undefined) => {
  if (typeId === 16) return type === "heavy" ? 0 : 1;
  return Number(type === "archer");
};
