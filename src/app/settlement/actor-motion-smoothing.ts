import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";

/** Fastest visible turn (rad/s): arrivals and work facings turn instead of snapping. */
const TURN_RATE = 9;
/** Beyond this jump between two ticks an actor was placed, not walked: it snaps there. */
const TELEPORT_DISTANCE = 1.5;
/** Less movement than this in one tick is standing (shuffles, yields), not walking. */
const MOVING_DISTANCE = .01;

interface Pose { x: number; y: number; z: number; yaw: number }
/** `heading`: the last direction walked, with the simulation facing at that moment. */
interface Track {
  from: Pose; to: Pose; shown: Pose; fraction: number;
  heading?: { facing: number; simulation: number };
  turnDirection?: number;
  pendingTurn?: { direction: number; seconds: number };
}

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Filter only minor reversing corrections; deliberate turns never wait for a timer. */
const riderTurn = (track: Track, difference: number, dt: number) => {
  const angle = Math.abs(difference), direction = Math.sign(difference);
  if (angle < .04) { track.pendingTurn = undefined; return 0; }
  if (angle < .22 && track.turnDirection && direction !== track.turnDirection) {
    const pending = track.pendingTurn;
    track.pendingTurn = { direction, seconds: pending?.direction === direction ? pending.seconds + dt : dt };
    if (track.pendingTurn.seconds < .12) return 0;
  }
  track.pendingTurn = undefined; track.turnDirection = direction;
  const step = difference * (1 - Math.exp(-Math.max(0, dt) / .1));
  return Math.max(-4 * dt, Math.min(4 * dt, step));
};

/**
 * The simulation moves actors in fixed 0.05 s ticks; rendering runs faster. Each actor is drawn
 * between its last two tick positions (by the fraction of the next tick already elapsed), one
 * tick behind, so walking is continuous; its facing turns at a limited rate.
 */
export const createMotionSmoother = () => {
  const tracks = new Map<number, Track>();
  const advance = (track: Track, target: Pose, fraction: number, dt: number) => {
    const { to } = track;
    // A tick passed when the fraction wrapped, or when a whole tick's time elapsed since the last frame.
    const ticked = fraction < track.fraction || track.fraction + dt / TICK_SECONDS >= 1;
    track.fraction = fraction;
    if (to.x === target.x && to.y === target.y && to.z === target.z && to.yaw === target.yaw) {
      // A tick passed without movement: the actor stands still at its last position.
      if (ticked) track.from = { ...to };
      return;
    }
    const jumped = Math.hypot(target.x - to.x, target.z - to.z) > TELEPORT_DISTANCE;
    track.from = jumped ? { ...target } : { ...to };
    track.to = { ...target };
    if (jumped) {
      track.shown = { ...target };
      track.pendingTurn = undefined; track.turnDirection = undefined;
    }
  };
  const travelFacing = (track: Track) => {
    const { from, to } = track;
    if (Math.hypot(to.x - from.x, to.z - from.z) <= MOVING_DISTANCE) return null;
    const facing = Math.atan2(to.x - from.x, to.z - from.z);
    track.heading = { facing, simulation: to.yaw };
    return facing;
  };
  /**
   * The simulation steers its facing gradually, so on stopping after a turn it still lags behind the
   * way walked: keep facing that way until the simulation sets a facing of its own (enemy, work).
   */
  const standingFacing = ({ heading, to }: Track) =>
    heading && heading.simulation === to.yaw ? heading.facing : to.yaw;
  return {
    /**
     * Pose to draw this frame; `fraction` is the share of the next simulation tick elapsed (0..1).
     * `facesWorkTarget`: the simulation aimed the facing at a work target (a cast, a tree), often in
     * the same tick as the last step, so the standing figure turns to it instead of the way walked.
     */
    smooth: (uid: number, target: Pose, fraction: number, dt: number,
      facesWorkTarget = false, useSimulationFacing = false): Pose => {
      let track = tracks.get(uid);
      if (!track) {
        track = { fraction, from: { ...target }, shown: { ...target }, to: { ...target } };
        tracks.set(uid, track);
      }
      advance(track, target, fraction, dt);
      const t = Math.max(0, Math.min(1, fraction)), { from, shown, to } = track;
      shown.x = from.x + (to.x - from.x) * t;
      shown.y = from.y + (to.y - from.y) * t;
      shown.z = from.z + (to.z - from.z) * t;
      // A moving figure always faces where it goes (never drawn walking backwards); standing, it keeps
      // the way it walked until the simulation sets a facing of its own (work target, enemy).
      let facing = to.yaw;
      if (!useSimulationFacing) facing = travelFacing(track) ?? (facesWorkTarget ? to.yaw : standingFacing(track));
      const turn = wrapAngle(facing - shown.yaw), step = TURN_RATE * Math.max(0, dt);
      if (useSimulationFacing) shown.yaw = wrapAngle(shown.yaw + riderTurn(track, turn, Math.max(0, dt)));
      else shown.yaw = Math.abs(turn) <= step ? facing : wrapAngle(shown.yaw + Math.sign(turn) * step);
      return shown;
    },
    /** Forget actors that are no longer drawn. */
    retain: (visible: ReadonlySet<number>) => {
      for (const uid of tracks.keys()) if (!visible.has(uid)) tracks.delete(uid);
    }
  };
};
