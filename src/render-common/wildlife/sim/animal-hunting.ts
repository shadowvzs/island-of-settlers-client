import { DMath } from "../../../shared/math/deterministic-math";
import { isBodyFree, isStandFree } from "../nav/nav-query";
import { ANIMAL_STATE } from "../wildlife-species";
import { REACTION } from "./animal-pool";
import { clearRoute, getWaypointX, getWaypointZ, hasRoute, planRoute, type WildlifeContext } from "./wildlife-context";

/** A wounded animal runs one ten-tile leg, then stands for the hunter's second shot. */
export const startHuntedEscape = (context: WildlifeContext, animal: number, from: { x: number; z: number }, wounded = true) => {
  const { nav, pool } = context;
  const away = wounded ? DMath.atan2(pool.z[animal]! - from.z, pool.x[animal]! - from.x) : context.random.at("wildlife.startledEscape", animal)() * Math.PI * 2;
  pool.huntState[animal] = wounded ? 1 : 3;
  if (wounded) pool.health[animal] = .5;
  pool.reaction[animal] = REACTION.none;
  pool.stateTime[animal] = 0;
  pool.blocked[animal] = 0;
  // Shorter safe legs are the fallback at a shoreline or in a confined clearing.
  for (const distance of [10, 7.5, 5, 2.5]) for (const offset of [0, .35, -.35, .7, -.7, 1.2, -1.2, Math.PI]) {
    const angle = away + offset;
    const x = pool.x[animal]! + DMath.cos(angle) * distance;
    const z = pool.z[animal]! + DMath.sin(angle) * distance;
    if (!isStandFree(nav, pool.species[animal]!, x, z) ||
      !isBodyFree(nav, pool.species[animal]!, x, z, angle, pool.bodyScale[animal]!)) continue;
    if (!planRoute(context, animal, x, z)) continue;
    pool.state[animal] = ANIMAL_STATE.flee;
    pool.stateLength[animal] = Infinity;
    context.onFlee?.(animal);
    return;
  }
  clearRoute(pool, animal);
  pool.huntState[animal] = wounded ? 2 : 0;
  pool.state[animal] = ANIMAL_STATE.idle;
};

/** Overrides wandering/threat replans only while this wounded prey is being pursued. */
export const thinkHuntedAnimal = (context: WildlifeContext, animal: number) => {
  const { pool } = context;
  if (!pool.huntState[animal]) return false;
  pool.reaction[animal] = REACTION.none;
  if (pool.huntState[animal] !== 2 && hasRoute(pool, animal) && pool.blocked[animal]! < 2) {
    pool.desiredHeading[animal] = DMath.atan2(getWaypointZ(pool, animal) - pool.z[animal]!,
      getWaypointX(pool, animal) - pool.x[animal]!);
    return true;
  }
  clearRoute(pool, animal);
  pool.huntState[animal] = pool.huntState[animal] === 3 ? 0 : 2;
  pool.state[animal] = ANIMAL_STATE.idle;
  pool.stateTime[animal] = 0;
  pool.stateLength[animal] = 3;
  return true;
};
