import { NATIVE_PROP_CLEARANCE_BOUNDS } from "../../render-common/props/prop-clearance-bounds";
import { getPlacedPropInstance } from "../../render-common/props/prop-instances";
import type { RoadDecorationBounds } from "../../render-common/road-decoration-clearance";
import { getKnownRocks } from "../../render-common/rocks/island-rock-instances";
import type { RockInstance } from "../../render-common/rocks/rock-instances";
import type { WorldData } from "../world/world-data";

const overlaps = (a: RoadDecorationBounds, b: RoadDecorationBounds) => [0, 1, 2].every(axis =>
  a.min[axis]! < b.max[axis]! - .000001 && a.max[axis]! > b.min[axis]! + .000001);
const MAX_WIND = Math.hypot(.8, .35) * 2.7;

/** Session-owned canonical plant mesh extents and indexed remembered rock envelopes; no retained world singleton. */
export const createRoadDecorationPropClearance = (world: WorldData) => {
  const plantBounds = new Map<number, { radius: number; height: number; low: number }>();
  let rocks: readonly RockInstance[] | undefined;
  const rockBuckets = new Map<string, Set<RoadDecorationBounds>>();
  const keys = (box: RoadDecorationBounds) => {
    const keys: string[] = [];
    for (let z = Math.floor(box.min[2] / 4); z <= Math.floor(box.max[2] / 4); z++)
      for (let x = Math.floor(box.min[0] / 4); x <= Math.floor(box.max[0] / 4); x++) keys.push(`${x}:${z}`);
    return keys;
  };
  const plantsOverlap = (index: number, target: RoadDecorationBounds) => {
    const placed = getPlacedPropInstance(world, index);
    if (!placed) return false;
    let bounds = plantBounds.get(placed.meshId);
    if (!bounds) {
      const native = NATIVE_PROP_CLEARANCE_BOUNDS[placed.meshId];
      if (!native) throw new Error(`Missing canonical prop clearance ${placed.meshId}`);
      const [height = 0, radius = 0, sway = 0, flutter = 0, low = 0] = native;
      bounds = { radius: radius + MAX_WIND * (sway * sway * .14 + flutter * .015 * Math.SQRT2),
        height: height + MAX_WIND * (sway * sway * .03 + flutter * .009), low };
      plantBounds.set(placed.meshId, bounds);
    }
    const radius = bounds.radius * placed.scale, high = bounds.height * placed.scale * placed.stretch;
    return overlaps({ min: [placed.x - radius, placed.y + bounds.low * placed.scale * placed.stretch, placed.z - radius],
      max: [placed.x + radius, placed.y + high, placed.z + radius] }, target);
  };
  const rocksOverlap = (target: RoadDecorationBounds) => {
    const known = getKnownRocks(world);
    if (!known.length) return false;
    if (rocks !== known) {
      rocks = known; rockBuckets.clear();
      for (const rock of known) {
        const extent = [0, 1, 2].map(axis => rock.axes.reduce((sum, vector) => sum + Math.abs(vector[axis]!), 0) / 2 + .04);
        const box: RoadDecorationBounds = { min: [rock.centre[0] - extent[0]!, rock.centre[1] - extent[1]!, rock.centre[2] - extent[2]!],
          max: [rock.centre[0] + extent[0]!, rock.centre[1] + extent[1]!, rock.centre[2] + extent[2]!] };
        for (const key of keys(box)) { const bucket = rockBuckets.get(key) ?? new Set(); bucket.add(box); rockBuckets.set(key, bucket); }
      }
    }
    for (const key of keys(target)) for (const box of rockBuckets.get(key) ?? []) if (overlaps(box, target)) return true;
    return false;
  };
  return { plantsOverlap, rocksOverlap };
};
