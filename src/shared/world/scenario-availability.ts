import {
  type BuildingAvailability, isBuildingAvailability
} from "../../../../island-of-settlers-shared/src/game-settings/building-availability";
import { CAMPAIGN_PROTECTED_BUILDING_TYPES } from
  "../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import { BUILDING_CATALOG } from "../../render-common/buildings/building-catalog";
import { HEADQUARTERS_TYPE_ID } from "../settlement/building-type-ids";

export type { BuildingAvailability };

const CATALOG_IDS = new Set(BUILDING_CATALOG.map(entry => entry.id));
/** The HQ, Harbour and Storehouse are never banned: every map needs a home and storage. */
export const NEVER_BANNED_BUILDINGS: ReadonlySet<number> = new Set([HEADQUARTERS_TYPE_ID, ...CAMPAIGN_PROTECTED_BUILDING_TYPES]);

/** Absent, or well shaped with catalog ids only (bans never touch the HQ, Harbour or Storehouse). */
export const validScenarioAvailability = (value: unknown) => {
  if (value === undefined) return true;
  if (!isBuildingAvailability(value)) return false;
  const banned = value.banned ?? [], caps = value.levelCaps ?? [];
  return banned.every(id => CATALOG_IDS.has(id) && !NEVER_BANNED_BUILDINGS.has(id)) &&
    caps.every(cap => CATALOG_IDS.has(cap.type));
};
