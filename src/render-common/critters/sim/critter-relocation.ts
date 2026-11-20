import { findSpotOutside } from "../../relocation";
import { BEHAVIOUR } from "../critter-colonies";
import { CRITTER_BEHAVIOURS } from "./critter-behaviours";
import type { CritterContext } from "./critter-context";
import type { CritterPool } from "./critter-pool";

/** Move living ground critters out of a plan; soaring and flying creatures remain overhead. */
export const relocateGroundCritters = (
  pool: CritterPool,
  context: CritterContext,
  isInside: (x: number, z: number) => boolean,
  remember: (index: number) => void
) => {
  for (let index = 0; index < pool.active.length; index++) {
    if (!pool.active[index] || pool.carcass[index] || !isInside(pool.x[index]!, pool.z[index]!))
      continue;
    const behaviour = pool.behaviour[index]!;
    if (
      behaviour === BEHAVIOUR.soar ||
      behaviour === BEHAVIOUR.dart ||
      (pool.lift[index]! > 0.2 && behaviour !== BEHAVIOUR.climb)
    )
      continue;
    const actions = CRITTER_BEHAVIOURS[behaviour]!;
    const accepts = actions.accepts(context, pool.species[index]!);
    const spot = findSpotOutside(pool.x[index]!, pool.z[index]!, isInside, accepts);
    if (!spot) continue;
    pool.x[index] = pool.targetX[index] = pool.originX[index] = spot.x;
    pool.z[index] = pool.targetZ[index] = pool.originZ[index] = spot.z;
    actions.spawn(pool, index, context);
    pool.y[index] = context.terrain.ground(spot.x, spot.z) + pool.lift[index]!;
    remember(index);
  }
};
