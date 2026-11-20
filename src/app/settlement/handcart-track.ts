import { cartCentreBehind, HANDCART } from "../../render-common/logistics/handcart-rules";

interface TrackPoint {
  x: number;
  z: number;
}
export interface CartPuller extends TrackPoint {
  heading: number;
}
/** Where a drawn cart stands and the ground its puller walked over since. */
export interface CartTrack extends TrackPoint {
  trail: TrackPoint[];
  turning: boolean;
  yaw: number;
}

/** The trail keeps a point every this many metres. */
const TRAIL_STEP = .05;
/** A puller facing this far (radians) from the cart's direction walks back past it: the cart swings round. */
const TURN_START = 2.1;
const TURN_END = .15;
/** Radians per second the cart swings round its puller. */
const TURN_RATE = 3.5;
/** Farther than this from its cart the puller was placed (load, recovery): the cart is placed too. */
const SNAP_DISTANCE = HANDCART.carrierOffset + 2;

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export const createCartTrack = (x: number, z: number, yaw: number): CartTrack =>
  ({ trail: [{ x, z }], turning: false, x, yaw, z });

/** A new track with the cart straight behind its puller. */
export const createTrackBehind = (puller: CartPuller) => {
  const centre = cartCentreBehind(puller.x, puller.z, puller.heading);
  return createCartTrack(centre.x, centre.z, puller.heading);
};

/** Appends the puller's position and forgets trail far behind the cart. */
const recordTrail = (trail: TrackPoint[], puller: TrackPoint) => {
  const last = trail.at(-1)!;
  if (Math.hypot(puller.x - last.x, puller.z - last.z) >= TRAIL_STEP) trail.push({ x: puller.x, z: puller.z });
  let length = 0;
  for (let index = trail.length - 1; index > 0; index--) {
    length += Math.hypot(trail[index]!.x - trail[index - 1]!.x, trail[index]!.z - trail[index - 1]!.z);
    if (length <= HANDCART.carrierOffset + 1) continue;
    trail.splice(0, index - 1);
    return;
  }
};

/** The point `distance` back along the trail from the puller (straight on past its oldest point). */
const pointBehind = (trail: readonly TrackPoint[], puller: TrackPoint, distance: number) => {
  let left = distance, ahead = puller;
  for (let index = trail.length - 1; index >= 0; index--) {
    const point = trail[index]!;
    const length = Math.hypot(ahead.x - point.x, ahead.z - point.z);
    if (length >= left) {
      const fraction = left / length;
      return { x: ahead.x + (point.x - ahead.x) * fraction, z: ahead.z + (point.z - ahead.z) * fraction };
    }
    if (length > 0) left -= length;
    ahead = point;
  }
  const oldest = trail[0]!, next = trail[1] ?? puller;
  const length = Math.hypot(oldest.x - next.x, oldest.z - next.z);
  if (length < 1e-6) return { x: oldest.x, z: oldest.z };
  return { x: oldest.x + (oldest.x - next.x) / length * left, z: oldest.z + (oldest.z - next.z) / length * left };
};

/** The cart swings round the puller towards his heading, its new trail starting where it stands. */
const swingRound = (track: CartTrack, puller: CartPuller, dt: number) => {
  const turn = wrapAngle(puller.heading - track.yaw), step = TURN_RATE * dt;
  track.yaw = Math.abs(turn) <= step ? puller.heading : wrapAngle(track.yaw + Math.sign(turn) * step);
  const centre = cartCentreBehind(puller.x, puller.z, track.yaw);
  track.x = centre.x; track.z = centre.z;
  track.trail = [centre, { x: puller.x, z: puller.z }];
};

/**
 * Moves a cart behind its puller. The axle follows the ground the puller walked, so the cart stays
 * on the road through bends, and the shafts point at his hands. When he walks back past the cart
 * (a delivery turning for home) the cart swings round him instead of being pushed backwards.
 */
export const followPuller = (track: CartTrack, puller: CartPuller, moved: boolean, dt: number) => {
  if (Math.hypot(puller.x - track.x, puller.z - track.z) > SNAP_DISTANCE) {
    Object.assign(track, createTrackBehind(puller));
    return;
  }
  const behind = Math.abs(wrapAngle(puller.heading - track.yaw));
  track.turning = moved && (behind > TURN_START || (track.turning && behind > TURN_END));
  if (track.turning) return swingRound(track, puller, dt);
  recordTrail(track.trail, puller);
  const axle = pointBehind(track.trail, puller, HANDCART.carrierOffset);
  const dx = puller.x - axle.x, dz = puller.z - axle.z;
  if (Math.hypot(dx, dz) > 1e-4) track.yaw = Math.atan2(dx, dz);
  track.x = axle.x; track.z = axle.z;
};
