import type { WorldData } from "../world/world-data";
import type { NavalShip } from "./settlement-naval-fleet";
import { registerDerivedSeaMask } from "./settlement-sea-navigation";
import { ENVELOPE_REACH, shipHullFitsSea, type ShipObstacle } from "./settlement-ship-clearance";
import type { ShipPose } from "./settlement-ship-kinematics";
import { createShipRoutePlanner, type ShipDestination, type ShipRoutePoint } from "./settlement-ship-routes";

export interface ReliefDepartureTail { version: 1; target: ShipPose }
const PAD = 40;
const shifted = <T extends { x: number; z: number }>(point: T) => ({ ...point, x: point.x + PAD, z: point.z + PAD });
const restored = (point: ShipRoutePoint) => ({ ...point, x: point.x - PAD, z: point.z - PAD });
const caches = new WeakMap<WorldData, {
  terrain: number; build: number; sea: Uint8Array;
  hullFits: (pose: ShipObstacle) => boolean;
  route: (from: ShipObstacle, to: ShipDestination, blocked?: readonly ShipObstacle[], roomy?: boolean) => ShipRoutePoint[] | null;
}>();

/** Only a loaded relief ship may use this finite extension of the same sea beyond the authored border. */
const departureWater = (world: WorldData, sea: Uint8Array) => {
  const cached = caches.get(world), terrain = world.terrainRevision ?? 0, build = world.buildRevision ?? 0;
  if (cached && cached.terrain === terrain && cached.build === build && cached.sea === sea) return cached;
  const cellsX = world.cellsX + PAD * 2, cellsZ = world.cellsZ + PAD * 2;
  const extendedSea = new Uint8Array(cellsX * cellsZ).fill(1);
  for (let z = 0; z < world.cellsZ; z++) extendedSea.set(sea.subarray(z * world.cellsX, (z + 1) * world.cellsX),
    (z + PAD) * cellsX + PAD);
  // This immutable routing geometry reads dimensions/masks only; the original inside-map sea is copied exactly.
  const geometry = { cellsX, cellsZ, terrainRevision: 0 } as WorldData;
  registerDerivedSeaMask(geometry, extendedSea);
  const planner = createShipRoutePlanner(geometry, extendedSea);
  const result = { terrain, build, sea,
    hullFits: (pose: ShipObstacle) => shipHullFitsSea(geometry, extendedSea, shifted(pose)),
    route: (from: ShipObstacle, to: ShipDestination, blocked: readonly ShipObstacle[] = [], roomy = false) =>
      planner.route(shifted(from), shifted(to), blocked.map(shifted), roomy)?.map(restored) ?? null };
  caches.set(world, result);
  return result;
};

export const reliefShipOutsideMap = (world: Pick<WorldData, "cellsX" | "cellsZ">, ship: ShipObstacle) =>
  ship.x + ENVELOPE_REACH < 0 || ship.z + ENVELOPE_REACH < 0 ||
  ship.x - ENVELOPE_REACH > world.cellsX || ship.z - ENVELOPE_REACH > world.cellsZ;

export const reliefDepartureNavigation = (world: WorldData, sea: Uint8Array, ship: NavalShip) =>
  ship.visitor?.relief?.tail ? departureWater(world, sea) : undefined;

export const reliefDepartureHullFits = (world: WorldData, sea: Uint8Array, ship: NavalShip, pose: ShipObstacle) =>
  reliefDepartureNavigation(world, sea, ship)?.hullFits(pose) ?? shipHullFitsSea(world, sea, pose);
export const routeWithReliefDeparture = (world: WorldData, sea: Uint8Array, ship: NavalShip,
  destination: ShipDestination, blocked: readonly ShipObstacle[], planner: ReturnType<typeof createShipRoutePlanner>, roomy = false) => {
  const navigation = reliefDepartureNavigation(world, sea, ship);
  return navigation ? navigation.route(ship, destination, blocked, roomy) : planner.route(ship, destination, blocked, roomy);
};

const outsideTarget = (world: WorldData, ship: ShipObstacle): ShipPose => {
  const margin = ENVELOPE_REACH + 2;
  const edges = [
    { distance: ship.x, x: -margin, z: ship.z, yaw: -Math.PI / 2 },
    { distance: world.cellsX - ship.x, x: world.cellsX + margin, z: ship.z, yaw: Math.PI / 2 },
    { distance: ship.z, x: ship.x, z: -margin, yaw: Math.PI },
    { distance: world.cellsZ - ship.z, x: ship.x, z: world.cellsZ + margin, yaw: 0 }
  ];
  const { distance: _distance, ...target } = edges.sort((a, b) => a.distance - b.distance)[0]!;
  return target;
};

/** Continues physically past the existing visitor exit, until the whole rig is outside the visible map. */
export const sailReliefOffMap = (world: WorldData, sea: Uint8Array, ship: NavalShip, blocked: readonly ShipObstacle[]) => {
  if (!ship.visitor?.relief) return false;
  ship.visitor.relief.tail ??= { version: 1, target: outsideTarget(world, ship) };
  const navigation = departureWater(world, sea), target = ship.visitor.relief.tail.target;
  const path = navigation.route(ship, target, blocked) || navigation.route(ship, target, blocked, true);
  if (!path) { ship.phase = "stranded"; ship.timer = 1; return false; }
  ship.route = path; ship.cursor = 0; ship.phase = "sailing"; ship.timer = 2;
  ship.retryPhase = undefined; ship.terrainBlocked = undefined;
  return true;
};
