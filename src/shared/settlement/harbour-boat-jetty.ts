import { getKnownRocks } from "../../render-common/rocks/island-rock-instances";
import { BOAT_JETTY_DECK_WIDTH } from "../../render-common/ships/lighter-dimensions";
import { SAILING_SHIP_OVERALL_BEAM, SAILING_SHIP_OVERALL_LENGTH, SAILING_SHIP_SPACING }
  from "../../render-common/ships/ship-dimensions";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { sameMaskBytes } from "../world/mask-bytes";
import { SLOPE } from "../world/world-data";
import { BOAT_ROUTE_CLEARANCE, BOAT_TURN_RADIUS, type BoatRoutePlanner } from "./harbour-boat-route";
import { shuttleBoatContact } from "./harbour-shuttle-handling";
import { navigationPropRadius, someObstacleInCells } from "./navigation-prop-geometry";
import { roadIntersectsVisibleRock } from "./road-rock-footprints";
import { pointsRect } from "./settlement-charting-object-changes";
import { HARBOUR_LOCAL_SHORE_REACH, HARBOUR_PIER_DECK_WIDTH } from "./settlement-harbour-pier-geometry";
import { inputIdentity } from "./settlement-input-fingerprint";
import { noteInputRead, noteInputSegment } from "./settlement-input-reads";
import { computeReusable, confirmReusable, type ReusableValue } from "./settlement-input-reuse";
import {
  createTileValues, renewChangedTileValues, settleTileValues, tileValue, type TileValues
} from "./settlement-input-tile-values";
import { groundPath } from "./settlement-paths";
import type { ShipObstacle } from "./settlement-ship-clearance";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** A dedicated boat jetty: a short timber board, the boat alongside and the porters' way to it. */
export interface BoatJetty {
  uid: number;
  /** Dry shore foot of the board. */
  foot: SettlementPoint;
  footY: number;
  /** Water end of the board. */
  point: SettlementPoint;
  /** Where the boat lies alongside, clear of sea-ship envelopes and channels. */
  landing: SettlementPoint;
  /** Harbour door → shore foot → board end → boat side. */
  route: SettlementPoint[];
  /** Harbour door → shore foot (the land part of the route). */
  shoreRoute: SettlementPoint[];
}

const JETTY_RADIUS = HARBOUR_LOCAL_SHORE_REACH;
const JETTY_OFFSETS = [2, 2.5, 3, 3.5, 4, 5, 6] as const;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const LINE_SAMPLE = .25;
/** The board stays this far from a ship's rig/hull envelope; the boat needs its turning room too. */
const SHIP_JETTY_MARGIN = .6;
/** A boat route keeps this far from the centreline of a sea ship's approach and departure. */
export const SHIP_LANE_CLEARANCE = SAILING_SHIP_OVERALL_BEAM / 2 + 1.2;
const FOOT_CLEARANCE = SAILING_SHIP_SPACING + .5;

export interface ShipChannel {
  berths: readonly ShipObstacle[];
  lanes: readonly (readonly SettlementPoint[])[];
  /** Existing fixed pier decks; a boat jetty and its route keep clear of them too. */
  piers?: readonly { point: SettlementPoint; shore: SettlementPoint }[];
}
const revisionKey = (context: SettlementContext) => {
  const { world } = context.options;
  return [context.navigationRevision ?? 0, world.buildRevision ?? 0, world.terrainRevision ?? 0, world.props.count,
    getKnownRocks(world).length,
    ...context.buildings.filter(building => building.typeId === 39 && building.construction === 1)
      .flatMap(building => [building.uid, building.workshopUpgrade?.level ?? 0])].join(":");
};
/** Whole tiles round a smoothly sampled height whose vertices the 4×4 Catmull-Rom stencil reads. */
const SMOOTH_READ_REACH = 1;
/** A board's reads: deck-side samples, cells and the trunk query two cells beside the deck. */
const BOARD_READ_REACH = 2;
/** The boat bay's shallow-water samples round the landing. */
const LANDING_READ_REACH = Math.ceil(BOAT_ROUTE_CLEARANCE) + SMOOTH_READ_REACH;
interface JettyEntry extends ReusableValue<BoatJetty | null> {
  /** The harbour door and the sea-ship channels the jetty was searched with. */
  inputs: string;
}
type Approach = SettlementPoint[] | null;
/** A board that passed every check but the porters' way to its foot (searched last, nearest first). */
interface BoardSite {
  footY: number;
  landing: SettlementPoint;
  point: SettlementPoint;
}
/** The board sites of every land foot of one harbour, searched with `inputs` (door and channels). */
interface FootSites {
  inputs: string;
  sites: TileValues<BoardSite[]>;
}
interface JettyCache {
  /**
   * Porter routes from a harbour door to a land foot, each with its own copied inputs: a renewed jetty
   * search reuses the unchanged ones (the ground searches are most of its cost).
   */
  approaches: Map<string, ReusableValue<Approach>>;
  /**
   * PERF-FOLLOWUPS: board sites per harbour and land foot, each renewed only when the terrain it read
   * changed (an edit next to the harbour no longer renews its whole land scan).
   */
  feet: Map<number, FootSites>;
  /** Whole-map inputs (`inputIdentity`); null renews every jetty on each revision. */
  identity: string | null;
  jetties: Map<number, JettyEntry>;
  key: string;
  planner: BoatRoutePlanner;
  /** The boat planner's sea bytes the jetties were searched on (its turning mask derives from them). */
  sea: Uint8Array;
}
const cache = new WeakMap<SettlementContext, JettyCache>();
const channelKeys = new WeakMap<readonly ShipChannel[], string>();
const channelsKey = (channels: readonly ShipChannel[]) => {
  let key = channelKeys.get(channels);
  if (key === undefined) {
    key = JSON.stringify(channels);
    channelKeys.set(channels, key);
  }
  return key;
};

