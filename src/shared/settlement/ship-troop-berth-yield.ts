import { DMath } from "../math/deterministic-math";
import { HARBOUR_TYPE_ID } from "./building-type-ids";
import { TROOP_SHIP_RETRY_SECONDS } from "./constants";
import type { FleetBerthing } from "./settlement-naval-berthing";
import type { ChannelYield } from "./settlement-naval-channel-yield";
import type { NavalShip } from "./settlement-naval-fleet";
import type { ShipApproach } from "./settlement-ship-anchorage";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

interface BerthYieldOptions {
  berthing: FleetBerthing;
  /** Open water and the way out of a narrow channel for ships with no waiting spot free. */
  channel: ChannelYield;
  context: SettlementContext;
}

/**
 * A loaded troop ship never keeps a harbour berth (2026-11-17, seed 123: a ship holding troops at the berth shut
 * the only way out of a bay). Once its boarding is complete it sails to one of the harbour's waiting spots, as an
 * unloaded cargo ship does, and lies there with its troops aboard (`waitingOff`), still orderable. A harbour whose
 * ring has no free spot (a tight bay) gives open turning water clear of every harbour lane instead. When another
 * ship needs to pass and neither exists, it sails out of the channel and waits outside (owner, 2026-11-17). A new
 * boarding at that harbour brings the ship back to the berth.
 */
export const createTroopShipBerthYield = ({ berthing, channel, context }: BerthYieldOptions) => {
  /** Waiting off harbour `uid` with the troops aboard, the berth given up. */
  const waitOff = (ship: NavalShip, uid: number) => {
    Object.assign(ship.troopMission!, { harbourUid: undefined, waitingOff: uid });
    ship.sourceUid = undefined;
  };
  /**
   * Leaves the berth of harbour `uid` for a waiting spot off `ways` and every anchored troop ship's way out; asked
   * by a passing ship (`passing`) with none free, out of the channel.
   */
  const leaveBerth = (ship: NavalShip, uid: number, ways: readonly ShipApproach[] = [], passing = false) => {
    const all = [...ways, ...channel.anchoredWays(ship, uid)];
    const spot = berthing.anchorage(uid, ship, all) ?? channel.openWater(ship, uid, ways);
    if (spot && berthing.route(ship, spot, "sailing")) {
      ship.anchorage = spot;
      waitOff(ship, uid);
      return;
    }
    if (passing && channel.sailOut(ship, uid)) waitOff(ship, uid);
  };
  /**
   * A loaded troop ship at a berth another ship asks for, or waiting off harbour `waitingOff` on another ship's
   * way, moves to another waiting spot or open water off that way, else out of the channel.
   */
  const makeWay = (ship: NavalShip, ways: readonly ShipApproach[]) => {
    const mission = ship.troopMission!;
    if (mission.harbourUid !== undefined) { leaveBerth(ship, mission.harbourUid, ways, true); return; }
    const uid = mission.waitingOff!;
    const all = [...ways, ...channel.anchoredWays(ship, uid)];
    const spot = berthing.anchorage(uid, ship, all) ?? berthing.anchorage(uid, ship, all, true, false, true) ??
      channel.openWater(ship, uid, ways);
    if (spot && berthing.route(ship, spot, "sailing")) { ship.anchorage = spot; return; }
    channel.sailOut(ship, uid);
  };
  /** The finished harbour nearest `point` (the waiting spots a ship's way may need cleared lie round it). */
  const nearestHarbour = (point: SettlementPoint) => context.buildings
    .filter(building => building.typeId === HARBOUR_TYPE_ID && building.construction === 1)
    .sort((a, b) => DMath.hypot(a.x - point.x, a.z - point.z) - DMath.hypot(b.x - point.x, b.z - point.z) ||
      a.uid - b.uid)[0]?.uid;
  /**
   * Ready at the berth with troops aboard and no destination: sail to a waiting spot (retried each second). Where
   * the bay has none that shuts no other troop ship in, it keeps the berth until another ship asks for it.
   */
  const moveAside = (ship: NavalShip, dt: number) => {
    const mission = ship.troopMission!, uid = mission.harbourUid;
    if (uid === undefined || mission.anchor || mission.target || !ship.passengers?.length) return;
    ship.timer -= dt;
    if (ship.timer > 0) return;
    ship.timer = TROOP_SHIP_RETRY_SECONDS;
    leaveBerth(ship, uid);
  };
  /** Back to the berth of harbour `uid` for more soldiers; false while the berth is not available. */
  const returnToBerth = (ship: NavalShip, uid: number) => {
    const berth = berthing.dock(uid, ship);
    if (!berth || !berthing.routeToBerth(ship, berth, "positioning", uid)) return false;
    Object.assign(ship.troopMission!, { harbourUid: uid, waitingOff: undefined });
    Object.assign(ship, { anchorage: undefined, outside: undefined, sourceUid: uid });
    return true;
  };
  berthing.setTroopShipYield(makeWay);
  channel.setBerthReturn(returnToBerth);
  return { moveAside, nearestHarbour, returnToBerth };
};
