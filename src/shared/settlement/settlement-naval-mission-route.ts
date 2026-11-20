import type { NavalShip } from "./settlement-naval-fleet";
import type { ShipObstacle } from "./settlement-ship-clearance";
import type { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementPoint } from "./settlement-types";

interface MissionRouting {
  construction: () => readonly ShipObstacle[];
  leaveQueue: (ship: NavalShip) => void;
  makeWay: (ship: NavalShip, point: SettlementPoint) => void;
  planner: ReturnType<typeof createShipRoutePlanner>;
  route: (ship: NavalShip, point: SettlementPoint, phase: "sailing") => boolean;
}

/** Mission destinations survive fleet congestion; an actually lost route returns its paid receipt. */
export const createNavalMissionRouting = ({ construction, leaveQueue, makeWay, planner, route }: MissionRouting) => {
  const waitForTraffic = (ship: NavalShip, point: SettlementPoint) => {
    if (!planner.route(ship, point, construction())) return false;
    makeWay(ship, point);
    leaveQueue(ship);
    ship.retryPhase = undefined; ship.terrainBlocked = undefined;
    ship.phase = "stranded"; ship.timer = 1;
    return true;
  };
  return (ship: NavalShip): boolean | null => {
    if (ship.exploration && !ship.exploration.returning) {
      const point = ship.exploration.points[ship.exploration.cursor];
      if (point && route(ship, point, "sailing")) return true;
      if (point && waitForTraffic(ship, point)) return false;
      ship.exploration.returning = true; ship.destinationUid = ship.sourceUid;
    }
    if (ship.expedition) {
      if (route(ship, ship.expedition.water, "sailing")) return true;
      if (waitForTraffic(ship, ship.expedition.water)) return false;
      ship.expedition = undefined; ship.cancelled = true; ship.destinationUid = ship.sourceUid;
    }
    return null;
  };
};