/**
 * JETTY-FRAMES: the jetty cache of a context. A revision move keeps every jetty while the whole-map
 * inputs and the planner's sea are unchanged; each jetty is confirmed against its own copied inputs
 * (`settlement-input-reuse.ts`) when next asked for.
 */
const jettyCacheFor = (context: SettlementContext, planner: BoatRoutePlanner) => {
  const key = revisionKey(context), known = cache.get(context);
  if (known?.key === key && known.planner === planner) return known;
  const identity = inputIdentity(context), sea = planner.sea();
  if (known && identity !== null && known.identity === identity && known.planner === planner &&
    sameMaskBytes(known.sea, sea)) {
    known.key = key;
    return known;
  }
  const fresh: JettyCache = { approaches: new Map(), feet: new Map(), identity, jetties: new Map(), key, planner,
    sea: sea.slice() };
  cache.set(context, fresh);
  return fresh;
};

const distanceToSegment = (point: SettlementPoint, from: SettlementPoint, to: SettlementPoint) => {
  const dx = to.x - from.x, dz = to.z - from.z, length = dx * dx + dz * dz;
  const share = length ? Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.z - from.z) * dz) / length)) : 0;
  return DMath.hypot(point.x - (from.x + dx * share), point.z - (from.z + dz * share));
};
const pointInsideShip = (pose: ShipObstacle, point: SettlementPoint, extra: number) => {
  const dx = point.x - pose.x, dz = point.z - pose.z;
  const along = dx * DMath.sin(pose.yaw) + dz * DMath.cos(pose.yaw);
  const across = dx * DMath.cos(pose.yaw) - dz * DMath.sin(pose.yaw);
  return Math.abs(along) <= SAILING_SHIP_OVERALL_LENGTH / 2 + extra &&
    Math.abs(across) <= SAILING_SHIP_OVERALL_BEAM / 2 + extra;
};
const lineClearOfShips = (from: SettlementPoint, to: SettlementPoint, channels: readonly ShipChannel[]) => {
  const length = DMath.hypot(to.x - from.x, to.z - from.z);
  const samples = Math.max(1, Math.ceil(length / LINE_SAMPLE));
  for (let index = 0; index <= samples; index++) {
    const share = index / samples;
    const point = { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share };
    for (const channel of channels) {
      if (channel.berths.some(berth => pointInsideShip(berth, point, SHIP_JETTY_MARGIN + BOAT_TURN_RADIUS)))
        return false;
      if (channel.lanes.some(lane => lane.some((sample, laneIndex) => laneIndex > 0 &&
        distanceToSegment(point, lane[laneIndex - 1]!, sample) < SHIP_LANE_CLEARANCE))) return false;
      if ((channel.piers ?? []).some(pier =>
        distanceToSegment(point, pier.shore, pier.point) < HARBOUR_PIER_DECK_WIDTH / 2 + .4)) return false;
    }
  }
  return true;
};
export const boatPointClearOfShips = (point: SettlementPoint, channels: readonly ShipChannel[]) =>
  lineClearOfShips(point, point, channels);
