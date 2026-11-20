import { isCircleBlocked } from "../../wildlife/nav/nav-colliders";
import { SPECIES } from "../../wildlife/wildlife-species";
import { CHAMOIS_SLOPE } from "../habitat/critter-habitats-mountain";
import type { CritterContext } from "./critter-context";

/** A chamois body's room among boulders and trunks (world units). */
const BODY_ROOM = 0.1;
/** A chamois walk ends on stony ground (it stays on the mountain). */
const STONY_END = 0.35;
/** Samples along a leg (world units). */
const LEG_STEP = 0.3;
const RABBIT_BIT = 1 << SPECIES.rabbit;

/**
 * Where a rock climber (chamois) may stand: dry ground up to a steep scree slope (the animals'
 * navigation forbids most of the mountain), clear of boulders and trunks, never under the
 * rendered rock (the mountain skin, rocks on faces the navigation leaves out).
 */
export const isRockFree = ({ nav, terrain }: CritterContext, x: number, z: number) => {
  if (terrain.depth(x, z) > 0.01 || terrain.slope(x, z) > CHAMOIS_SLOPE * 1.15) return false;
  if (terrain.underRock(x, z)) return false;
  return !nav || !isCircleBlocked(nav.colliders, RABBIT_BIT, x, z, BODY_ROOM);
};

/** A straight leg over free rock ground from `from`, ending on stony ground. */
export const isRockLegFree = (
  context: CritterContext,
  from: { x: number; z: number },
  x: number,
  z: number
) => {
  if (context.terrain.stony(x, z) < STONY_END) return false;
  const length = Math.hypot(x - from.x, z - from.z);
  const steps = Math.max(1, Math.ceil(length / LEG_STEP));
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    if (!isRockFree(context, from.x + (x - from.x) * t, from.z + (z - from.z) * t)) return false;
  }
  return true;
};
