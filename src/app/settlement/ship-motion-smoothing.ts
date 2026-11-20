import type { createMotionSmoother } from "./actor-motion-smoothing";

interface ShipLikeFrame {
  id: number;
  x: number;
  y: number;
  yaw: number;
  z: number;
}

/** Presentation-only interpolation between the last two simulation poses of ships and boats. */
export const smoothShipLikeFrames = <T extends ShipLikeFrame>(
  smoother: ReturnType<typeof createMotionSmoother>,
  frames: readonly T[],
  fraction: number,
  dt: number
): T[] => {
  const drawn = frames.map(frame => {
    const pose = smoother.smooth(frame.id, { x: frame.x, y: frame.y, z: frame.z, yaw: frame.yaw },
      fraction, dt, false, true);
    return { ...frame, x: pose.x, yaw: pose.yaw, z: pose.z };
  });
  smoother.retain(new Set(frames.map(frame => frame.id)));
  return drawn;
};
