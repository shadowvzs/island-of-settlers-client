import {
  SAILING_SHIP_HULL_LENGTH, SAILING_SHIP_SPACING, SAILING_SHIP_TURN_RADIUS
} from "../../render-common/ships/ship-dimensions";
import { wrapAngle } from "../../render-common/wildlife/nav/nav-steering";
import { DMath } from "../math/deterministic-math";
import { MinHeap } from "../world/min-heap";
import type { WorldData } from "../world/world-data";
import {
  createShipMoveClearance, ENVELOPE_REACH, moveKeepsClear, shipHullFitsSea, type ShipObstacle, shipsOverlap
} from "./settlement-ship-clearance";
import { sailArc, type ShipPose,swingAbout } from "./settlement-ship-kinematics";
import { createShipMotionTemplates, type ShipMotionTemplates } from "./settlement-ship-motion-templates";
import type { ShipRoutePoint } from "./settlement-ship-routes";
import { createShipTrigMemo, type ShipTrigonometry } from "./settlement-ship-trigonometry";
import type { SettlementPoint } from "./settlement-types";

/**
 * A ship in narrow water, or close beside another ship, cannot simply turn and sail. It gets clear
 * the way a real crew does: short arcs ahead or astern (backing and filling), and where even that
 * does not fit, a slow swing on the oars round the centre or round the bow or stern (a spring line),
 * until it lies in water where it can turn freely. The hull never slides sideways.
 */
interface ShipPortalMasks {
  parallelX: Uint8Array; parallelZ: Uint8Array; turning: Uint8Array;
  hullFitsSea?: typeof shipHullFitsSea;
}
export interface ShipPortal { path: ShipRoutePoint[]; point: SettlementPoint }

/** Heading buckets of the search lattice (the stored pose keeps its exact heading). */
const HEADINGS = 16;
const HEADING_ANGLE = Math.PI * 2 / HEADINGS;
/** Local search window (tiles from the start in each direction); berths are close to open water. */
const WINDOW = 20;
/** Poses closer than this share one search state (hybrid A*: the stored pose stays exact). */
const LATTICE = .5;
const LATTICE_RADIUS = Math.round(WINDOW / LATTICE);
const WIDTH = LATTICE_RADIUS * 2 + 1;
/** Distance sailed per manoeuvre arc, and the tightest manoeuvring radius. */
const KEEL_STEP = 1;
const MANOEUVRE_RADIUS = 3;
/** Explored poses before the manoeuvre search gives up (bounded cost per reroute). */
const MAX_EXPANSIONS = 4000;
/** Two ships this far apart can both swing on the spot (berths are spaced the same way). */
const FREE_TURN_DISTANCE = SAILING_SHIP_TURN_RADIUS * 2 + SAILING_SHIP_SPACING;
/** Rounded lattice nodes, every intermediate arc/swing centre, and the complete pair of rig envelopes. */
export const TURNING_PORTAL_OBSTACLE_REACH = WINDOW + LATTICE / 2 +
  Math.max(KEEL_STEP, 2 * MANOEUVRE_RADIUS, SAILING_SHIP_HULL_LENGTH) +
  Math.max(ENVELOPE_REACH + 1e-8, FREE_TURN_DISTANCE) + 1e-6;
export const turningPortalObstacles = (from: ShipPose, blocked: readonly ShipObstacle[]) => blocked.filter(other =>
  Math.abs(other.x - from.x) <= TURNING_PORTAL_OBSTACLE_REACH &&
  Math.abs(other.z - from.z) <= TURNING_PORTAL_OBSTACLE_REACH);
/** Sailing the preferred way along the keel (ahead, or astern for a way in found backwards). */
const AHEAD_COST = 1;
const ASTERN_COST = 2;
/** Swinging on the oars or a spring line is slow; arcs under way are preferred. */
const SWING_COST = 3;
/** Swing points along the keel: centre, bow and stern. */
const SWING_POINTS = [0, SAILING_SHIP_HULL_LENGTH / 2, -SAILING_SHIP_HULL_LENGTH / 2];
/**
 * Poses tested along each manoeuvre: close enough that no corner of the hull moves further than this
 * between two of them, so a hull never grazes a corner of the shore between tested poses.
 */
