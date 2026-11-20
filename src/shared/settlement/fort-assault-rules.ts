import { type BanditSiteRef, isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import {
  FORT_COLLAPSE_SECONDS, FORT_RUIN_SECONDS, BUILDING_STRUCTURE_HP, MILITARY_PROFILES, OPEN_SCAFFOLD_STRUCTURE_HP,
  STRUCTURE_DAMAGE_FACTOR
} from "../balance/military";
import { deterministicPow } from "../math/deterministic-math";
import type { MilitaryTroopType } from "./military-combat-rules";

/** A new flame appears for every 20 % of hit points lost. */
export const FORT_FLAME_MILESTONES = 5;

/** A building under direct assault: hit points, and seconds since it fell (0 HP). */
export interface MilitaryStructure { hp: number; maximum: number; fallen?: number }

/** Full walls of a building type (every active type has them since BD1); undefined for unknown types. */
export const buildingStructure = (typeId: number): MilitaryStructure | undefined => {
  const maximum = BUILDING_STRUCTURE_HP[typeId];
  return maximum === undefined ? undefined : { hp: maximum, maximum };
};

/** A hostile site's walls: an open archer scaffold has its own, lower hit points. */
export const siteStructure = (site: { bandit?: BanditSiteRef; typeId: number }) => {
  if (!isOpenArcherTower(site)) return buildingStructure(site.typeId);
  return { hp: OPEN_SCAFFOLD_STRUCTURE_HP, maximum: OPEN_SCAFFOLD_STRUCTURE_HP };
};

/** Flames burning on a damaged fort: one more for every 20 % of its hit points lost (0–5). */
export const fortFlames = (structure: Pick<MilitaryStructure, "hp" | "maximum">) =>
  Math.min(FORT_FLAME_MILESTONES,
    Math.floor((1 - structure.hp / structure.maximum) * FORT_FLAME_MILESTONES + 1e-9));

/**
 * One blow (or arrow) against walls, from the soldier damage rules: profile damage, rank bonus,
 * glancing blows at half and rank-based critical hits; walls have no armour.
 */
export const structureDamage = (attacker: MilitaryTroopType, rank: number, fullContact: boolean,
  random: () => number) => {
  const critical = fullContact && random() < rank * .05;
  const damage = MILITARY_PROFILES[attacker].damage * deterministicPow(1.2, rank) * (fullContact ? 1 : .5);
  return damage * (critical ? 1.5 : 1) * STRUCTURE_DAMAGE_FACTOR;
};

/** Seconds from the fall until the ruin is cleared and the plot is free ground again. */
export const FORT_REMOVAL_SECONDS = FORT_COLLAPSE_SECONDS + FORT_RUIN_SECONDS;

/** Structure validation for saves. */
export const militaryStructureError = (structure: MilitaryStructure | undefined) => structure !== undefined &&
  (!structure || !Number.isFinite(structure.maximum) || structure.maximum <= 0 || !Number.isFinite(structure.hp) ||
    structure.hp < 0 || structure.hp > structure.maximum || (structure.fallen !== undefined &&
      (!Number.isFinite(structure.fallen) || structure.fallen < 0 || structure.hp > 0)));
