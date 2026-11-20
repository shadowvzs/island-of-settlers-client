import { SAILING_SHIP_SCALE } from "./ship-dimensions";

/** Deck point in ship-local units; `x` across the keel, `z` along it (bow positive). */
export interface ShipDeckPoint { x: number; y: number; z: number }

/** Gentle idle bob of a finished hull; the deck passengers share it so their feet stay on deck. */
export const shipBobbing = (id: number, time: number) => Math.sin(time * 1.3 + id) * .028;

/** Gentle idle pitch of a finished hull, shared with the deck passengers. */
export const shipPitch = (id: number, time: number) => Math.sin(time + id) * .014;

/**
 * World pose of a deck point on the same drawn hull the ship renderer uses: uniform ship scale,
 * then the hull's idle pitch and yaw, then its bobbing and position. Simulation deck positions stay
 * authoritative; this is a presentation-only match for passengers standing aboard.
 */
export const shipDeckWorldPose = (
  ship: { id: number; x: number; y: number; yaw: number; z: number },
  point: ShipDeckPoint, time: number
) => {
  const x = point.x * SAILING_SHIP_SCALE, y = point.y * SAILING_SHIP_SCALE, z = point.z * SAILING_SHIP_SCALE;
  const pitch = shipPitch(ship.id, time);
  const a = Math.cos(pitch), b = Math.sin(pitch), c = Math.cos(ship.yaw), d = Math.sin(ship.yaw);
  return {
    x: ship.x + c * x + d * z,
    y: ship.y + shipBobbing(ship.id, time) + b * d * x + a * y - b * c * z,
    yaw: ship.yaw,
    z: ship.z - a * d * x + b * y + a * c * z
  };
};
