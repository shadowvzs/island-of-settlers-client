import {
  isRoadDecorationItemId, type RoadDecorationItemId
} from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { isSaveObject } from "../settlement/save-validation";
import { isScenarioObjectId } from "./scenario-object-ids";

/**
 * One authored decoration model on the map: its map-file object id, item identity, ground point and yaw
 * (radians). The id comes from the scenario counter (`scenario-object-ids.ts`); a legacy row without one gets
 * it once when the map loads.
 */
export interface ScenarioDecoration {
  id?: number;
  item: RoadDecorationItemId;
  x: number;
  yaw: number;
  z: number;
}

/** Authored decorations per map (an editor bound; runtime decorations belong to settlement saves). */
export const MAX_SCENARIO_DECORATIONS = 4096;
const KEYS = new Set(["id", "item", "x", "yaw", "z"]);

const isScenarioDecoration = (value: unknown, width: number, height: number) => {
  if (!isSaveObject(value) || !Object.keys(value).every(key => KEYS.has(key))) return false;
  const { id, item, x, yaw, z } = value;
  if (id !== undefined && !isScenarioObjectId(id)) return false;
  if (!isRoadDecorationItemId(item)) return false;
  if (typeof x !== "number" || typeof z !== "number" || typeof yaw !== "number") return false;
  if (![x, z, yaw].every(Number.isFinite) || Math.abs(yaw) > Math.PI * 2) return false;
  return x >= 0 && z >= 0 && x < width && z < height;
};

export const validScenarioDecorations = (value: unknown, width: number, height: number):
  value is ScenarioDecoration[] | undefined => {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_SCENARIO_DECORATIONS) return false;
  return value.every(entry => isScenarioDecoration(entry, width, height));
};