/** Berth/rig/pier envelope only: open-water lanes may be crossed with a yield. */
export const boatPointClearOfBerths = (point: SettlementPoint, channels: readonly ShipChannel[]) =>
  channels.every(channel => !channel.berths.some(berth =>
    pointInsideShip(berth, point, SHIP_JETTY_MARGIN + BOAT_TURN_RADIUS)) &&
    !(channel.piers ?? []).some(pier => distanceToSegment(point, pier.shore, pier.point) <
      HARBOUR_PIER_DECK_WIDTH / 2));
const lineClearOfBerths = (from: SettlementPoint, to: SettlementPoint, channels: readonly ShipChannel[]) => {
  const length = DMath.hypot(to.x - from.x, to.z - from.z);
  const samples = Math.max(1, Math.ceil(length / LINE_SAMPLE));
  for (let index = 0; index <= samples; index++) {
    const share = index / samples;
    const point = { x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share };
    if (channels.some(channel => channel.berths.some(berth =>
      pointInsideShip(berth, point, SHIP_JETTY_MARGIN + BOAT_TURN_RADIUS)))) return false;
    if (channels.some(channel => (channel.piers ?? []).some(pier =>
      distanceToSegment(point, pier.shore, pier.point) < HARBOUR_PIER_DECK_WIDTH / 2))) return false;
  }
  return true;
};
/**
 * A boat route keeps out of every sea-ship berth and rig envelope. Open-water approach and departure
 * lanes may be crossed: the boat yields before entering a lane and never stops inside it (see
 * `boatPointNearShipLane`).
 */
export const boatRouteClearOfShips = (route: readonly SettlementPoint[], channels: readonly ShipChannel[]) =>
  route.every((point, index) => lineClearOfBerths(index ? route[index - 1]! : point, point, channels));
/** The point lies in (or beside) a sea ship's approach/departure lane. */
export const boatPointNearShipLane = (point: SettlementPoint, channels: readonly ShipChannel[],
  clearance = SHIP_LANE_CLEARANCE) => channels.some(channel => channel.lanes.some(lane =>
    lane.some((sample, index) => index > 0 && distanceToSegment(point, lane[index - 1]!, sample) < clearance)));
/** The board starts above its whole footprint, including the higher edge of a sloping beach. */
export const boatJettyFootY = (world: SettlementContext["options"]["world"], foot: SettlementPoint,
  point: SettlementPoint) => {
  const dx = point.x - foot.x, dz = point.z - foot.z, length = DMath.hypot(dx, dz) || 1;
  const width = BOAT_JETTY_DECK_WIDTH / 2 + .15;
  return Math.max(...[-width, 0, width].map(side => sampleSmooth(world, world.heights,
    foot.x - dz / length * side, foot.z + dx / length * side))) + .06;
};
type JettyWorld = SettlementContext["options"]["world"];
/** The deck descends from its foot to the water without touching ground or a cliff cell. */
const deckClearOfGround = (world: JettyWorld, foot: SettlementPoint, point: SettlementPoint, footY: number,
  length: number) => {
  const acrossX = -(point.z - foot.z) / length, acrossZ = (point.x - foot.x) / length;
  for (let distance = 0; distance <= length; distance += .2) {
    const share = distance / length, deckY = footY * (1 - share) + (world.seaLevel + .18) * share;
    noteInputRead(foot.x + (point.x - foot.x) * share, foot.z + (point.z - foot.z) * share, BOARD_READ_REACH);
    for (const side of [-BOAT_JETTY_DECK_WIDTH / 2 - .15, 0, BOAT_JETTY_DECK_WIDTH / 2 + .15]) {
      const x = foot.x + (point.x - foot.x) * share + acrossX * side;
      const z = foot.z + (point.z - foot.z) * share + acrossZ * side;
      const cell = Math.floor(z) * world.cellsX + Math.floor(x);
      if (world.slopeClass?.[cell] === SLOPE.cliff ||
        sampleSmooth(world, world.heights, x, z) > deckY - .02) return false;
    }
  }
  return true;
};
/** The foot itself is dry; after one tile the board must be over real water, not a dry beach/cliff. */
const boardEndsOverWater = (world: JettyWorld, foot: SettlementPoint, point: SettlementPoint, length: number) => {
  for (let distance = 1; distance <= length; distance += .2) {
    const share = distance / length;
    const x = foot.x + (point.x - foot.x) * share, z = foot.z + (point.z - foot.z) * share;
    if (sampleSmooth(world, world.heights, x, z) > world.seaLevel + .001) return false;
  }
  return true;
};
/** No visible rock and no standing trunk or boulder touches the deck. */
const boardClearOfRocksAndTrunks = (world: JettyWorld, foot: SettlementPoint, point: SettlementPoint) => {
  noteInputSegment(foot, point, BOARD_READ_REACH);
  if (roadIntersectsVisibleRock(world, foot, point, BOAT_JETTY_DECK_WIDTH + .24)) return false;
  return !someObstacleInCells(world, Math.floor(Math.min(foot.x, point.x) - 2),
    Math.floor(Math.min(foot.z, point.z) - 2), Math.ceil(Math.max(foot.x, point.x) + 2),
    Math.ceil(Math.max(foot.z, point.z) + 2), id =>
      distanceToSegment({ x: world.props.x[id]!, z: world.props.z[id]! }, foot, point) <
        navigationPropRadius(world, id) + BOAT_JETTY_DECK_WIDTH / 2 + .12);
};
/**
 * The shallow corridor between the dry foot and the board's water end stays wet, with no dry crest.
 * Every test must pass; the cheap ground samples run first and the read reach grows only as far as
 * a board gets (JETTY-FRAMES), so inland boards stop at their foot.
 */
