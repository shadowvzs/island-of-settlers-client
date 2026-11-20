import type { WorkerNation } from "../../render-common/workers/worker-unit";
import {
  BUILDING_STRUCTURE_HP, CONSTRUCTION_SITE_HP_SHARE, DESTROYED_SITE_SALVAGE_SHARE, GARRISON_CAPACITIES,
  PLAYER_SUPPORT_MILITARY_TYPE_IDS
} from "../balance/military";
import { getConstructionCost } from "./construction-costs";
import type { MilitaryStructure } from "./fort-assault-rules";
import { isDemolitionProtected, isOwnBuilding, isOwnHeadquarters } from "./settlement-home";
import { type Goods, isRoadWorkShell, type SettlementBuilding } from "./settlement-types";

/**
 * BUILDING-DESTRUCTION phase BD1 (plan review A3, B1, B7, B11; owner 2026-11-09): every building of both
 * sides can be destroyed, except
 * - the player's own headquarters (home island only, never attackable; an enemy HQ is destroyable);
 * - the player's key building (colony home harbour, founding anchor) until BD3 defines the map loss;
 * - roads and bridges, and their work shells (owner Q-BD9).
 * A building counts as destroyed at HP 0, on the fall tick (B7). Garrison buildings, the Academy, the
 * Lodge and hostile camps keep the existing burn-down timeline. BD2 (`settlement-ruin-fall.ts`): a fallen
 * building of an owner with an economy leaves a ruin that the clearing job removes; one of an owner without
 * an economy crumbles after the fort ruin time.
 */
export const isIndestructible = (
  site: Pick<SettlementBuilding, "bridgeSite" | "colonyHome" | "foundingAnchor" | "militaryFaction" | "typeId" |
    "vergeSite">
) => isOwnHeadquarters(site) || (isOwnBuilding(site) && isDemolitionProtected(site)) || isRoadWorkShell(site);

/** A finished garrison building, Academy, Lodge or hostile camp: it burns, collapses and smoulders first. */
export const burnsDownWhenFallen = (
  site: Pick<SettlementBuilding, "bandit" | "construction" | "eventCourtyard" | "typeId">
) => site.construction === 1 && (GARRISON_CAPACITIES[site.typeId] !== undefined ||
  PLAYER_SUPPORT_MILITARY_TYPE_IDS.has(site.typeId) || site.bandit !== undefined || site.eventCourtyard !== undefined);

/** The walls a building takes on its first assault: its type's hit points, a share of them while unfinished. */
export const destructibleWalls = (site: Pick<SettlementBuilding, "construction" | "typeId">):
  MilitaryStructure | undefined => {
  const full = BUILDING_STRUCTURE_HP[site.typeId];
  if (full === undefined) return undefined;
  const maximum = site.construction === 1 ? full : Math.max(1, Math.floor(full * CONSTRUCTION_SITE_HP_SHARE));
  return { hp: maximum, maximum };
};

/**
 * The salvage share of `goods`, rounded down per ware (plan review B8e); wares that round to nothing are left
 * out.
 */
const salvageShare = (goods: Readonly<Goods>) => {
  const kept: Goods = {};
  for (const [ware, count] of Object.entries(goods)) {
    const share = Math.floor(count * DESTROYED_SITE_SALVAGE_SHARE);
    if (share > 0) kept[ware] = share;
  }
  return kept;
};

/**
 * A destroyed construction site keeps only the salvage share of the materials delivered to it (built in or
 * waiting): every delivered ware is taken off the site and the share is returned.
 */
export const takeDestroyedSiteSalvage = (site: Pick<SettlementBuilding, "constructionConsumed" | "input">) => {
  const delivered: Goods = { ...site.input };
  for (const [ware, count] of Object.entries(site.constructionConsumed ?? {}))
    delivered[ware] = (delivered[ware] ?? 0) + count;
  site.constructionConsumed = undefined;
  site.input = {};
  return salvageShare(delivered);
};

/**
 * What a destroyed building's ruin yields (BD2): a construction site the share of what was delivered to it, a
 * finished building the share of its construction cost (never its current stock).
 */
export const ruinSalvage = (
  site: Pick<SettlementBuilding, "construction" | "constructionConsumed" | "input" | "typeId">,
  nation?: WorkerNation
) => site.construction < 1 ? takeDestroyedSiteSalvage(site) : salvageShare(getConstructionCost(site.typeId, nation));
