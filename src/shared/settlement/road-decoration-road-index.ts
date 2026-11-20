import type { RoadDecorationBounds } from "../../render-common/road-decoration-clearance";
import type { RoadSegment } from "./road-types";

interface Source {
  revision?: number;
  segments?: () => readonly (Pick<RoadSegment, "start" | "end"> & Partial<RoadSegment>)[];
}
/** Mutation-only spatial rebuild. Nearby decoration plans never traverse every road in a large town. */
export const createRoadDecorationRoadIndex = (source: Source) => {
  let revision: number | undefined, rebuilds = 0, buckets = new Map<string, RoadSegment[]>();
  const refresh = () => {
    if (source.revision !== undefined && source.revision === revision) return;
    revision = source.revision; rebuilds++; buckets = new Map();
    for (const row of source.segments?.() ?? []) {
      if (row.preview) continue;
      const road: RoadSegment = { ...row, tier: row.tier ?? "dirt" };
      for (let z = Math.floor(Math.min(road.start.z, road.end.z) / 4); z <= Math.floor(Math.max(road.start.z, road.end.z) / 4); z++)
        for (let x = Math.floor(Math.min(road.start.x, road.end.x) / 4); x <= Math.floor(Math.max(road.start.x, road.end.x) / 4); x++) {
          const key = `${x}:${z}`, list = buckets.get(key) ?? []; list.push(road); buckets.set(key, list);
        }
    }
  };
  return {
    near: (box: RoadDecorationBounds, margin = 1.5) => {
      refresh(); const result = new Set<RoadSegment>();
      for (let z = Math.floor((box.min[2] - margin) / 4); z <= Math.floor((box.max[2] + margin) / 4); z++)
        for (let x = Math.floor((box.min[0] - margin) / 4); x <= Math.floor((box.max[0] + margin) / 4); x++)
          for (const road of buckets.get(`${x}:${z}`) ?? []) result.add(road);
      return [...result];
    },
    counters: () => ({ rebuilds, buckets: buckets.size })
  };
};
