import { DMath } from "../math/deterministic-math";
import type { ScenarioUnit } from "./map-scenario";

export const MAX_PATROL_POINTS = 8;
export const MAX_SCENARIO_PATROL_POINTS = 256;

/** Closed links include the unit's authored starting position; camp defenders never receive patrols. */
export const scenarioPatrolRoute = (unit: ScenarioUnit) => [
  { x: unit.x, z: unit.z }, ...(unit.patrol ?? [])
];
export const validScenarioPatrols = (units: readonly ScenarioUnit[], width: number, height: number) => {
  let points = 0;
  for (const unit of units) {
    if (unit.patrol === undefined) continue;
    if (!Array.isArray(unit.patrol) || unit.patrol.length > MAX_PATROL_POINTS) return false;
    points += unit.patrol.length;
    if (points > MAX_SCENARIO_PATROL_POINTS) return false;
    const route = scenarioPatrolRoute(unit);
    for (let index = 1; index < route.length; index++) {
      const point = route[index], previous = route[index - 1]!;
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z) ||
        point.x < 0 || point.z < 0 || point.x >= width || point.z >= height ||
        DMath.hypot(point.x - previous.x, point.z - previous.z) < 1) return false;
    }
    if (unit.patrol.length && DMath.hypot(route.at(-1)!.x - unit.x, route.at(-1)!.z - unit.z) < 1) return false;
  }
  return true;
};