const boardOverWater = (context: SettlementContext, foot: SettlementPoint, point: SettlementPoint, footY: number) => {
  const { world } = context.options, length = DMath.hypot(point.x - foot.x, point.z - foot.z);
  noteInputRead(foot.x, foot.z, BOARD_READ_REACH);
  // A short workboat deck cannot safely bridge a cliff face. Find a low beach instead.
  if (footY < world.seaLevel - .02 || footY > world.seaLevel + 2.5 ||
    (footY - world.seaLevel - .18) / length > .5) return false;
  return deckClearOfGround(world, foot, point, footY, length) && boardEndsOverWater(world, foot, point, length) &&
    boardClearOfRocksAndTrunks(world, foot, point);
};
/** The board `offset` tiles from `land` toward `dir`, with the boat's bay beside its water end. */
const boardSiteOf = (context: SettlementContext, land: SettlementPoint, dir: readonly [number, number],
  offset: number, footYOf: (point: SettlementPoint) => number): BoardSite | null => {
  const { world } = context.options;
  const point = { x: land.x + dir[0] * offset, z: land.z + dir[1] * offset };
  if (point.x < 0 || point.z < 0 || point.x >= world.cellsX || point.z >= world.cellsZ) return null;
  const footY = footYOf(point);
  if (!boardOverWater(context, land, point, footY)) return null;
  // The boat may turn toward its real route as soon as loading ends. Its entire hull/oar
  // turning disk must therefore clear the board, not only its static half-beam.
  const alongside = BOAT_TURN_RADIUS + BOAT_JETTY_DECK_WIDTH / 2 + .10;
  return { footY, landing: { x: point.x + dir[1] * alongside, z: point.z - dir[0] * alongside }, point };
};
/** The boat bay and the board keep clear of ship berths, rigs, lanes and piers. */
const siteIsSafe = (site: BoardSite, land: SettlementPoint, world: JettyWorld, planner: BoatRoutePlanner,
  channels: readonly ShipChannel[]) => {
  const { landing, point } = site;
  noteInputRead(landing.x, landing.z, LANDING_READ_REACH);
  if (!boatWaterAtLocal(world, landing) || !planner.canTurn(landing)) return false;
  if (!boatPointClearOfShips(landing, channels) || !boatPointClearOfShips(point, channels)) return false;
  if (!lineClearOfShips(land, point, channels) || !lineClearOfShips(land, landing, channels)) return false;
  return !channels.some(channel => channel.lanes.some(lane => lane.some((sample, index) => index > 0 &&
    distanceToSegment(land, lane[index - 1]!, sample) < FOOT_CLEARANCE)));
};
/** Bounded memory for kept porter routes (a few dozen land feet per harbour reach a viable board). */
const MAX_APPROACHES = 512;
/** The porter route to `land`, reused while its copied inputs are unchanged (JETTY-FRAMES). */
const approachTo = (context: SettlementContext, known: JettyCache, harbour: SettlementBuilding,
  land: SettlementPoint): Approach => {
  const { access } = harbour, key = `${harbour.uid}:${access.x},${access.z}:${land.x},${land.z}`;
  const compute = () => groundPath(context, access, land, harbour.uid);
  const entry = known.approaches.get(key);
  if (entry && confirmReusable(context, entry, known.key, compute, "jetty approach")) return entry.value;
  known.approaches.delete(key);
  const next = computeReusable(context, known.key, pointsRect([access, land], 0), compute);
  if (known.approaches.size >= MAX_APPROACHES) known.approaches.delete(known.approaches.keys().next().value!);
  known.approaches.set(key, next);
  return next.value;
};
/** Every safe board of one dry land foot, in direction then length order (terrain reads only). */
const boardSitesAt = (context: SettlementContext, land: SettlementPoint, planner: BoatRoutePlanner,
  channels: readonly ShipChannel[]) => {
  const result: BoardSite[] = [], { world } = context.options;
  for (const dir of DIRS) {
    // Every board length of one direction samples the same deck-wide line across its foot.
    let footY: number | undefined;
    const footYOf = (point: SettlementPoint) => footY ??= boatJettyFootY(world, land, point);
    for (const offset of JETTY_OFFSETS) {
      const site = boardSiteOf(context, land, dir, offset, footYOf);
      if (site && siteIsSafe(site, land, world, planner, channels)) result.push(site);
    }
  }
  return result;
};
const walkRank = (candidate: BoatJetty) => {
  let walk = 0, previous = candidate.route[0]!;
  for (const point of candidate.route.slice(1)) {
    walk += DMath.hypot(point.x - previous.x, point.z - previous.z); previous = point;
  }
  return walk + DMath.hypot(candidate.point.x - candidate.foot.x, candidate.point.z - candidate.foot.z) * .25;
};
/** A board site of one land foot, in the scan order the old full candidate list had. */
interface FootSite {
  land: SettlementPoint;
  /** No porter route is shorter than the straight line: `walkRank` of any route is at least this. */
  bound: number;
  order: number;
  site: BoardSite;
}
/** Float slack for the straight-line bound (a summed route may round a hair below it). */
const WALK_BOUND_SLACK = 1e-6;
const jettyOf = (harbour: SettlementBuilding, land: SettlementPoint, site: BoardSite,
  shoreRoute: SettlementPoint[]): BoatJetty => {
  const { footY, landing, point } = site;
  return { foot: land, footY, landing, point, route: [harbour.access, ...shoreRoute, point,
    shuttleBoatContact(landing, point)], shoreRoute: [harbour.access, ...shoreRoute], uid: harbour.uid };
};
const footSiteOf = (harbour: SettlementBuilding, land: SettlementPoint, site: BoardSite, order: number) => {
  const { access } = harbour, { landing, point } = site, contact = shuttleBoatContact(landing, point);
  const bound = DMath.hypot(point.x - access.x, point.z - access.z) +
    DMath.hypot(contact.x - point.x, contact.z - point.z) + DMath.hypot(point.x - land.x, point.z - land.z) * .25;
  return { bound, land, order, site };
};
/** The old ranking: porter walk, then foot row and column, then scan order. */
const rankedBefore = (rank: number, jetty: BoatJetty, order: number,
  best: { jetty: BoatJetty; order: number; rank: number }) =>
  (rank - best.rank || jetty.foot.z - best.jetty.foot.z || jetty.foot.x - best.jetty.foot.x ||
    order - best.order) < 0;
