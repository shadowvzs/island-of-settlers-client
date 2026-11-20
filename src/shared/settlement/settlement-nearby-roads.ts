import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { DMath } from "../math/deterministic-math";
import { STORAGE_IDS } from "./production-rules";
import { hasRoadRoute } from "./road-route-helpers";
import { ownerOf, PLAYER_FACTION, servesEconomyOf } from "./settlement-ownership";
import { isRoadWorkShell, type SettlementContext, type SettlementPoint } from "./settlement-types";

/**
 * Only short, legal entrance links; never invent long roads or traverse another plot. Floods from the
 * storages serving `owner` and links only that owner's buildings.
 */
export const connectNearbyBuildingEntrances = (
  context: SettlementContext,
  connect: (from: SettlementPoint, to: SettlementPoint) => unknown,
  owner = PLAYER_FACTION
) => {
  const roads = context.options.roads;
  if (!roads.segments || !roads.planRoad) return;
  const nodes = new Map<string, SettlementPoint>();
  const key = (point: SettlementPoint) => `${point.x}:${point.z}`;
  const edges = new Map<string, Set<string>>();
  const addEdge = (a: SettlementPoint, b: SettlementPoint) => {
    for (const [from, to] of [
      [a, b],
      [b, a]
    ]) {
      const id = key(from!),
        neighbors = edges.get(id) ?? new Set<string>();
      nodes.set(id, from!);
      neighbors.add(key(to!));
      edges.set(id, neighbors);
    }
  };
  for (const segment of roads.segments()) addEdge(segment.start, segment.end);
  const connected = new Set<string>();
  const flood = (seeds: string[]) => {
    while (seeds.length) {
      const id = seeds.pop()!;
      if (connected.has(id) || !nodes.has(id)) continue;
      connected.add(id);
      seeds.push(...(edges.get(id) ?? []));
    }
  };
  flood(
    context.buildings
      .filter((building) => building.construction === 1 && STORAGE_IDS.has(building.typeId) &&
        servesEconomyOf(context, building, owner))
      .map((building) => key(building.access))
  );
  if (!nodes.size) return;
  for (const building of context.buildings) {
    if (
      isRoadWorkShell(building) ||
      ownerOf(building) !== owner ||
      isOpenArcherTower(building) ||
      connected.has(key(building.access))
    )
      continue;
    const from = building.access;
    const candidates: SettlementPoint[] = [];
    for (let dz = -1; dz <= 1; dz += 0.5)
      for (let dx = -1; dx <= 1; dx += 0.5) {
        if (DMath.hypot(dx, dz) > 1 + 1e-8) continue;
        const point = nodes.get(key({ x: from.x + dx, z: from.z + dz }));
        if (point && key(point) !== key(from)) candidates.push(point);
      }
    candidates.sort(
      (a, b) =>
        Number(connected.has(key(b))) - Number(connected.has(key(a))) ||
        DMath.hypot(a.x - from.x, a.z - from.z) - DMath.hypot(b.x - from.x, b.z - from.z)
    );
    for (const to of candidates) {
      if (nodes.has(key(from)) && hasRoadRoute(roads, from, to)) continue;
      const plan = roads.planRoad(from, to);
      if (!plan) continue;
      const length = plan.points
        .slice(1)
        .reduce(
          (total, point, index) =>
            total + DMath.hypot(point.x - plan.points[index]!.x, point.z - plan.points[index]!.z),
          0
        );
      if (length > 1.5 || !connect(from, to)) continue;
      for (let index = 1; index < plan.points.length; index++)
        addEdge(plan.points[index - 1]!, plan.points[index]!);
      if (connected.has(key(to))) flood([key(from)]);
      break;
    }
  }
  roads.inheritBuildingFlagTiers?.(context.buildings.filter(building =>
    !isRoadWorkShell(building) && ownerOf(building) === owner && !isOpenArcherTower(building))
    .map(building => building.access));
};
