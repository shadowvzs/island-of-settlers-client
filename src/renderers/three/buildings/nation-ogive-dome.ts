import { LatheGeometry, Vector2 } from "three";

import { ogiveProfilePoint } from "../../../render-common/buildings/nation-ogive-profile";

/**
 * Smooth pointed (ogive) mud dome filling the unit box: base ring at y -0.5, apex at y 0.5.
 * The base stays open; the drum or ring it rests on closes it.
 */
export const createNationOgiveDome = (detailed: boolean, radialSegments?: number) => {
  const rows = detailed ? 8 : 4;
  const profile = Array.from({ length: rows + 1 }, (_, row) => {
    const [radius, y] = ogiveProfilePoint(row / rows);
    return new Vector2(radius, y);
  });
  return new LatheGeometry(profile, radialSegments ?? (detailed ? 18 : 10));
};
