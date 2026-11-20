import { DMath } from "../math/deterministic-math";
import { ROAD_TARGET_NODES, ROAD_TARGET_SPACING, ROAD_TARGETS } from "./constants";
import { nearestRoadEndpoints } from "./road-endpoints";
import { hasRoadRoute } from "./road-route-helpers";
import type { RoadPoint } from "./road-types";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Where a new building's flag joins its owner's road network: shared by the debug "build every building" search
 * and the economy AI's build planner.
 */
export interface RoadTargetSearch {
  /** The unplaced draft: its plot and its flag (`access`). */
  draft: Pick<SettlementBuilding, "access" | "depth" | "width" | "x" | "z">;
  /** Flags the search falls back to while the island has no road yet. */
  flags: () => readonly RoadPoint[];
  /** The network's root: a target must reach its flag by road. */
  home: Pick<SettlementBuilding, "access">;
  /** A dirt road plan from the draft's flag to a target, or null (the owner's territory rules). */
  planRoad: (start: RoadPoint, end: RoadPoint) => unknown;
  /** Road nodes tried at most (default `ROAD_TARGETS`). */
  targets?: number;
}

export const samePoint = (first: RoadPoint, second: RoadPoint) => first.x === second.x && first.z === second.z;

export const isLinkedToHome = (context: SettlementContext, home: Pick<SettlementBuilding, "access">,
  point: RoadPoint) => samePoint(point, home.access) || hasRoadRoute(context.options.roads, home.access, point);

/** Runs `plan` while the draft's plot counts as built, so the road planner routes around it. */
export const withReservedPlot = <T>(context: SettlementContext,
  draft: Pick<SettlementBuilding, "depth" | "width" | "x" | "z">, plan: () => T) => {
  const { cellsX } = context.options.world;
  const left = draft.x - draft.width / 2, top = draft.z - draft.depth / 2, reserved: number[] = [];
  for (let z = top; z < top + draft.depth; z++) for (let x = left; x < left + draft.width; x++) {
    const cell = z * cellsX + x;
    if (context.occupied[cell]) continue;
    context.occupied[cell] = 1;
    reserved.push(cell);
  }
  try {
    return plan();
  } finally {
    for (const cell of reserved) context.occupied[cell] = 0;
  }
};

/** Nearest first, skipping nodes within `ROAD_TARGET_SPACING` of an already chosen one. */
const spreadTargets = (nodes: readonly RoadPoint[], count: number) => {
  const chosen: RoadPoint[] = [];
  for (const node of nodes) {
    if (chosen.length === count) break;
    if (chosen.every(other => DMath.hypot(other.x - node.x, other.z - node.z) >= ROAD_TARGET_SPACING))
      chosen.push(node);
  }
  return chosen;
};

/** The nearest road node on the home's network that a dirt road from the draft's flag can reach, or undefined. */
export const findRoadTarget = (context: SettlementContext, search: RoadTargetSearch) => {
  const { draft, flags, home, planRoad, targets = ROAD_TARGETS } = search;
  const segments = context.options.roads.segments?.() ?? [];
  // Route checks run before the reservation: travel routes are cached by occupancy revision.
  const linked = spreadTargets(nearestRoadEndpoints(segments, flags, draft.access, ROAD_TARGET_NODES), targets)
    .filter(point => isLinkedToHome(context, home, point));
  const joined = linked.find(point => samePoint(point, draft.access));
  if (joined) return joined;
  return withReservedPlot(context, draft, () => linked.find(point => planRoad(draft.access, point) !== null));
};
