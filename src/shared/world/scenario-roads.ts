import { bridgeRoadProblem } from "../settlement/bridge-road";
import { isRoadTier, type RoadSegment } from "../settlement/road-types";

/** Authored initial public edges; runtime road ownership belongs to settlement saves. */
export const MAX_SCENARIO_ROADS = 8192;
export const validScenarioRoads = (value: unknown, width: number, height: number): value is RoadSegment[] | undefined => {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_SCENARIO_ROADS) return false;
  const keys = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !isRoadTier(entry.tier)) return false;
    const { end, start } = entry;
    if (![start, end].every(point => point && Number.isFinite(point.x) && Number.isFinite(point.z) &&
      point.x >= 0 && point.z >= 0 && point.x <= width && point.z <= height &&
      Number.isInteger(point.x * 2) && Number.isInteger(point.z * 2))) return false;
    const dx = Math.abs(start.x - end.x), dz = Math.abs(start.z - end.z);
    if (dx + dz !== .5 || (dx !== 0 && dz !== 0)) return false;
    const a = `${start.x},${start.z}`, b = `${end.x},${end.z}`;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return bridgeRoadProblem(value as RoadSegment[]) === null;
};
