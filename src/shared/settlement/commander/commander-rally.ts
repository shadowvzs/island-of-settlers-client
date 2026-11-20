import { RALLY_MIN_DISTANCE, RALLY_RADIUS } from "../../balance/retreat-route";
import type { SettlementPoint } from "../settlement-types";

const squared = (dx: number, dz: number) => dx * dx + dz * dz;

/**
 * Rally point choice (A14 plan §3.4, §4.2): the kinds of rally point in priority order (friendly hero, manned
 * fort, steady reserve, own post), each as a flat `[x, z, x, z, …]` list. The first kind with a usable point
 * wins, and within a kind the nearest one (ties: the earlier one). Usable: between `RALLY_MIN_DISTANCE` and
 * `RALLY_RADIUS` away, and farther from the enemy than the walker (a rally point never lies towards the enemy).
 * Squared distances only: exact, no roots.
 */
export const chooseRallyPoint = (
  from: SettlementPoint, enemy: SettlementPoint, kinds: readonly (readonly number[])[]
): SettlementPoint | undefined => {
  const exposure = squared(from.x - enemy.x, from.z - enemy.z);
  for (const points of kinds) {
    let best = -1, bestDistance = Infinity;
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index]!, z = points[index + 1]!;
      const distance = squared(x - from.x, z - from.z);
      if (distance < RALLY_MIN_DISTANCE * RALLY_MIN_DISTANCE || distance > RALLY_RADIUS * RALLY_RADIUS) continue;
      if (squared(x - enemy.x, z - enemy.z) <= exposure || distance >= bestDistance) continue;
      best = index;
      bestDistance = distance;
    }
    if (best >= 0) return { x: points[best]!, z: points[best + 1]! };
  }
  return undefined;
};
