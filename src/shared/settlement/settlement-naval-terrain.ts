import type { WorldData } from "../world/world-data";
import type { NavalShip } from "./settlement-naval-fleet";
import { reliefDepartureHullFits, routeWithReliefDeparture } from "./settlement-relief-departure";
import { shipHullFitsSea } from "./settlement-ship-clearance";
import type { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";

type VoyagePhase = "positioning" | "sailing";
interface TerrainRefreshHooks {
  docks: { clear(): void };
  endpoint(ship: NavalShip, phase: VoyagePhase): SettlementPoint | undefined;
  planner: ReturnType<typeof createShipRoutePlanner>;
  route(ship: NavalShip, destination: SettlementPoint, phase: VoyagePhase): boolean;
  ships: readonly NavalShip[];
}
/** A queue-gated endpoint or a blocked live hull is traffic, not proof that terrain cut the journey. */
export const terrainObstructsShip = (world: WorldData, sea: Uint8Array,
  planner: ReturnType<typeof createShipRoutePlanner>, ship: NavalShip, endpoint?: SettlementPoint) =>
  !reliefDepartureHullFits(world, sea, ship, ship) ||
    Boolean(endpoint && !routeWithReliefDeparture(world, sea, ship, endpoint, [], planner));
/** Terrain edits renew routing only. Paid cargo, passengers, orders and mission receipts
 * remain owned; an invalidated journey waits visibly until its original route is safe. */
export const createNavalTerrainRefresh = (world: WorldData, sea: Uint8Array, hooks: TerrainRefreshHooks) => {
  let revision = world.terrainRevision ?? 0;
  return () => {
    const next = world.terrainRevision ?? 0;
    if (next === revision) return;
    // Mark before callbacks: endpoint resolution may recursively query a harbour dock.
    revision = next; hooks.planner.refresh(); hooks.docks.clear();
    for (const ship of hooks.ships) {
      const moving = ship.phase === "positioning" || ship.phase === "sailing";
      const groundedTransfer = ["loading", "unloading"].includes(ship.phase) && !shipHullFitsSea(world, sea, ship);
      if (!moving && !groundedTransfer) continue;
      const phase = ship.phase === "positioning" || ship.phase === "loading" ? "positioning" : "sailing";
      const endpoint = hooks.endpoint(ship, phase);
      if (endpoint && hooks.route(ship, endpoint, phase)) continue;
      ship.retryPhase = phase;
      ship.terrainBlocked = terrainObstructsShip(world, sea, hooks.planner, ship, endpoint) || undefined;
      ship.route = []; ship.cursor = 0; ship.phase = "stranded"; ship.timer = 1;
    }
  };
};
