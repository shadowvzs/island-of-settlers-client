import { getKnownRocks } from "../../render-common/rocks/island-rock-instances";
import { ROCK_ROLE, type RockInstance } from "../../render-common/rocks/rock-instances";
import { DMath } from "../math/deterministic-math";
import { PROP, type WorldData } from "../world/world-data";
import type { RoadPoint, RoadWorld } from "./road-types";

interface Footprint { x: number; z: number; halfX: number; halfZ: number }
const BUCKET_SIZE = 4;
const EMPTY_ROCKS: RockInstance[] = [];
const caches = new WeakMap<RoadWorld, {
  rocks: readonly RockInstance[]; rockCount: number; props: WorldData["props"] | undefined; count: number;
  revision: number | undefined; terrainRevision: number | undefined;
  buckets: Map<number, Footprint[]>;
}>();
/** Numeric bucket key; unique for the bucket indices any island uses (|index| < 32768). */
const key = (x: number, z: number) => (z + 32768) * 65536 + x + 32768;
const index = (value: number) => Math.floor(value / BUCKET_SIZE);
const collect = (world: RoadWorld) => {
  const source = world as RoadWorld & Partial<Pick<WorldData, "props">>;
  const known = getKnownRocks(world as WorldData), rocks = known.length ? known : EMPTY_ROCKS;
  const props = source.props, count = props?.count ?? 0;
  const previous = caches.get(world);
  if (previous && previous.rocks === rocks && previous.rockCount === rocks.length && previous.props === props && previous.count === count &&
    previous.revision === world.buildRevision && previous.terrainRevision === world.terrainRevision) return previous.buckets;
  const buckets = new Map<number, Footprint[]>();
  const add = (footprint: Footprint) => {
    for (let z = index(footprint.z - footprint.halfZ); z <= index(footprint.z + footprint.halfZ); z++)
      for (let x = index(footprint.x - footprint.halfX); x <= index(footprint.x + footprint.halfX); x++) {
        const id = key(x, z), bucket = buckets.get(id) ?? [];
        bucket.push(footprint); buckets.set(id, bucket);
      }
  };
  for (const rock of rocks) {
    if (rock.role === ROCK_ROLE.pebble || rock.role === ROCK_ROLE.mass) continue;
    const half = [0, 1, 2].map(axis => rock.axes.reduce((sum, vector) => sum + Math.abs(vector[axis]!), 0) / 2);
    if (Math.max(half[0]!, half[2]!) < .3 || half[1]! < .04) continue;
    add({ x: rock.centre[0], z: rock.centre[2], halfX: half[0]!, halfZ: half[2]! });
  }
  for (let i = 0; i < count; i++) {
    if (props!.types[i] !== PROP.largeRock) continue;
    // createPropStones: companion reach <= .55*1.8, radius <= .55*.6;
    // its widest half-axis <= radius*1.4, plus the small authored lean. Include the whole visible cluster.
    const half = 1.55 * (props!.scale?.[i] ?? 1);
    add({ x: props!.x[i]!, z: props!.z[i]!, halfX: half, halfZ: half });
  }
  caches.set(world, { rocks, rockCount: rocks.length, props, count, revision: world.buildRevision, terrainRevision: world.terrainRevision, buckets });
  return buckets;
};

/** Construction only: old roads retain their travel graph even when a visible rock overlaps them. */
export const roadIntersectsVisibleRock = (world: RoadWorld, start: RoadPoint, end: RoadPoint, width: number) => {
  const buckets = collect(world), half = width / 2;
  const dx = end.x - start.x, dz = end.z - start.z, length = DMath.hypot(dx, dz);
  if (!length) return false;
  const x = (start.x + end.x) / 2, z = (start.z + end.z) / 2;
  const ux = dx / length, uz = dz / length;
  // Include the round public-road endpoint/junction cap as well as its straight reserved strip.
  const along = length / 2 + half;
  const extentX = Math.abs(ux) * along + Math.abs(uz) * half;
  const extentZ = Math.abs(uz) * along + Math.abs(ux) * half;
  for (let bz = index(z - extentZ); bz <= index(z + extentZ); bz++)
    for (let bx = index(x - extentX); bx <= index(x + extentX); bx++) {
      const bucket = buckets.get(key(bx, bz));
      if (!bucket) continue;
      for (const rock of bucket) {
        const rx = rock.x - x, rz = rock.z - z;
        if (Math.abs(rx) > extentX + rock.halfX || Math.abs(rz) > extentZ + rock.halfZ) continue;
        if (Math.abs(rx * ux + rz * uz) > along + Math.abs(ux) * rock.halfX + Math.abs(uz) * rock.halfZ) continue;
        if (Math.abs(-rx * uz + rz * ux) > half + Math.abs(uz) * rock.halfX + Math.abs(ux) * rock.halfZ) continue;
        return true;
      }
    }
  return false;
};
