import { EXPLORATION_CLOUD_DRIFT } from "../../../render-common/atmosphere/cloud-drift";

/** Presentation-only advection. Wind changes velocity, never the distance already travelled. */
export const createExplorationCloudMotion = () => {
  const displacement = new Float64Array(4);
  const uniform = new Float32Array(4);
  let previousTime: number | null = null;
  let previousX = 0;
  let previousZ = 0;
  return {
    value: uniform,
    update: (time: number, windX: number, windZ: number) => {
      if (!Number.isFinite(time) || (previousTime !== null && time < previousTime)) return uniform;
      const x = Number.isFinite(windX) ? windX : 0;
      const z = Number.isFinite(windZ) ? windZ : 0;
      if (previousTime === null) {
        // Retain the initial field placement; subsequent updates integrate velocity.
        displacement[0] = displacement[2] = x * time;
        displacement[1] = displacement[3] = z * time;
      } else {
        // Resume without fast-forwarding clouds across a background-tab/loading gap.
        const delta = Math.min(0.25, time - previousTime);
        const dx = (previousX + x) * 0.5 * delta;
        const dz = (previousZ + z) * 0.5 * delta;
        // Nearer banks need plausible winds aloft; cirrus retains its separate, slower phase.
        displacement[0]! += dx * EXPLORATION_CLOUD_DRIFT.lower;
        displacement[1]! += dz * EXPLORATION_CLOUD_DRIFT.lower;
        displacement[2]! += dx * EXPLORATION_CLOUD_DRIFT.upper;
        displacement[3]! += dz * EXPLORATION_CLOUD_DRIFT.upper;
      }
      previousTime = time;
      previousX = x;
      previousZ = z;
      uniform.set(displacement);
      return uniform;
    }
  };
};