const SAMPLE_TRAVEL = .2;
const HALF_HULL = SAILING_SHIP_HULL_LENGTH / 2;
const cardinal = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
// Fixed canonical move geometry is independent of position, terrain, obstacles and search budget.
const canonicalMotionTemplates = createShipMotionTemplates();

/** Entering a pose must not push into another ship; backing away from an overlap stays allowed. */
const movesClear = (candidate: ShipObstacle, current: ShipObstacle, blocked: readonly ShipObstacle[]) =>
  blocked.every(other => moveKeepsClear(current, candidate, other));

const cellOf = (world: WorldData, point: SettlementPoint) =>
  Math.floor(point.z) * world.cellsX + Math.floor(point.x);

const neighbours = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const;
/** Octile steps exceed the straight line by up to this factor; dividing keeps the estimate a lower bound. */
const OCTILE_EXCESS = 1.0824;
/** Distances to turning-clear water, per turning mask (one per terrain revision). */
const openWaterDistances = new WeakMap<Uint8Array, Float32Array>();

/** Octile distance through sea cells to the nearest turning-clear cell (multi-source Dijkstra). */
const openWaterDistance = (world: WorldData, sea: Uint8Array, turning: Uint8Array) => {
  const cached = openWaterDistances.get(turning);
  if (cached) return cached;
  const distance = new Float32Array(sea.length).fill(Infinity), queue = new MinHeap(1024);
  for (let cell = 0; cell < turning.length; cell++) if (turning[cell]) { distance[cell] = 0; queue.push(cell, 0); }
  while (queue.size) {
    const cell = queue.pop(), x = cell % world.cellsX, z = (cell - x) / world.cellsX, here = distance[cell]!;
    for (const [dx, dz] of neighbours) {
      const nx = x + dx, nz = z + dz, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || !sea[next]) continue;
      const total = here + (dx && dz ? Math.SQRT2 : 1);
      if (total >= distance[next]!) continue;
      distance[next] = total; queue.push(next, total);
    }
  }
  openWaterDistances.set(turning, distance);
  return distance;
};

/**
 * `roomy`: a ship jammed among others searches for water where it can swing clear of all of them,
 * not merely for water wide enough to turn in.
 */
interface PortalSearch {
  blocked: readonly ShipObstacle[]; masks: ShipPortalMasks; roomy?: boolean; sea: Uint8Array;
  /** The way out will be sailed backwards (a ship berthing bow first): backing out is the cheap move. */
  sternFirst?: boolean;
  world: WorldData;
}

/**
 * Turning-clear water, clear of every other hull. Ships close by are left to the helm's anticipatory
 * avoidance; the manoeuvre search is only for water too tight to turn in (or, `roomy`, to get a
 * jammed ship clear of the ships around it).
 */
const isOpenWater = ({ blocked, masks, roomy, world }: PortalSearch, pose: ShipObstacle) =>
  pose.x >= 0 && pose.z >= 0 && pose.x < world.cellsX && pose.z < world.cellsZ &&
  Boolean(masks.turning[cellOf(world, pose)]) && (roomy
    ? blocked.every(other => DMath.hypot(other.x - pose.x, other.z - pose.z) >= FREE_TURN_DISTANCE)
    : !blocked.some(other => shipsOverlap(pose, other)));

interface SearchNode extends ShipPose { cost: number; leg?: ShipRoutePoint; previous: number; settled: boolean }
/** A manoeuvre: the poses the hull passes through, the leg it becomes on the route, and its cost. */
interface SearchMove { cost: number; count: number; end: ShipPose; leg: ShipRoutePoint; sampleAt(index: number): ShipPose }

const arcMove = (pose: ShipPose, direction: number, curvature: number, sternFirst: boolean,
  trig: ShipTrigonometry, templates: ShipMotionTemplates, moveId: number): SearchMove => {
  const count = Math.ceil(KEEL_STEP * (1 + HALF_HULL * Math.abs(curvature)) / SAMPLE_TRAVEL);
  const { end, sampleAt } = templates(pose, moveId, count, (origin, index) => {
    const distance = KEEL_STEP * (index + 1) / count;
    return sailArc(origin, direction * distance, distance * curvature * direction, trig);
  });
  const leg: ShipRoutePoint = direction < 0 ? { ...end, astern: true, curvature } : { ...end, curvature };
  const preferred = sternFirst ? direction < 0 : direction > 0;
  return { cost: (preferred ? AHEAD_COST : ASTERN_COST) * KEEL_STEP, count, end, leg, sampleAt };
};

