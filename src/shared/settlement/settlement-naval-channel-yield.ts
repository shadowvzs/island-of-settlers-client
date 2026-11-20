import { DMath } from "../math/deterministic-math";
import type { FleetBerthing } from "./settlement-naval-berthing";
import type { NavalShip } from "./settlement-naval-fleet";
import { findOpenWaterSpot } from "./settlement-open-water-spot";
import { ANCHORAGE_SPACING, sampleShipLane, type ShipApproach } from "./settlement-ship-anchorage";
import type { createShipRoutePlanner, ShipDestination } from "./settlement-ship-routes";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * A ship that sailed out of a narrow channel through its harbour's sea exit to let another ship pass (owner,
 * 2026-11-17). It waits beyond the map edge and comes back to the harbour's waiting water once there is room.
 */
export interface ShipOutside {
  /** The harbour's sea exit by the map edge, where it leaves and comes back in. */
  exit: SettlementPoint;
  harbourUid: number;
  /** Beyond the map edge (phase "away"), no longer sailing out to the exit. */
  left?: boolean;
}

/** Seconds a ship waits outside at least, so the ship it made way for is under way before it looks back in. */
export const OUTSIDE_MIN_SECONDS = 8;
/** Outside, it looks for its way back in this often (seconds). */
const OUTSIDE_RETRY_SECONDS = 1;

interface ChannelYieldOptions {
  berthing: FleetBerthing;
  /** A filter of water clear of harbour berths, lanes and jetties (built per search). */
  clearWater: () => (water: SettlementPoint) => boolean;
  context: SettlementContext;
  planner: ReturnType<typeof createShipRoutePlanner>;
  ships: readonly NavalShip[];
}

/** Back in, a troop ship whose harbour has no free waiting water takes the berth again (when it is free). */
type BerthReturn = (ship: NavalShip, uid: number) => boolean;

/**
 * Where a ship lying in another ship's way goes when its harbour has no free waiting spot (owner, 2026-11-17,
 * seed 123: a harbour in a narrow channel with room for one waiting ship). Open turning water anywhere it can
 * reach first; failing that, it sails out of the channel through the harbour's sea exit and waits beyond the map
 * edge while the other ship passes, then comes back to a waiting spot or, a troop ship, to the berth.
 * Deterministic: fixed search orders, the state is the saved `outside` field.
 */
export const createChannelYield = ({ berthing, clearWater, context, planner, ships }: ChannelYieldOptions) => {
  let berthReturn: BerthReturn | undefined;
  /**
   * The ways out to sea of the troop ships lying at (or bound for) a coast anchorage: a waiting spot never shuts
   * one in (seed 123: the harbour's one waiting spot was the mouth of the pocket a pickup lay in).
   */
  const anchoredWays = (ship: NavalShip, uid: number): ShipApproach[] => {
    const berth = berthing.berths.forHarbour(uid)[0], exit = berth && berthing.seaExitAt(berth);
    if (!exit) return [];
    return ships.flatMap(other => {
      const mission = other.troopMission, target = mission?.target;
      const landing = mission?.anchor ?? (target?.kind === "coast" ? target.landing : undefined);
      if (other === ship || !landing) return [];
      const from = { ...landing.water, yaw: landing.yaw }, path = planner.route(from, exit);
      return path ? [{ from, path }] : [];
    });
  };
  /**
   * Open turning water that `ship` can reach, clear of harbour lanes, other hulls, `ways`, the other ships' ways
   * near harbour `uid` and the anchored troop ships' ways out.
   */
  const openWater = (ship: NavalShip, uid: number, ways: readonly ShipApproach[] = []): ShipDestination | null => {
    const held = berthing.obstacles(ship, true), harbourWater = clearWater();
    const lanes = [...ways, ...anchoredWays(ship, uid), ...berthing.trafficWays(uid, ship)]
      .flatMap(way => sampleShipLane(way.from, way.path));
    const clear = (point: SettlementPoint) => harbourWater(point) &&
      lanes.every(other => DMath.hypot(other.x - point.x, other.z - point.z) >= ANCHORAGE_SPACING);
    return findOpenWaterSpot(ship, { clear, connected: planner.connected, held, turning: planner.masks.turning,
      world: context.options.world, reaches: point => Boolean(planner.route(ship, point, held)) });
  };
  /** The ship sails out through harbour `uid`'s sea exit to wait beyond the map edge; false without a course. */
  const sailOut = (ship: NavalShip, uid: number) => {
    const berth = berthing.berths.forHarbour(uid)[0], exit = berth && berthing.seaExitAt(berth);
    if (!exit || !berthing.route(ship, exit, "sailing")) return false;
    ship.anchorage = exit;
    ship.outside = { exit, harbourUid: uid };
    return true;
  };
  /** An idle ship in another ship's way with no waiting spot free: open water, else out of the channel. */
  const stepOff = (ship: NavalShip, uid: number, ways: readonly ShipApproach[]) => {
    const spot = openWater(ship, uid, ways);
    if (spot && berthing.route(ship, spot, "sailing")) { ship.anchorage = spot; return; }
    sailOut(ship, uid);
  };
  /** At the sea exit: it leaves the map and waits outside (true when the route end was this). */
  const arrive = (ship: NavalShip) => {
    if (!ship.outside || ship.outside.left) return false;
    Object.assign(ship, { anchorage: undefined, cursor: 0, phase: "away", route: [], speed: 0,
      timer: OUTSIDE_MIN_SECONDS });
    ship.outside.left = true;
    return true;
  };
  /** In again at the exit: to a waiting spot or open water off every way, else (a troop ship) the free berth. */
  const comeBack = (ship: NavalShip) => {
    const { harbourUid } = ship.outside!;
    const spot = berthing.anchorage(harbourUid, ship, anchoredWays(ship, harbourUid)) ?? openWater(ship, harbourUid);
    if (spot && berthing.route(ship, spot, "sailing")) {
      Object.assign(ship, { anchorage: spot, outside: undefined });
      return;
    }
    if (ship.troopMission && berthReturn?.(ship, harbourUid)) ship.outside = undefined;
  };
  /** One tick of a ship outside the map edge; false for any other ship. */
  const update = (ship: NavalShip, dt: number) => {
    if (!ship.outside?.left) return false;
    ship.timer -= dt;
    if (ship.timer > 0) return true;
    ship.timer = OUTSIDE_RETRY_SECONDS;
    if (berthing.entryClear(ship, ship.outside.exit)) comeBack(ship);
    return true;
  };
  berthing.setChannelYield(stepOff);
  return {
    anchoredWays, arrive, openWater, sailOut, update,
    /** Installs how a troop ship takes its harbour berth again when it comes back in. */
    setBerthReturn: (handler: BerthReturn) => { berthReturn = handler; }
  };
};

export type ChannelYield = ReturnType<typeof createChannelYield>;
