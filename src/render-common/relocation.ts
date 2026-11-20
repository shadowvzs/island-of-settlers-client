import { DMath } from "../shared/math/deterministic-math";
/** Rings searched for a spot outside an edited area (cells) and directions per ring. */
const RINGS = 40;
const DIRECTIONS = 16;

/**
 * The nearest spot around (x, z) outside an area where something may stand (map editor terrain
 * edits move animals and workers out of a new mountain or lake), or null when none within reach.
 */
export const findSpotOutside = (
  x: number,
  z: number,
  isInside: (x: number, z: number) => boolean,
  isFree: (x: number, z: number) => boolean
) => {
  for (let ring = 1; ring <= RINGS; ring += 1) {
    for (let step = 0; step < DIRECTIONS; step += 1) {
      const angle = (step / DIRECTIONS) * Math.PI * 2;
      const spotX = x + DMath.cos(angle) * ring;
      const spotZ = z + DMath.sin(angle) * ring;
      if (!isInside(spotX, spotZ) && isFree(spotX, spotZ)) return { x: spotX, z: spotZ };
    }
  }
  return null;
};
