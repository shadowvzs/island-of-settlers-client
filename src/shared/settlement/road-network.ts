import { ROAD_SPEED } from "@shared/catalog/balance";

import { ROAD_STONE_COST } from "../balance/economy";
import { type BridgeDeck, bridgeDecks, roadUnderDeck } from "./bridge-deck";
import { isBridgeLatticeEdge, roadEdgeLength } from "./bridge-lattice";
import { bridgeRoadProblem, bridgeTiles, copyBridgeTile } from "./bridge-road";
import { findRoadConstructionPath } from "./road-construction-path";
import { createRoadLengthFields } from "./road-length-field";
import { findRoadPath } from "./road-pathfinding";
import { isRoadVergeClear, parallelRoadConflict } from "./road-reserved-strip";
import { roadIntersectsVisibleRock } from "./road-rock-footprints";
import { createRoadComponents, createRoadRouteCache } from "./road-route-cache";
import { createRoadSpeedLookup } from "./road-speed";
import { createRoadTraversal } from "./road-traversal";
import {
  type BridgeTile, isRoadTier, isRoadVergeKind, nextRoadTier, type OccupancyChanges, ROAD_GRID_STEP,
  ROAD_STONE_WIDTH, ROAD_TIER_WIDTH, ROAD_TIERS, type RoadNetwork, type RoadNetworkOptions, type RoadPlan,
  type RoadPoint,
  type RoadRouteMetrics, type RoadRouteSearch, type RoadSegment, type RoadUpgradePayment,
  type RoadUpgradeTier, type RoadWorld
} from "./road-types";
import { createWalkabilityRecheck } from "./road-walkability-recheck";

export * from "./road-types";

const sameBridgeTile = (a: BridgeTile | undefined, b: BridgeTile | undefined) =>
  a === b || Boolean(a && b && a.id === b.id && a.kind === b.kind && a.width === b.width &&
    a.tile === b.tile && a.tiles === b.tiles && a.level === b.level && a.closed === b.closed);

const detachEdge = (
  edges: Map<number, RoadSegment>, adjacency: Map<number, Map<number, RoadSegment>>,
  a: number, b: number, key: number
) => {
  if (!edges.delete(key)) return false;
  adjacency.get(a)?.delete(b);
  adjacency.get(b)?.delete(a);
  if (!adjacency.get(a)?.size) adjacency.delete(a);
  if (!adjacency.get(b)?.size) adjacency.delete(b);
  return true;
};

/** A saved verge is a known decor kind on an ordinary (non-bridge) edge. */
const validVerge = (segment: RoadSegment) =>
  segment.verge === undefined || (isRoadVergeKind(segment.verge) && !segment.bridge);

/** Detached copy of one graph edge with its saved fields only. */
const copyGraphSegment = (segment: RoadSegment): RoadSegment => ({
  start: { ...segment.start },
  end: { ...segment.end },
  tier: segment.tier,
  ...(segment.bridge ? { bridge: copyBridgeTile(segment.bridge) } : {}),
  ...(segment.verge ? { verge: segment.verge } : {})
});

/** Removes one ordinary edge or the complete saved bridge group that owns it. */
const detachRoad = (
  edges: Map<number, RoadSegment>, adjacency: Map<number, Map<number, RoadSegment>>,
  a: number, b: number, edgeKeyOf: (a: number, b: number) => number, nodeOf: (point: RoadPoint) => number
) => {
  const segment = edges.get(edgeKeyOf(a, b));
  if (!segment) return false;
  if (!segment.bridge) return detachEdge(edges, adjacency, a, b, edgeKeyOf(a, b));
  let removed = false;
  for (const tile of bridgeTiles([...edges.values()], segment.bridge.id)) {
    const start = nodeOf(tile.start), end = nodeOf(tile.end);
    removed = detachEdge(edges, adjacency, start, end, edgeKeyOf(start, end)) || removed;
  }
  return removed;
};

/** Ordinary roads are unit half-cell steps; a bridge edge is one primitive lattice step of its deck. */
const isValidEdgeShape = (segment: RoadSegment) => {
  if (segment.bridge) return isBridgeLatticeEdge(segment.start, segment.end);
  const dx = Math.abs(segment.start.x - segment.end.x);
  const dz = Math.abs(segment.start.z - segment.end.z);
  return Math.abs(dx + dz - ROAD_GRID_STEP) <= 1e-8 && (dx <= 1e-8 || dz <= 1e-8);
};