/**
 * PERF-FOLLOWUPS: the best ranked jetty, searching porter routes nearest bound first and stopping
 * once no remaining site can beat the best found. Same result as routing every site and sorting.
 */
const nearestJetty = (context: SettlementContext, known: JettyCache, harbour: SettlementBuilding,
  sites: FootSite[]) => {
  sites.sort((first, second) => first.bound - second.bound || first.order - second.order);
  const routes = new Map<SettlementPoint, Approach>();
  let best: { jetty: BoatJetty; order: number; rank: number } | null = null;
  for (const { bound, land, order, site } of sites) {
    if (best && bound - WALK_BOUND_SLACK > best.rank) break;
    if (!routes.has(land)) routes.set(land, approachTo(context, known, harbour, land));
    const shoreRoute = routes.get(land);
    if (!shoreRoute) continue;
    const jetty = jettyOf(harbour, land, site, shoreRoute), rank = walkRank(jetty);
    if (!best || rankedBefore(rank, jetty, order, best)) best = { jetty, order, rank };
  }
  return best?.jetty ?? null;
};

/**
 * Finds a dedicated boat landing for harbour `harbour` (BOAT-P01): a reachable dry shore foot, a board
 * over water, a boat bay with its full hull/oar turning disk, and no overlap with any sea ship's berth,
 * rig, approach or departure envelope. `null` means this harbour gets no new boat service rather than a
 * landing that steals or blocks a ship berth.
 */
