import type { NavalShip } from "../../src/shared/settlement/settlement-naval-fleet";

/** Tiles from its berth within which a ship's turning counts as its final approach and berthing. */
const APPROACH_RADIUS = 15;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Cumulative heading change of each ship's final approach (owner bug 2026-10-22: a ship spun 360° on its way
 * to the pier): every tick a ship is under way within `APPROACH_RADIUS` of the end of its course, the turn
 * since the last tick adds up; when it starts loading or unloading the approach's total is recorded.
 */
export const createApproachTurns = () => {
  const turning = new Map<string, { signed: number; spin: number; total: number; yaw: number }>();
  let most = 0, worst = "", spin = 0, spinWorst = "";
  const update = (ships: readonly NavalShip[], label = "") => {
    for (const ship of ships) {
      // Berth approaches only: a course ending on a berth's heading (waiting spots have none).
      const end = ship.route.at(-1)?.yaw === undefined ? undefined : ship.route.at(-1);
      const under = ship.phase === "sailing" || ship.phase === "positioning";
      const near = end && Math.hypot(end.x - ship.x, end.z - ship.z) < APPROACH_RADIUS;
      const key = `${label}:${ship.id}`, entry = turning.get(key);
      if (ship.phase === "loading" || ship.phase === "unloading") {
        if (entry && entry.total > most) { most = entry.total; worst = `${label} ship ${ship.id}`; }
        if (entry && entry.spin > spin) { spin = entry.spin; spinWorst = `${label} ship ${ship.id}`; }
        turning.delete(key);
        continue;
      }
      if (!under || !near) { if (!under) turning.delete(key); continue; }
      if (!entry) { turning.set(key, { signed: 0, spin: 0, total: 0, yaw: ship.yaw }); continue; }
      const turn = wrap(ship.yaw - entry.yaw) * 180 / Math.PI;
      entry.total += Math.abs(turn);
      entry.signed += turn;
      entry.spin = Math.max(entry.spin, Math.abs(entry.signed));
      entry.yaw = ship.yaw;
    }
  };
  /** `spin`: the most a ship's heading turned one way round (a full spin is 360°). */
  return { most: () => most, spin: () => spin, spinWorst: () => spinWorst, update, worst: () => worst };
};
