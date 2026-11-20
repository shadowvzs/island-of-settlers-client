import type { TerrainRenderer } from "../../render-common/renderer-contract";
import {
  findStampAt,
  getPickRatio,
  type StampKind,
  type TerrainEditState
} from "../../shared/world/editing/terrain/terrain-edit-state";
import {
  getStampRadius,
  type TerrainStamp
} from "../../shared/world/editing/terrain/terrain-stamps";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import { clamp } from "../../shared/world/noise";
import type { WorldData } from "../../shared/world/world-data";
import type { GroundPoint } from "./editor-input";

/** Screen distance (CSS px) beyond a stamp's drawn pick zone that still targets the stamp. */
export const SNAP_PIXELS = 12;
/** Outline samples of a stamp's pick zone. */
const OUTLINE_SAMPLES = 12;

type ScreenPoint = { x: number; y: number };
type Project = TerrainRenderer["projectToViewport"];

export interface StampSnapInput {
  /** The cursor (CSS pixels of the map canvas). */
  cursor: ScreenPoint;
  kind: StampKind;
  /** The ground the renderer picked under the cursor, null when the ray met none. */
  point: GroundPoint | null;
  project: Project;
  state: TerrainEditState;
  world: WorldData;
}

/** A stamp near the cursor: its screen distance and the spine point it snaps to. */
interface SnapCandidate {
  distance: number;
  point: GroundPoint;
}

const cross = (origin: ScreenPoint, first: ScreenPoint, second: ScreenPoint) =>
  (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);

/** Share (0..1) along the segment of the point nearest to `point`. */
const getNearestShare = (point: ScreenPoint, start: ScreenPoint, end: ScreenPoint) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return 0;
  return clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / length, 0, 1);
};

const getSegmentDistance = (point: ScreenPoint, start: ScreenPoint, end: ScreenPoint) => {
  const share = getNearestShare(point, start, end);
  const x = start.x + (end.x - start.x) * share;
  const y = start.y + (end.y - start.y) * share;
  return Math.hypot(point.x - x, point.y - y);
};

/** One half of the monotone chain hull (the last point starts the other half). */
const buildHalfHull = (points: readonly ScreenPoint[]) => {
  const hull: ScreenPoint[] = [];
  for (const point of points) {
    while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, point) <= 0) hull.pop();
    hull.push(point);
  }
  hull.pop();
  return hull;
};

/** Convex hull of screen points (monotone chain; every edge turns the same way). */
export const buildConvexHull = (points: readonly ScreenPoint[]) => {
  const sorted = [...points].sort((first, second) => first.x - second.x || first.y - second.y);
  return [...buildHalfHull(sorted), ...buildHalfHull([...sorted].reverse())];
};

/** Screen distance from the point to the convex hull, 0 inside it. */
export const getHullDistance = (point: ScreenPoint, hull: readonly ScreenPoint[]) => {
  const edges = hull.map((start, index) => [start, hull[(index + 1) % hull.length]!] as const);
  if (edges.every(([start, end]) => cross(start, end, point) >= 0)) return 0;
  return Math.min(...edges.map(([start, end]) => getSegmentDistance(point, start, end)));
};

/** The ends of the stamp's spine (a peak: its centre twice). */
const getSpine = (stamp: TerrainStamp) =>
  [
    { x: stamp.x, z: stamp.z },
    { x: stamp.toX ?? stamp.x, z: stamp.toZ ?? stamp.z }
  ] as const;

/** The pick zone's outline on the ground: a circle round a peak, a capsule round a ridge. */
const listPickOutline = (stamp: TerrainStamp) => {
  const radius = getPickRatio(stamp) * getStampRadius(stamp);
  const [start, end] = getSpine(stamp);
  return Array.from({ length: OUTLINE_SAMPLES }, (_, index) => {
    const angle = (index / OUTLINE_SAMPLES) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const anchor = cos * (end.x - start.x) + sin * (end.z - start.z) > 0 ? end : start;
    return { x: anchor.x + cos * radius, z: anchor.z + sin * radius };
  });
};

const getGroundHeight = (world: WorldData, point: GroundPoint) =>
  sampleSmooth(world, world.heights, point.x, point.z);

/**
 * Whether the picked ground lies behind the spine point (farther from the camera), i.e. the ray
 * passed over or beside the stamp; no ground at all (the ray left the map) counts as behind.
 */
const isBehind = ({ point, project, world }: StampSnapInput, spinePoint: GroundPoint) => {
  if (!point) return true;
  const depth = (at: GroundPoint) => project(at.x, getGroundHeight(world, at), at.z).depth;
  return depth(point) > depth(spinePoint);
};

/**
 * The stamp as a snap target: when the cursor is on or within SNAP_PIXELS of its drawn pick
 * zone (the hull of its spine top and the zone's outline on the ground, on screen) and the
 * picked ground lies behind it; the spine point nearest the cursor.
 */
const getCandidate = (input: StampSnapInput, stamp: TerrainStamp): SnapCandidate | null => {
  const { cursor, project, world } = input;
  const toScreen = (point: GroundPoint) => project(point.x, getGroundHeight(world, point), point.z);
  const [start, end] = getSpine(stamp);
  const top = [toScreen(start), toScreen(end)] as const;
  const hull = buildConvexHull([...top, ...listPickOutline(stamp).map(toScreen)]);
  if (getHullDistance(cursor, hull) > SNAP_PIXELS) return null;
  const share = getNearestShare(cursor, top[0], top[1]);
  const point = { x: start.x + (end.x - start.x) * share, z: start.z + (end.z - start.z) * share };
  if (!isBehind(input, point)) return null;
  return { distance: getSegmentDistance(cursor, top[0], top[1]), point };
};

/**
 * Keeps a click near a stamp on that stamp: a mountain's tip a hair below the cursor (the ray
 * passes over it and meets the ground behind), or the cursor just beside its upper flanks, snaps
 * to the stamp nearest the cursor, so the click raises (or lowers) it instead of starting a new
 * one behind it. A pick that already lands in a stamp's pick zone stays as it is. Cheap (a few
 * projections per stamp of the kind): it runs on pointer moves and every frame for the preview.
 */
export const snapToStamp = (input: StampSnapInput): GroundPoint | null => {
  const { kind, point, state } = input;
  if (point && findStampAt(state, point.x, point.z, kind)) return point;
  let best: SnapCandidate | null = null;
  for (const stamp of state.stamps) {
    if (stamp.kind !== kind) continue;
    const candidate = getCandidate(input, stamp);
    if (candidate && (!best || candidate.distance < best.distance)) best = candidate;
  }
  return best?.point ?? point;
};