const swingMove = (pose: ShipPose, pivot: number, turn: number, trig: ShipTrigonometry,
  templates: ShipMotionTemplates, moveId: number): SearchMove => {
  const count = Math.ceil((Math.abs(pivot) + HALF_HULL) * Math.abs(turn) / SAMPLE_TRAVEL);
  const { end, sampleAt } = templates(pose, moveId, count, (origin, index) =>
    swingAbout(origin, pivot, turn * (index + 1) / count, trig));
  return { cost: SWING_COST, count, end, leg: { ...end, pivot }, sampleAt };
};

/** Arcs ahead and astern (straight or at the manoeuvring radius) and swings round three keel points. */
const manoeuvres = (pose: ShipPose, sternFirst: boolean, trig: ShipTrigonometry,
  templates: ShipMotionTemplates): SearchMove[] => {
  const moves: SearchMove[] = [];
  let moveId = 0;
  for (const direction of [1, -1]) for (const curvature of [0, 1 / MANOEUVRE_RADIUS, -1 / MANOEUVRE_RADIUS])
    moves.push(arcMove(pose, direction, curvature, sternFirst, trig, templates, moveId++));
  for (const pivot of SWING_POINTS) for (const turn of [HEADING_ANGLE, -HEADING_ANGLE])
    moves.push(swingMove(pose, pivot, turn, trig, templates, moveId++));
  return moves;
};

const moveFits = ({ masks, sea, world }: PortalSearch, from: ShipPose, move: SearchMove,
  keepsClear: ReturnType<typeof createShipMoveClearance>) => {
  let previous = from;
  for (let index = 0; index < move.count; index++) {
    const sample = move.sampleAt(index);
    // Turning-clear water floats the hull on any heading; only poses near the shore are tested in full.
    const open = sample.x >= 0 && sample.z >= 0 && sample.x < world.cellsX && sample.z < world.cellsZ &&
      Boolean(masks.turning[cellOf(world, sample)]);
    if (!open && !(masks.hullFitsSea?.(world, sea, sample) ?? shipHullFitsSea(world, sea, sample))) return false;
    if (!keepsClear(previous, sample)) return false;
    previous = sample;
  }
  return true;
};

const headingOf = (yaw: number) => ((Math.round(wrapAngle(yaw) / HEADING_ANGLE) % HEADINGS) + HEADINGS) % HEADINGS;

/**
 * Hybrid A* over manoeuvres in a local window around the start, guided by the distance to turning-clear
 * water (a lower bound: every keel tile costs at least one).
 */
const searchManoeuvres = (search: PortalSearch, start: ShipObstacle, maxExpansions: number,
  trig: ShipTrigonometry, templates: ShipMotionTemplates) => {
  const nodes = new Map<number, SearchNode>(), queue = new MinHeap(256);
  const keepsClear = createShipMoveClearance(search.blocked);
  const distance = openWaterDistance(search.world, search.sea, search.masks.turning);
  const estimate = (pose: ShipPose) => Math.max(0, distance[cellOf(search.world, pose)]! / OCTILE_EXCESS - 1);
  const stateOf = (pose: ShipPose) => {
    const kx = Math.round((pose.x - start.x) / LATTICE), kz = Math.round((pose.z - start.z) / LATTICE);
    if (Math.abs(kx) > LATTICE_RADIUS || Math.abs(kz) > LATTICE_RADIUS) return -1;
    return ((kz + LATTICE_RADIUS) * WIDTH + kx + LATTICE_RADIUS) * HEADINGS + headingOf(pose.yaw);
  };
  const relax = (from: number, pose: ShipPose, step: number, leg?: ShipRoutePoint) => {
    const state = stateOf(pose), total = (nodes.get(from)?.cost ?? 0) + step;
    if (state < 0 || total >= (nodes.get(state)?.cost ?? Infinity)) return;
    nodes.set(state, { cost: total, leg, previous: from, settled: false, x: pose.x, yaw: pose.yaw, z: pose.z });
    queue.push(state, total + estimate(pose));
  };
  relax(-1, start, 0);
  for (let expansions = 0; queue.size && expansions < maxExpansions; expansions++) {
    const state = queue.pop(), node = nodes.get(state)!;
    if (node.settled) continue;
    node.settled = true;
    if (isOpenWater(search, node)) return { goal: state, nodes };
    for (const move of manoeuvres(node, Boolean(search.sternFirst), trig, templates)) {
      // A rejected relaxation cannot contribute a route. Avoid sweeping its hull through every
      // intermediate pose, while retaining the exact search order and accepted manoeuvres.
      const end = move.end, next = stateOf(end);
      if (next < 0 || node.cost + move.cost >= (nodes.get(next)?.cost ?? Infinity)) continue;
      if (moveFits(search, node, move, keepsClear)) relax(state, end, move.cost, move.leg);
    }
  }
  return null;
};