export const findBoatJetty = (
  context: SettlementContext, harbour: SettlementBuilding, planner: BoatRoutePlanner,
  channels: readonly ShipChannel[]
): BoatJetty | null => {
  if (harbour.typeId !== 39 || harbour.construction !== 1) return null;
  const known = jettyCacheFor(context, planner), entry = known.jetties.get(harbour.uid);
  const { access } = harbour, inputs = `${access.x},${access.z}:${channelsKey(channels)}`;
  let feet = known.feet.get(harbour.uid);
  if (feet?.inputs !== inputs) {
    feet = { inputs, sites: createTileValues() };
    known.feet.set(harbour.uid, feet);
  }
  const footSites = feet.sites;
  const compute = () => searchBoatJetty(context, known, harbour, planner, channels, footSites);
  if (entry?.inputs === inputs && confirmReusable(context, entry, known.key, compute, "boat jetty"))
    return entry.value;
  // The land scan reads every cell (and its smoothed height) within the jetty radius of the door.
  const scan = JETTY_RADIUS + SMOOTH_READ_REACH;
  const rect = { maxX: access.x + scan, maxZ: access.z + scan, minX: access.x - scan, minZ: access.z - scan };
  const next = { ...computeReusable(context, known.key, rect, compute), inputs };
  known.jetties.set(harbour.uid, next);
  return next.value;
};

/**
 * The nearest safe jetty of one harbour: the land scan runs afresh, each foot's board sites are kept
 * while the terrain they read is unchanged, and porter routes are searched nearest first.
 */
const searchBoatJetty = (
  context: SettlementContext, known: JettyCache, harbour: SettlementBuilding, planner: BoatRoutePlanner,
  channels: readonly ShipChannel[], feet: TileValues<BoardSite[]>
): BoatJetty | null => {
  const { world } = context.options;
  const sites: FootSite[] = [];
  if (harbour.access.x < 0 || harbour.access.z < 0 || harbour.access.x >= world.cellsX ||
    harbour.access.z >= world.cellsZ) return null;
  renewChangedTileValues(context, feet);
  for (let z = Math.max(1, Math.floor(harbour.access.z - JETTY_RADIUS));
    z < Math.min(world.cellsZ - 1, harbour.access.z + JETTY_RADIUS); z++)
    for (let x = Math.max(1, Math.floor(harbour.access.x - JETTY_RADIUS));
      x < Math.min(world.cellsX - 1, harbour.access.x + JETTY_RADIUS); x++) {
      const cell = z * world.cellsX + x;
      if (!world.walkCost[cell] || world.blocking[cell] || context.occupied[cell] ||
        sampleSmooth(world, world.heights, x + .5, z + .5) < world.seaLevel - .05) continue;
      const land = { x: x + .5, z: z + .5 };
      if (DMath.hypot(land.x - harbour.access.x, land.z - harbour.access.z) > JETTY_RADIUS) continue;
      for (const site of tileValue(feet, cell, () => boardSitesAt(context, land, planner, channels)))
        sites.push(footSiteOf(harbour, land, site, sites.length));
    }
  settleTileValues(context, feet);
  return nearestJetty(context, known, harbour, sites);
};

/** Local shallow-water check before the exact boat mask lookup. */
const boatWaterAtLocal = (world: SettlementContext["options"]["world"], point: SettlementPoint) => {
  if (point.x < 0 || point.z < 0 || point.x >= world.cellsX || point.z >= world.cellsZ) return false;
  return sampleSmooth(world, world.heights, point.x, point.z) < world.seaLevel - .05 &&
    sampleSmooth(world, world.heights, point.x + BOAT_ROUTE_CLEARANCE, point.z) < world.seaLevel - .05 &&
    sampleSmooth(world, world.heights, point.x - BOAT_ROUTE_CLEARANCE, point.z) < world.seaLevel - .05 &&
    sampleSmooth(world, world.heights, point.x, point.z + BOAT_ROUTE_CLEARANCE) < world.seaLevel - .05 &&
    sampleSmooth(world, world.heights, point.x, point.z - BOAT_ROUTE_CLEARANCE) < world.seaLevel - .05;
};