/** Sums edge lengths, so a route over an angled bridge reports its actual walked distance. */
const routeLength = (points: readonly RoadPoint[]) => {
  let length = 0;
  for (let index = 1; index < points.length; index += 1)
    length += roadEdgeLength(points[index - 1]!, points[index]!);
  return length;
};

/** Completed decks and long angled edges, rebuilt once per graph revision (bridges are few). */
const createBridgeEdgeIndex = (edges: ReadonlyMap<number, RoadSegment>, revision: () => number) => {
  let cached: { decks: BridgeDeck[]; longEdges: RoadSegment[]; revision: number } | undefined;
  const current = () => {
    if (cached?.revision === revision()) return cached;
    const bridges = [...edges.values()].filter(segment => segment.bridge);
    cached = {
      decks: bridgeDecks(bridges),
      // Longer than the half-cell probes of the speed lookup.
      longEdges: bridges.filter(segment => roadEdgeLength(segment.start, segment.end) > ROAD_GRID_STEP),
      revision: revision()
    };
    return cached;
  };
  return {
    /** A new road step may join a deck at its anchor, but never run under or across the deck. */
    crossesDeck: (start: RoadPoint, end: RoadPoint) =>
      current().decks.some(deck => roadUnderDeck(deck, [{ end, start }])),
    longEdges: () => current().longEdges
  };
};

/** Retain edge/adjacency identity and choose every target from the same pre-mutation snapshot. */
const raiseSelectedRoadTiers = (edges: ReadonlyMap<number, RoadSegment>,
  allowed: (segment: Readonly<RoadSegment>) => boolean, changed: () => void) => {
  const changes = [...edges.values()].flatMap(segment => {
    const tier = nextRoadTier(segment.tier);
    if (!tier || segment.bridge || segment.doorway || segment.preview || !allowed(segment)) return [];
    return [{ segment, tier }];
  });
  for (const { segment, tier } of changes) segment.tier = tier;
  if (changes.length) changed();
  return changes.length;
};

/**
 * Whether `replacement` rebuilds exactly the current network: the same edges and tiers in the same order and the
 * same neighbour order at every node, so every route search over it gives the same result.
 */
const isSameRoadLayout = (
  edges: ReadonlyMap<number, RoadSegment>, adjacency: ReadonlyMap<number, ReadonlyMap<number, RoadSegment>>,
  replacement: ReadonlyMap<number, RoadSegment>, node: (point: RoadPoint) => number
) => {
  if (edges.size !== replacement.size) return false;
  const current = edges.entries();
  const rebuilt = new Map<number, number[]>();
  for (const [key, segment] of replacement) {
    const [currentKey, currentSegment] = current.next().value!;
    if (key !== currentKey || segment.tier !== currentSegment.tier || segment.verge !== currentSegment.verge ||
      !sameBridgeTile(segment.bridge, currentSegment.bridge)) return false;
    const a = node(segment.start), b = node(segment.end);
    if (!rebuilt.has(a)) rebuilt.set(a, []);
    if (!rebuilt.has(b)) rebuilt.set(b, []);
    rebuilt.get(a)!.push(b); rebuilt.get(b)!.push(a);
  }
  if (rebuilt.size !== adjacency.size) return false;
  const nodes = adjacency.entries();
  for (const [a, neighbours] of rebuilt) {
    const [currentNode, currentNeighbours] = nodes.next().value!;
    if (a !== currentNode || neighbours.length !== currentNeighbours.size) return false;
    let index = 0;
    for (const b of currentNeighbours.keys()) if (neighbours[index++] !== b) return false;
  }
  return true;
};

