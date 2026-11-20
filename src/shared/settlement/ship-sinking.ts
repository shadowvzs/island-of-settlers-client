import type { NavalOrder, NavalShip } from "./settlement-naval-fleet";

/** Only uncommitted empty owned hulls can be removed; cargo, crews and paid missions stay intact. */
export const canSinkShip = (ship: NavalShip, orders: readonly NavalOrder[]) =>
  !ship.visitor && !ship.gone && ship.phase === "idle" && !ship.dismantle &&
  ship.orderId === undefined && ship.nextOrderId === undefined && ship.reservedFor === undefined &&
  ship.foundingSiteUid === undefined && !ship.colony && !ship.expedition && !ship.exploration &&
  !ship.passengers?.length && !ship.troops?.length &&
  !Object.values(ship.cargo).some(count => count > 0) &&
  !orders.some(order => order.shipId === ship.id || order.preferredShipId === ship.id);

/** Render-only lifetime. It never becomes a ship phase or a field in the saved fleet. */
export const SHIP_SINK_SECONDS = 6;
