import { SHIP_DECK } from "../../render-common/ships/ship-deck-layout";
import { SAILING_SHIP_SCALE } from "../../render-common/ships/ship-dimensions";
import type { ShipCargoWork, ShipFrame, ShipSiteFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import { sameMaskBytes } from "../world/mask-bytes";
import { pointsRect } from "./settlement-charting-object-changes";
import { HARBOUR_LOCAL_SHORE_REACH, HARBOUR_WIDE_SHORE_REACH } from "./settlement-harbour-pier-geometry";
import { inputIdentity, intersectInputRect, unionInputRect } from "./settlement-input-fingerprint";
import { computeReusable, confirmReusable, type ReusableValue } from "./settlement-input-reuse";
import { groundPath } from "./settlement-paths";
import { shipHullFitsSea } from "./settlement-ship-clearance";
import { defaultHarbourDockSea } from "./settlement-ship-dock-sea";
import {
  findShipWorkpoint, SHIP_WORKPOINT_HULL_OFFSET, type ShipWorkpoint, shipWorkpointShoreSearchReach
} from "./settlement-ship-workpoint";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

interface LoadingShip {
  id: number;
  phase: string;
  sourceUid?: number;
  /** The harbour an unloading ship lies at. */
  destinationUid?: number;
  cargo: Goods;
  cursor?: number;
  route?: readonly (SettlementPoint & { yaw?: number })[];
  /** The dock porters' job at the pier (fleet frames carry it). */
  cargoWork?: ShipCargoWork;
}
type DockedShip = LoadingShip & Pick<ShipFrame, "x" | "y" | "z" | "yaw">;
export interface HarbourDockGeometry {
  porterRoute: SettlementPoint[];
  workPier: ShipWorkpoint;
}
type DockPose = Pick<ShipFrame, "x" | "z" | "yaw"> & Partial<Pick<ShipFrame, "y">>;
interface DockCache {
  docks: Map<string, ReusableValue<HarbourDockGeometry | null>>;
  /** Whole-map inputs (`inputIdentity`); null renews every dock on each revision. */
  identity: string | null;
  providedSea?: Uint8Array;
  revision: string;
  sea: Uint8Array;
  /** The sea bytes the docks were derived from (a supplied mask may be updated in place). */
  seaCopy: Uint8Array;
}
const caches = new WeakMap<SettlementContext, DockCache>();

/** A ship's pier frame id: this plus the ship id. */
export const DOCK_ID_OFFSET = 1_000_000;
/** Berths stay near their source harbour; turning room belongs to the offshore approach. */
export const HARBOUR_PIER_MAX_LENGTH = 8;
export const HARBOUR_SHORE_ACCESS_MAX_DISTANCE = HARBOUR_LOCAL_SHORE_REACH;
const MAX_CACHED_BERTHS = 256;
/** How far from the hull side a dock's shore may lie (the pier and the hull offset). */
const DOCK_WORKPOINT_REACH = HARBOUR_PIER_MAX_LENGTH + SHIP_WORKPOINT_HULL_OFFSET;

const shoreReachFor = (access: SettlementPoint, frame: DockPose) => {
  // The ordinary nearest berth remains local. Wider poses derive the same reach on every lookup,
  // including rendering, restored ships and porter boarding; no transient search preference is stored.
  // First-berth water offsets are perpendicular to its keel, so its alongshore projection stays
  // within the local land-search radius even when the ship lies farther out at sea.
  const alongshore = Math.abs((frame.x - access.x) * DMath.sin(frame.yaw) +
    (frame.z - access.z) * DMath.cos(frame.yaw));
  return alongshore > HARBOUR_SHORE_ACCESS_MAX_DISTANCE ?
    HARBOUR_WIDE_SHORE_REACH : HARBOUR_SHORE_ACCESS_MAX_DISTANCE;
};

/**
 * Shared berth geometry for steering, visible piers and physical passenger boarding.
 * Placement may pass its authoritative current sea mask; its owner handles topology invalidation.
 * Ordinary callers still derive/cache their own mask and cannot inherit a supplied-mask cache.
 */
const dockFor = (context: SettlementContext, harbour: Pick<SettlementBuilding, "uid" | "access">,
  frame: DockPose, sea: Uint8Array, deckY: number, shoreReach: number): HarbourDockGeometry | null => {
  if (!shipHullFitsSea(context.options.world, sea, frame)) return null;
  const coast = { land: harbour.access, path: [], water: { x: frame.x, z: frame.z }, yaw: frame.yaw };
  const workpoint = (refineShore: boolean) => findShipWorkpoint(context, harbour, coast,
    DOCK_WORKPOINT_REACH, shoreReach, HARBOUR_PIER_MAX_LENGTH, deckY, refineShore);
  // A curved bank's crest may lie between grid centres: keep the ramp above the real surface.
  const work = workpoint(false) ?? workpoint(true);
  const route = work && groundPath(context, harbour.access, work.shore, harbour.uid);
  if (!work || !route || DMath.hypot(work.point.x - work.shore.x, work.point.z - work.shore.z) >
    HARBOUR_PIER_MAX_LENGTH) return null;
  return { porterRoute: [harbour.access, ...route], workPier: work };
};

/**
 * The tiles a dock scans besides its porter route: shore cells within the shore reach of the door (and
 * the workpoint search square round the berth), the hull-side ramp ends and the ramps between them,
 * each with its smoothed-height stencil.
 */
const dockScanRect = (harbour: Pick<SettlementBuilding, "access">, frame: DockPose, shoreReach: number) => {
  const hull = pointsRect([frame], shipWorkpointShoreSearchReach(0) + 2);
  const shore = intersectInputRect(pointsRect([harbour.access], shoreReach + 2),
    pointsRect([frame], shipWorkpointShoreSearchReach(DOCK_WORKPOINT_REACH) + 2));
  return unionInputRect(hull, shore);
};

/**
 * The dock cache of a context. A revision move keeps every dock while the whole-map inputs and the sea
 * bytes are unchanged; each dock is then confirmed against its own copied inputs when next asked for.
 */
const dockCacheFor = (context: SettlementContext, revision: string, sea: Uint8Array, currentSea?: Uint8Array) => {
  const cache = caches.get(context);
  if (cache && cache.revision === revision && cache.providedSea === currentSea && cache.sea === sea) return cache;
  const identity = inputIdentity(context);
  if (cache && identity !== null && cache.identity === identity && cache.providedSea === currentSea &&
    sameMaskBytes(cache.seaCopy, sea)) {
    cache.revision = revision;
    cache.sea = sea;
    return cache;
  }
  const fresh: DockCache = { docks: new Map(), identity, providedSea: currentSea, revision, sea, seaCopy: sea.slice() };
  caches.set(context, fresh);
  return fresh;
};

/**
 * Shared berth geometry for steering, visible piers and physical passenger boarding.
 * Placement may pass its authoritative current sea mask; its owner handles topology invalidation.
 * Ordinary callers still derive/cache their own mask and cannot inherit a supplied-mask cache.
 */
export const findHarbourDockAt = (
  context: SettlementContext, harbour: Pick<SettlementBuilding, "uid" | "access">, frame: DockPose,
  currentSea?: Uint8Array
): HarbourDockGeometry | null => {
  const { world } = context.options;
  const revision = [context.navigationRevision ?? 0, world.buildRevision ?? 0,
    world.terrainRevision ?? 0, world.props.count].join(":");
  const cache = dockCacheFor(context, revision, currentSea ?? defaultHarbourDockSea(context), currentSea);
  const deckY = (frame.y ?? world.seaLevel) + SHIP_DECK.floorY * SAILING_SHIP_SCALE;
  const shoreReach = shoreReachFor(harbour.access, frame);
  const key = `${harbour.uid}:${harbour.access.x},${harbour.access.z}:` +
    `${frame.x},${frame.z},${frame.yaw},${deckY},${shoreReach}`;
  const compute = () => dockFor(context, harbour, frame, cache.sea, deckY, shoreReach);
  const known = cache.docks.get(key);
  if (known && confirmReusable(context, known, revision, compute, "harbour dock")) return known.value;
  if (known) cache.docks.delete(key);
  const entry = computeReusable(context, revision, dockScanRect(harbour, frame, shoreReach), compute);
  if (cache.docks.size >= MAX_CACHED_BERTHS) cache.docks.delete(cache.docks.keys().next().value!);
  cache.docks.set(key, entry);
  return entry.value;
};

/** Loading uses a completed actual source; construction previews use the same geometry directly. */
export const findHarbourDock = (
  context: SettlementContext, sourceUid: number | undefined, frame: DockPose
): HarbourDockGeometry | null => {
  const harbour = context.buildings.find(building => building.uid === sourceUid);
  if (!harbour || harbour.typeId !== 39 || harbour.construction < 1) return null;
  return findHarbourDockAt(context, harbour, frame);
};

/** A positioning ship may show its pier only after physically reaching its final berth pose. */
const isAtBerth = (ship: LoadingShip, frame: DockPose) => {
  if (ship.phase === "loading" || ship.phase === "unloading") return true;
  if (ship.phase !== "positioning") return false;
  const berth = ship.route?.at(-1);
  if (!berth || (ship.cursor ?? 0) < (ship.route?.length ?? 0) - 1) return false;
  if (DMath.hypot(frame.x - berth.x, frame.z - berth.z) > .08) return false;
  return berth.yaw === undefined ||
    Math.abs(DMath.atan2(DMath.sin(frame.yaw - berth.yaw), DMath.cos(frame.yaw - berth.yaw))) <= .02;
};

/** The harbour whose pier the ship lies at: where it unloads, else where it loads. */
const pierHarbour = (ship: LoadingShip) => ship.phase === "unloading" ? ship.destinationUid : ship.sourceUid;

/** Piers use the same validated harbour berth that passengers and fleet navigation use. */
export const createHarbourDocks = (context: SettlementContext) => {
  const forShip = (ship: DockedShip): ShipSiteFrame | null => {
    if (!isAtBerth(ship, ship)) return null;
    const geometry = findHarbourDock(context, pierHarbour(ship), ship);
    if (!geometry) return null;
    return { ...geometry, cargoWork: ship.cargoWork, id: DOCK_ID_OFFSET + ship.id, kind: "dock",
      progress: 1, x: ship.x, y: ship.y, yaw: ship.yaw, z: ship.z };
  };
  const framesFor = (ships: readonly LoadingShip[], frames: readonly ShipFrame[]) => {
    const docks: ShipSiteFrame[] = [];
    for (const ship of ships) {
      const frame = frames.find(entry => entry.id === ship.id);
      // A ship worked by lighters at its waiting spot has no pier of its own.
      if (!frame || frame.lighterWork) continue;
      const dock = forShip({ ...ship, cargoWork: frame.cargoWork, x: frame.x, y: frame.y, yaw: frame.yaw, z: frame.z });
      if (dock) docks.push(dock);
    }
    return docks;
  };
  return Object.assign(framesFor, { forShip });
};