/** Original square-grid road graph. Failed construction/upgrades never partially mutate it. */
export const createRoadNetwork = (
  world: RoadWorld,
  options: RoadNetworkOptions = {}
): RoadNetwork => {
  const edges = new Map<number, RoadSegment>();
  const adjacency = new Map<number, Map<number, RoadSegment>>();
  const traversal = createRoadTraversal(world, options);
  const { blocked, estimate, node, point, validPoint, walkable } = traversal;
  // Route travel keeps its slope test and the dirt corridor, so old towns stay routable. Construction
  // can grade an otherwise clear corridor but must keep the full stone width clear from the start.
  const reservedTraversal = createRoadTraversal(world,
    options.validateGradedRoads ? { ...options, getHeight: () => 0 } : options, ROAD_STONE_WIDTH);
  let revision = 0;
  let occupancyRevision = options.occupancyRevision;
  const nodeSpan = (world.cellsX * 2 + 1) * (world.cellsZ * 2 + 1);
  // An explicit verification (tests) is strict; the development default only reports stale entries.
  const routeCache = createRoadRouteCache(options.verifyRouteCache ?? (import.meta.env?.DEV ? 64 : 0),
    options.verifyRouteCache !== undefined);
  const walkabilityRecheck = createWalkabilityRecheck(world, nodeSpan, point, walkable);
  const components = createRoadComponents();
  // A live blocker without a revision could change silently: such networks never memoize.
  const memoizes = () => !options.isBlocked || occupancyRevision !== undefined;
  /** A numeric edge key (exact below 2^53 for any island); the map keeps insertion order as before. */
  const edgeKey = (a: number, b: number) => Math.min(a, b) * nodeSpan + Math.max(a, b);
  const hasEdge = (a: RoadPoint, b: RoadPoint) =>
    validPoint(a) && validPoint(b) && edges.has(edgeKey(node(a), node(b)));
  const bridgeEdges = createBridgeEdgeIndex(edges, () => revision);
  /** Built edges stay usable; a new step keeps its reserved strip clear of obstacles and parallel roads. */
  const constructionTraversal = {
    ...reservedTraversal,
    walkable: (start: RoadPoint, end: RoadPoint) => hasEdge(start, end) ||
      (reservedTraversal.walkable(start, end) && isRoadVergeClear(start, end, options.isBlocked, validPoint) &&
        !parallelRoadConflict(start, end, hasEdge) &&
        !options.isStripReserved?.(start, end) &&
        !roadIntersectsVisibleRock(world, start, end, ROAD_STONE_WIDTH) &&
        !bridgeEdges.crossesDeck(start, end))
  };
  const terrainWalkable = (from: number, to: number, fresh: boolean) => fresh ? walkable(point(from), point(to))
    : routeCache.walkable(from * nodeSpan + to, () => walkable(point(from), point(to)));
  /** One travel step of a route search (and of a length field) from `from` to `to`. */
  const isTravelEdge = (from: number, to: number, segment: RoadSegment, fresh: boolean, stoneOnly: boolean) => {
    // Completed bridge decks carry ordinary land traffic; hand carts also accept a wood deck.
    if (stoneOnly && segment.tier === "dirt" && !segment.bridge) return false;
    // A bridge awaiting removal takes no new journeys (people already on it finish their path).
    if (segment.bridge?.closed) return false;
    return Boolean(segment.bridge) || terrainWalkable(from, to, fresh);
  };
  const synchronizeRoutes = () => routeCache.synchronize(revision, occupancyRevision?.() ?? 0,
    world.terrainRevision ?? 0, world.buildRevision ?? 0, walkabilityRecheck.recheck);
  const runSearch = (
    first: number, last: number, speedWeighted: boolean, fresh: boolean, stoneOnly = false
  ): RoadRouteSearch => {
    const result = findRoadPath(
      first,
      last,
      (current, visit) => {
        for (const [next, segment] of adjacency.get(current) ?? []) {
          if (!isTravelEdge(current, next, segment, fresh, stoneOnly)) continue;
          const length = segment.bridge ? roadEdgeLength(segment.start, segment.end) : ROAD_GRID_STEP;
          visit(next, length / (speedWeighted ? ROAD_SPEED[segment.tier] : 1));
        }
      },
      estimate(point(last), speedWeighted ? ROAD_SPEED.granite : 1)
    );
    if (result.status !== "found") return { status: result.status, route: null };
    const points = result.path.map(point);
    return { status: "found", route: { points, cost: result.cost, length: routeLength(points) } };
  };
  const noRoute = (): RoadRouteSearch => ({ status: "no-path", route: null });
  const noRouteMetrics = (): RoadRouteMetrics => ({ status: "no-path", route: null });
  const summarize = (search: RoadRouteSearch): RoadRouteMetrics => search.route
    ? { status: search.status, route: { cost: search.route.cost, length: search.route.length } }
    : { status: search.status, route: null };
  const findRoute = (
    start: RoadPoint, end: RoadPoint, speedWeighted: boolean, stoneOnly = false
  ): RoadRouteSearch => {
    if (!validPoint(start) || !validPoint(end)) return noRoute();
    const first = node(start),
      last = node(end);
    if (!adjacency.has(first) || !adjacency.has(last)) return noRoute();
    if (first === last) return { status: "found", route: { points: [point(first)], cost: 0, length: 0 } };
    if (!components.connected(adjacency, revision, first, last)) return noRoute();
    // Only travel routing repeats; upgrade planning is a rare UI query and stays uncached.
    if (!speedWeighted || !memoizes()) {
      routeCache.countUncached();
      return runSearch(first, last, speedWeighted, true, stoneOnly);
    }
    synchronizeRoutes();
    // Stone-only (hand-cart) searches live in their own key range above every carrier pair.
    const key = (stoneOnly ? nodeSpan * nodeSpan : 0) + first * nodeSpan + last;
    return routeCache.search(key, (fresh) => runSearch(first, last, true, fresh, stoneOnly));
  };
  const searchRoute = (start: RoadPoint, end: RoadPoint) => findRoute(start, end, true);
  const route = (start: RoadPoint, end: RoadPoint) => searchRoute(start, end).route;
  /** Same search and cache as `route`, skipping the points copy that logistics sorting never reads. */
  const routeMetrics = (start: RoadPoint, end: RoadPoint): RoadRouteMetrics => {
    if (!validPoint(start) || !validPoint(end)) return noRouteMetrics();
    const first = node(start),
      last = node(end);
    if (!adjacency.has(first) || !adjacency.has(last)) return noRouteMetrics();
    if (first === last) return { status: "found", route: { cost: 0, length: 0 } };
    if (!components.connected(adjacency, revision, first, last)) return noRouteMetrics();
    if (!memoizes()) {
      routeCache.countUncached();
      return summarize(runSearch(first, last, true, true));
    }
    synchronizeRoutes();
    const key = first * nodeSpan + last;
    return routeCache.metrics(key, (fresh) => runSearch(first, last, true, fresh));
  };
  const lengthField = createRoadLengthFields({ adjacency, field: routeCache.field, memoizes, node, point,
    synchronize: synchronizeRoutes, usable: (from, to, segment) => isTravelEdge(from, to, segment, false, false),
    validPoint });
  /** Hand carts travel only over committed stone edges. */
  const stoneRoute = (start: RoadPoint, end: RoadPoint) => findRoute(start, end, true, true).route;
  // Upgrade selection follows the shortest existing road, independent of travel speed.
  const planUpgrade = (start: RoadPoint, end: RoadPoint, targetTier?: RoadUpgradeTier,
    buildingFlags: readonly RoadPoint[] = []) => {
    const path = findRoute(start, end, false).route;
    if (!path || path.points.length < 2) return null;
    const current = path.points.slice(1).map((end, index) =>
      edges.get(edgeKey(node(path.points[index]!), node(end)))!);
    // A bridge is a distinct material choice, not a dirt road waiting for a stone upgrade.
    if (current.some(edge => edge.bridge)) return null;
    const weakest = current.reduce((tier, edge) =>
      ROAD_TIERS.indexOf(edge.tier) < ROAD_TIERS.indexOf(tier) ? edge.tier : tier, current[0]!.tier);
    const target = targetTier ?? nextRoadTier(weakest);
    if (!target || !isRoadTier(target) || ROAD_TIERS.indexOf(target) === 0 ||
      current.some(edge => ROAD_TIERS.indexOf(edge.tier) < ROAD_TIERS.indexOf(target) - 1)) return null;
    const segments = current.map(edge => ({ ...edge,
      tier: ROAD_TIERS.indexOf(edge.tier) < ROAD_TIERS.indexOf(target) ? target : edge.tier }));
    const junctionTiers = new Map<number, RoadSegment["tier"]>();
    for (const segment of segments) for (const endpoint of [segment.start, segment.end]) {
      const id = node(endpoint), previous = junctionTiers.get(id);
      if (previous === undefined || ROAD_SPEED[segment.tier] > ROAD_SPEED[previous]) junctionTiers.set(id, segment.tier);
    }
    const included = new Set(current.map(edge => edgeKey(node(edge.start), node(edge.end))));
    for (const flag of buildingFlags) {
      if (!validPoint(flag) || junctionTiers.has(node(flag))) continue;
      for (const [neighbor, edge] of adjacency.get(node(flag)) ?? []) {
        const tier = junctionTiers.get(neighbor), key = edgeKey(node(flag), neighbor);
        // A half-cell flag connector lies within the upgraded junction's surface. It inherits
        // that surface; longer approaches and other branches remain individually upgradeable.
        if (tier === undefined || included.has(key) || ROAD_SPEED[edge.tier] >= ROAD_SPEED[tier] ||
          ROAD_GRID_STEP > ROAD_TIER_WIDTH[tier] / 2) continue;
        segments.push({ ...edge, tier }); included.add(key);
      }
    }
    return { points: path.points, segments };
  };
  /** Verge planting follows the same shortest existing road as an upgrade, without any tier rule. */
  const planStretch = (start: RoadPoint, end: RoadPoint) => {
    const path = findRoute(start, end, false).route;
    if (!path || path.points.length < 2) return null;
    return path.points.slice(1).map((end, index) =>
      copyGraphSegment(edges.get(edgeKey(node(path.points[index]!), node(end)))!));
  };
  const completeEndpoint = (endpoint: RoadPoint, inward: RoadPoint, planned: Set<number>) => {
    if (adjacency.has(node(endpoint))) return null;
    const candidates = [
      { x: endpoint.x + ROAD_GRID_STEP, z: endpoint.z },
      { x: endpoint.x, z: endpoint.z + ROAD_GRID_STEP },
      { x: endpoint.x - ROAD_GRID_STEP, z: endpoint.z },
      { x: endpoint.x, z: endpoint.z - ROAD_GRID_STEP }
    ];
    const outwardScore = (candidate: RoadPoint) =>
      (candidate.x - endpoint.x) * (endpoint.x - inward.x) +
      (candidate.z - endpoint.z) * (endpoint.z - inward.z);
    candidates.sort((a, b) => outwardScore(b) - outwardScore(a));
    return candidates.find(candidate => validPoint(candidate) &&
      !planned.has(node(candidate)) && adjacency.has(node(candidate)) &&
      constructionTraversal.walkable(endpoint, candidate)) ?? null;
  };
  const planRoad = (start: RoadPoint, end: RoadPoint) => {
    if (!validPoint(start) || !validPoint(end)) return null;
    const first = node(start),
      last = node(end);
    if (
      first === last ||
      blocked(point(first).x, point(first).z) ||
      blocked(point(last).x, point(last).z)
    )
      return null;
    const result = findRoadConstructionPath(first, last, constructionTraversal);
    if (!result) return null;
    const points = result.path.map(point);
    // Complete only one missing public-road section at each end, without moving the chosen anchors.
    const planned = new Set(result.path);
    const before = completeEndpoint(points[0]!, points[1]!, planned);
    if (before) { points.unshift(before); planned.add(node(before)); }
    const after = completeEndpoint(points.at(-1)!, points.at(-2)!, planned);
    if (after) points.push(after);
    const plan = { points, segments: points.slice(1).map((end, index) => ({
      start: points[index]!, end,
      tier: edges.get(edgeKey(node(points[index]!), node(end)))?.tier ?? "dirt"
    })) };
    if (options.validateGradedRoads && !options.validateGradedRoads(plan.segments, [...edges.values()]))
      return null;
    return plan;
  };
  /** Adds the missing edges of a dirt road plan of this network (`planRoad`'s points, unchanged since). */
  const addPlannedRoad = (plan: Pick<RoadPlan, "points">) => {
    let changed = false;
    for (let index = 1; index < plan.points.length; index++) {
      const a = node(plan.points[index - 1]!),
        b = node(plan.points[index]!);
      const key = edgeKey(a, b);
      if (edges.has(key)) continue;
      const segment: RoadSegment = { start: point(a), end: point(b), tier: "dirt" };
      edges.set(key, segment);
      if (!adjacency.has(a)) adjacency.set(a, new Map());
      if (!adjacency.has(b)) adjacency.set(b, new Map());
      adjacency.get(a)!.set(b, segment);
      adjacency.get(b)!.set(a, segment);
      changed = true;
    }
    if (changed) revision++;
    return true;
  };
  const addRoad = (start: RoadPoint, end: RoadPoint) => {
    const plan = planRoad(start, end);
    return plan ? addPlannedRoad(plan) : false;
  };
  const inheritBuildingFlagTiers = (buildingFlags: readonly RoadPoint[]) => {
    const changes = new Map<RoadSegment, RoadSegment["tier"]>();
    for (const flag of buildingFlags) {
      if (!validPoint(flag)) continue;
      for (const [neighbor, connector] of adjacency.get(node(flag)) ?? []) {
        if (connector.bridge) continue;
        let tier = connector.tier;
        // Read committed tiers before applying changes, so inheritance cannot spread down side roads.
        for (const junction of adjacency.get(neighbor)?.values() ?? [])
          if (junction !== connector && ROAD_SPEED[junction.tier] > ROAD_SPEED[tier]) tier = junction.tier;
        if (ROAD_SPEED[tier] > ROAD_SPEED[connector.tier] && ROAD_GRID_STEP <= ROAD_TIER_WIDTH[tier] / 2) {
          const previous = changes.get(connector);
          if (!previous || ROAD_SPEED[tier] > ROAD_SPEED[previous]) changes.set(connector, tier);
        }
      }
    }
    for (const [connector, tier] of changes) connector.tier = tier;
    if (changes.size) revision++;
    return changes.size > 0;
  };
  const removeRoad = (start: RoadPoint, end: RoadPoint) => {
    if (!validPoint(start) || !validPoint(end)) return false;
    if (!detachRoad(edges, adjacency, node(start), node(end), edgeKey, node)) return false;
    revision++;
    return true;
  };
  const upgradeRoad = (start: RoadPoint, end: RoadPoint, pay: RoadUpgradePayment, targetTier?: RoadUpgradeTier,
    buildingFlags: readonly RoadPoint[] = []) => {
    const path = planUpgrade(start, end, targetTier, buildingFlags);
    if (!path) return false;
    const changes = path.segments.map(planned => ({ planned,
      actual: edges.get(edgeKey(node(planned.start), node(planned.end)))! }))
      .filter(({ actual, planned }) => planned.tier !== actual.tier);
    if (!changes.length) return true;
    const selected = new Set(path.points.slice(1).map((end, index) => edgeKey(node(path.points[index]!), node(end))));
    const paved = changes.filter(({ actual }) => selected.has(edgeKey(node(actual.start), node(actual.end))));
    // Inherited flag connectors are the same junction surface, not additional paid road length.
    if (paved.length && !pay(paved.length * ROAD_STONE_COST, paved[0]!.planned.tier as RoadUpgradeTier)) return false;
    for (const { actual, planned } of changes) actual.tier = planned.tier;
    revision++;
    return true;
  };
  const speedAt = createRoadSpeedLookup(probe => validPoint(probe) ? adjacency.get(node(probe)) : undefined,
    bridgeEdges.longEdges);
  const replaceSegments = (segments: readonly RoadSegment[]) => {
    const replacement = new Map<number, RoadSegment>();
    for (const segment of segments) {
      if (!segment || !segment.start || !segment.end || !validPoint(segment.start) || !validPoint(segment.end) ||
        !isRoadTier(segment.tier) ||
        ![segment.start.x, segment.start.z, segment.end.x, segment.end.z]
          .every(value => Number.isInteger(value / ROAD_GRID_STEP))) return false;
      if (!isValidEdgeShape(segment) || !validVerge(segment)) return false;
      const a = node(segment.start), b = node(segment.end), key = edgeKey(a,b);
      if (replacement.has(key)) return false;
      replacement.set(key, { ...copyGraphSegment(segment), start: point(a), end: point(b) });
    }
    if (bridgeRoadProblem([...replacement.values()])) return false;
    // Reloading the network's own snapshot (D3): nothing changes, so revision-keyed caches stay valid.
    if (isSameRoadLayout(edges, adjacency, replacement, node)) return true;
    edges.clear(); adjacency.clear();
    for (const [key, segment] of replacement) {
      const a = node(segment.start), b = node(segment.end);
      edges.set(key, segment);
      if (!adjacency.has(a)) adjacency.set(a, new Map());
      if (!adjacency.has(b)) adjacency.set(b, new Map());
      adjacency.get(a)!.set(b, segment); adjacency.get(b)!.set(a, segment);
    }
    revision++;
    return true;
  };
  return {
    addPlannedRoad,
    addRoad,
    raiseTiersWhere: allowed => raiseSelectedRoadTiers(edges, allowed, () => { revision++; }),
    inheritBuildingFlagTiers,
    lengthField,
    replaceSegments,
    planRoad,
    planStretch,
    planUpgrade,
    removeRoad,
    route,
    routeMetrics,
    routeStats: routeCache.stats,
    searchRoute,
    speedAt,
    stoneRoute,
    trackOccupancy: (revisionSource: () => number, changes?: OccupancyChanges) => {
      occupancyRevision = revisionSource;
      walkabilityRecheck.track(changes);
    },
    upgradeRoad,
    get revision() {
      return revision;
    },
    segments: () => [...edges.values()].map(copyGraphSegment)
  };
};
