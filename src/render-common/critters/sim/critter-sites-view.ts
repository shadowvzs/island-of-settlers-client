import { AMBIENT_DENSITY } from "../../ambient-density";
import { getLiftedViewDistance, type ViewRegion } from "../../birds/bird-view";
import type { CameraState } from "../../camera-state";
import type { EnvironmentState } from "../../environment";
import type { CritterColony } from "../critter-colonies";
import { type CritterSites,SITE_BUCKET } from "../habitat/critter-sites";

/** Sites this far outside the view (world units) are already occupied (no pop-in at edges). */
const VIEW_MARGIN = 6;
/** Below this zoom only half of a colony's view cap is used. */
const FULL_CAP_ZOOM = 0.9;

export interface SiteFilter {
  /** Site index → may it be occupied now (fog, away, setting)? */
  allows: (site: number) => boolean;
  camera: CameraState;
  colonies: readonly CritterColony[];
  environment: EnvironmentState;
  region: ViewRegion;
}

/** Bucket range covering the view's ground footprint plus the margin. */
const getBucketRange = (sites: CritterSites, region: ViewRegion) => {
  const reach = Math.hypot(region.halfU, region.halfV) + VIEW_MARGIN;
  const clampX = (value: number) => Math.min(sites.bucketsX - 1, Math.max(0, value));
  const clampZ = (value: number) => Math.min(sites.bucketsZ - 1, Math.max(0, value));
  return {
    maxX: clampX(Math.floor((region.centerX + reach) / SITE_BUCKET)),
    maxZ: clampZ(Math.floor((region.centerZ + reach) / SITE_BUCKET)),
    minX: clampX(Math.floor((region.centerX - reach) / SITE_BUCKET)),
    minZ: clampZ(Math.floor((region.centerZ - reach) / SITE_BUCKET))
  };
};

const getCap = (colony: CritterColony, zoom: number, food: boolean) => {
  if (zoom < colony.minZoom) return 0;
  const cap = zoom < FULL_CAP_ZOOM ? Math.ceil(colony.viewCap / 2) : colony.viewCap;
  return food ? cap : Math.ceil(cap * AMBIENT_DENSITY);
};

/**
 * The sites to occupy now: around the view (plus a margin), occupied by the time of day (the
 * site's roll under the colony's activity), allowed by the filter, the nearest ones of each
 * colony up to its zoom dependent cap. Writes the chosen site indices into `chosen`.
 */
export const chooseSites = (sites: CritterSites, filter: SiteFilter, chosen: Set<number>) => {
  chosen.clear();
  const { colonies, region } = filter;
  const nearby: { distance: number; site: number }[][] = colonies.map(() => []);
  const range = getBucketRange(sites, region);
  const limit = 1 + VIEW_MARGIN / Math.max(1, Math.min(region.halfU, region.halfV));
  for (let bucketZ = range.minZ; bucketZ <= range.maxZ; bucketZ += 1) {
    for (let bucketX = range.minX; bucketX <= range.maxX; bucketX += 1) {
      for (const index of sites.buckets[bucketZ * sites.bucketsX + bucketX]!) {
        const site = sites.list[index]!;
        const lift = site.y + (colonies[site.colony]!.flight ?? 0);
        const distance = getLiftedViewDistance(region, site.x, lift, site.z);
        if (distance > limit || !filter.allows(index)) continue;
        if (site.roll >= colonies[site.colony]!.activity(filter.environment)) continue;
        nearby[site.colony]!.push({ distance, site: index });
      }
    }
  }
  nearby.forEach((list, colony) => {
    list.sort((a, b) => a.distance - b.distance);
    const food = list.length > 0 && sites.list[list[0]!.site]!.food;
    const cap = getCap(colonies[colony]!, filter.camera.zoom, food);
    for (const { site } of list.slice(0, cap)) chosen.add(site);
  });
  return chosen;
};
