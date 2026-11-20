import { DMath } from "../math/deterministic-math";
import type { RoadPoint } from "./road-types";

type RoadSection = Readonly<Record<"end" | "start", RoadPoint>>;

/**
 * The closest `count` road endpoints to `from`: public road nodes, or the buildings' flags while
 * no road exists yet (a fresh headquarters). Nearest first, without duplicates.
 */
export const nearestRoadEndpoints = (
  segments: readonly RoadSection[], flags: () => readonly RoadPoint[], from: RoadPoint, count: number
) => {
  const nearest: RoadPoint[] = [], gaps: number[] = [];
  const consider = (point: RoadPoint) => {
    const gap = DMath.hypot(point.x - from.x, point.z - from.z);
    if (gaps.length === count && gap >= gaps[count - 1]!) return;
    let index = gaps.length;
    while (index > 0 && gaps[index - 1]! > gap) index--;
    if (nearest.some((other) => other.x === point.x && other.z === point.z)) return;
    nearest.splice(index, 0, point); gaps.splice(index, 0, gap);
    if (nearest.length > count) { nearest.pop(); gaps.pop(); }
  };
  for (const section of segments) { consider(section.start); consider(section.end); }
  if (segments.length) return nearest;
  for (const flag of flags()) consider(flag);
  return nearest;
};
