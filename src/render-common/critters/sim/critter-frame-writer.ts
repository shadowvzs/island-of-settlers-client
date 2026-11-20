import { lerp } from "../../../shared/world/noise";
import { lerpAngle } from "../../birds/bird-flight";
import type { CritterTerrain } from "../habitat/critter-terrain";
import type { CritterFrame, CritterHistory, CritterPool } from "./critter-pool";
import type { createRipples } from "./critter-ripples";

interface CritterFrameSource {
  frame: CritterFrame;
  history: CritterHistory;
  pool: CritterPool;
  ripples: ReturnType<typeof createRipples>;
  terrain: CritterTerrain;
}

/** Below this appear share a critter is not drawn. */
const MIN_APPEAR = 0.02;

/**
 * Packs the drawn critters into the renderer frame, interpolated `alpha` between the last two
 * fixed steps (a pose only within the same clip), then the ripples.
 */
export const createCritterFrameWriter = ({
  frame,
  history,
  pool,
  ripples,
  terrain
}: CritterFrameSource) => {
  const writeCritter = (index: number, slot: number, alpha: number, appear: number) => {
    const x = lerp(history.x[index]!, pool.x[index]!, alpha);
    const z = lerp(history.z[index]!, pool.z[index]!, alpha);
    const sameClip = history.clip[index] === pool.clip[index];
    frame.x[slot] = x;
    frame.y[slot] = lerp(history.y[index]!, pool.y[index]!, alpha);
    frame.z[slot] = z;
    frame.heading[slot] = lerpAngle(history.heading[index]!, pool.heading[index]!, alpha);
    frame.clip[slot] = pool.clip[index]!;
    frame.pose[slot] = sameClip
      ? lerp(history.pose[index]!, pool.pose[index]!, alpha)
      : pool.pose[index]!;
    frame.species[slot] = pool.species[index]!;
    frame.scale[slot] = pool.scale[index]! * appear;
    frame.shade[slot] = pool.shade[index]!;
    frame.ground[slot] = terrain.water(x, z);
    frame.visibility[slot] = terrain.fog(x, z);
  };

  return (alpha: number) => {
    let count = 0;
    for (let index = 0; index < pool.capacity; index += 1) {
      if (pool.active[index] === 0 || pool.hidden[index] === 1) continue;
      const appear = lerp(history.appear[index]!, pool.appear[index]!, alpha);
      if (appear <= MIN_APPEAR) continue;
      writeCritter(index, count, alpha, appear);
      count += 1;
    }
    frame.count = count;
    ripples.write(frame.ripples);
  };
};