/** Manoeuvre out of tight water: the searched arcs and swings to the nearest open water. */
export const findTurningPortal = (search: PortalSearch, from: ShipObstacle,
  maxExpansions = MAX_EXPANSIONS, trig?: ShipTrigonometry): ShipPortal | null => {
  if (isOpenWater(search, from)) return { path: [], point: { x: from.x, z: from.z } };
  if (!shipHullFitsSea(search.world, search.sea, from)) return null;
  const distance = openWaterDistance(search.world, search.sea, search.masks.turning)[cellOf(search.world, from)]!;
  // Open water beyond the search window cannot be reached by manoeuvres.
  if (distance / OCTILE_EXCESS > WINDOW * Math.SQRT2) return null;
  const templates = trig ? createShipMotionTemplates() : canonicalMotionTemplates;
  const found = searchManoeuvres(search, from, maxExpansions, trig ?? createShipTrigMemo(), templates);
  if (!found) return null;
  const path: ShipRoutePoint[] = [];
  for (let node = found.nodes.get(found.goal)!; node.leg; node = found.nodes.get(node.previous)!) path.push(node.leg);
  path.reverse();
  const end = path.at(-1) ?? from;
  return { path, point: { x: end.x, z: end.z } };
};

/**
 * Last resort for a hull that does not fit where it is (legacy saves, terrain edits) or water too
 * tight for any manoeuvre: the hull is eased out on its current heading.
 */
export const findDriftPortal = ({ blocked, masks, sea, world }: PortalSearch, from: ShipObstacle): ShipPortal | null => {
  const first = cellOf(world, from);
  if (!sea[first]) return null;
  const isCardinal = Math.abs(DMath.cos(from.yaw)) >= Math.abs(DMath.sin(from.yaw));
  const hull = isCardinal ? masks.parallelZ : masks.parallelX;
  const legacy = !shipHullFitsSea(world, sea, from);
  const previous = new Int32Array(sea.length).fill(-1), queue = [first]; previous[first] = first;
  let last = -1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    const current = { x: x + .5, z: z + .5, yaw: from.yaw };
    if (masks.turning[cell] && !blocked.some(other => shipsOverlap(current, other))) { last = cell; break; }
    for (const [dx, dz] of cardinal) {
      const nx = x + dx, nz = z + dz, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || previous[next]! >= 0 ||
        !(legacy ? sea[next] : hull[next])) continue;
      const candidate = { x: nx + .5, z: nz + .5, yaw: from.yaw };
      if (!legacy && !shipHullFitsSea(world, sea, candidate)) continue;
      if (!movesClear(candidate, current, blocked)) continue;
      previous[next] = cell; queue.push(next);
    }
  }
  if (last < 0) return null;
  const path: ShipRoutePoint[] = [];
  for (let cell = last; cell !== first; cell = previous[cell]!) path.push({ drift: true,
    x: cell % world.cellsX + .5, yaw: from.yaw, z: Math.floor(cell / world.cellsX) + .5 });
  path.reverse();
  return { path, point: { x: last % world.cellsX + .5, z: Math.floor(last / world.cellsX) + .5 } };
};
