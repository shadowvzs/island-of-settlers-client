import { SCOUT_SIGHT } from "../balance/vision";
import { DMath } from "../math/deterministic-math";
import { FOG, type WorldData } from "../world/world-data";
import { isFiniteNumber, isSaveInteger, isSaveObject } from "./save-validation";
import { isNavigationClear, searchGroundPath } from "./settlement-navigation";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

export const SCOUT_DISTANCE_LIMIT = 24;
export const SCOUT_LEG_LIMIT = 6;
export const SCOUT_LOOK_SECONDS = 4;
/** Six tiles beyond the Scout's own sight (A13 phase 2: sight 18), as the 18-tile look over the old 12. */
const LOOKAHEAD = SCOUT_SIGHT + 6, MAX_VISITS = 512;
export interface ScoutExploration {
  distance: number;
  legDistance: number;
  visited: number[];
}
export const scoutCell = (world: WorldData, point: SettlementPoint) =>
  Math.floor(point.z) * world.cellsX + Math.floor(point.x);
export const isScoutFogTarget = (world: WorldData, point: SettlementPoint) =>
  Number.isFinite(point.x) && Number.isFinite(point.z) && point.x >= 0 && point.z >= 0 &&
  point.x < world.cellsX && point.z < world.cellsZ && world.fog?.[scoutCell(world, point)] === FOG.hidden;

export const scoutPathLength = (start: SettlementPoint, path: readonly SettlementPoint[]) => {
  let length = 0, previous = start;
  for (const point of path) { length += DMath.hypot(point.x - previous.x, point.z - previous.z); previous = point; }
  return length;
};


const prefix = (origin: SettlementPoint, path: readonly SettlementPoint[], budget: number) => {
  const result: SettlementPoint[] = [];
  let previous = origin, remaining = budget;
  for (const point of path) {
    const distance = DMath.hypot(point.x - previous.x, point.z - previous.z);
    if (distance > remaining) {
      result.push({ x: previous.x + (point.x - previous.x) * remaining / distance,
        z: previous.z + (point.z - previous.z) * remaining / distance });
      break;
    }
    result.push(point); remaining -= distance; previous = point;
    if (remaining < 1e-7) break;
  }
  return result;
};

/** Look beyond the Scout's own sight, then walk only a six-tile prefix of a proven ground route. */
export const nextScoutLeg = (context: SettlementContext, origin: SettlementPoint, state: ScoutExploration) => {
  const budget = Math.min(SCOUT_LEG_LIMIT, SCOUT_DISTANCE_LIMIT - state.distance);
  if (budget < .05 || state.visited.length >= 64) return null;
  const { world } = context.options;
  const points: SettlementPoint[] = [];
  for (let z = Math.max(0, Math.floor(origin.z) - LOOKAHEAD); z <= Math.min(world.cellsZ - 1, origin.z + LOOKAHEAD); z++)
    for (let x = Math.max(0, Math.floor(origin.x) - LOOKAHEAD); x <= Math.min(world.cellsX - 1, origin.x + LOOKAHEAD); x++) {
      const point = { x: x + .5, z: z + .5 }, distance = DMath.hypot(point.x - origin.x, point.z - origin.z);
      if (distance >= .5 && distance <= LOOKAHEAD) points.push(point);
    }
  // The simulation's own fog (A13 phase 2): hidden cells are the ones no player sight ever explored.
  const visited = new Set(state.visited);
  const rotation = (Math.imul((world.seed ?? 0) ^ state.visited.length, 0x85ebca6b) >>> 0) % 8;
  const directions: { point: SettlementPoint; distance: number }[][] = Array.from({ length: 8 }, () => []);
  points.forEach(point => {
    if (!isScoutFogTarget(world, point) || visited.has(scoutCell(world, point)) || !isNavigationClear(context, point))
      return;
    const angle = DMath.atan2(point.x - origin.x, point.z - origin.z);
    const direction = (Math.round(angle * 4 / Math.PI) + 8) % 8;
    directions[direction]!.push({ point, distance: DMath.hypot(point.x - origin.x, point.z - origin.z) });
  });
  for (const direction of directions) direction.sort((a, b) => a.distance - b.distance ||
    a.point.z - b.point.z || a.point.x - b.point.x);
  let visits = 0;
  for (let rank = 0; rank < 2; rank++) for (let offset = 0; offset < 8; offset++) {
    const candidate = directions[(offset + rotation) % 8]![rank];
    if (!candidate || visits >= MAX_VISITS) continue;
    const search = searchGroundPath(context, origin, candidate.point, undefined, undefined, .5, MAX_VISITS - visits);
    visits += search.visits;
    if (!search.path || scoutPathLength(origin, search.path) > LOOKAHEAD + 1e-7) continue;
    const path = prefix(origin, search.path, budget);
    const length = scoutPathLength(origin, path);
    if (length < .05) continue;
    return { length, path, target: path.at(-1)!, visits };
  }
  return null;
};

export const validScoutExploration = (value: unknown, actor: SettlementActor, world: WorldData) => {
  if (!isSaveObject(value) || !isFiniteNumber(value.distance) || value.distance < 0 ||
    value.distance > SCOUT_DISTANCE_LIMIT + 1e-6 || !isFiniteNumber(value.legDistance) ||
    value.legDistance < 0 || value.legDistance > SCOUT_LEG_LIMIT + 1e-6 ||
    value.legDistance > value.distance + 1e-6 || !Array.isArray(value.visited) ||
    !value.visited.length || value.visited.length > 64 ||
    !value.visited.every(cell => isSaveInteger(cell) && cell < world.cellsX * world.cellsZ) ||
    new Set(value.visited).size !== value.visited.length || actor.job !== "Scout" || actor.tool !== "spyglass") return false;
  if (actor.phase === "assigned" && (value.distance !== 0 || value.legDistance !== 0)) return false;
  if (actor.phase === "surveyWork" && (actor.action !== "work" || actor.timer < 0 || actor.timer > SCOUT_LOOK_SECONDS))
    return false;
  if (actor.phase === "surveyWalk") {
    const remaining = scoutPathLength(actor, actor.path.slice(actor.pathIndex));
    // Traffic can add a sidestep; runtime distance caps stop the leg before either budget is exceeded.
    if (remaining > SCOUT_LEG_LIMIT + 1e-6) return false;
  }
  return ["assigned", "surveyWalk", "surveyWork", "surveyReturnWait"].includes(actor.phase);
};
