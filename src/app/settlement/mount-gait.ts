import type { MountFrame } from "../../render-common/mounts/mount-frame";

const MOUNT_GAITS: readonly MountFrame["clip"][] = ["idle", "walk", "trot", "gallop"];
/** Ground speed (cells/s) where each faster gait starts. */
const MOUNT_GAIT_SPEEDS = [.05, 1.4, 2.6];

/** Gait from the existing per-rider smoothed speed; hysteresis preserves the current clip phase. */
export const sampleMountGait = (speeds: Map<number, number>, uid: number, distance: number,
  dt: number, previous?: MountFrame) => {
  const raw = dt > 0 ? distance / dt : 0;
  const speed = (speeds.get(uid) ?? raw) + (raw - (speeds.get(uid) ?? raw)) * (1 - Math.exp(-dt * 6));
  speeds.set(uid, speed);
  const current = previous ? MOUNT_GAITS.indexOf(previous.clip) : -1;
  let target = MOUNT_GAIT_SPEEDS.filter(threshold => speed >= threshold).length;
  const band = (threshold: number) => Math.min(.12, threshold * .5);
  const upper = MOUNT_GAIT_SPEEDS[current], lower = MOUNT_GAIT_SPEEDS[current - 1];
  if (upper !== undefined && target > current && speed < upper + band(upper)) target = current;
  if (lower !== undefined && target < current && speed > lower - band(lower)) target = current;
  return MOUNT_GAITS[target]!;
};
