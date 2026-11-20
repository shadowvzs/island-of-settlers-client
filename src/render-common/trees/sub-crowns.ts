import { dot, normalize, type Vec3 } from "../props/mesh-builder";
import { add, scale, subtract } from "../props/tree-parts";
import type { FoliageSpray } from "./tree-model";

/** Light from above and slightly to the side: the lit cap of every leaf clump. */
const CLUMP_LIGHT = normalize([0.25, 0.9, 0.2]);
/** How much the clump's own roundness wins over the whole crown's (normals and shade). */
const CLUMP_WEIGHT = 0.55;


interface Clump {
  centre: Vec3;
  radius: number;
}

/** Centre (mean spray position) and radius (farthest spray) of every clump. */
const measureClumps = (foliage: FoliageSpray[], clumps: number[]) => {
  const sums = new Map<number, { count: number; sum: Vec3 }>();
  foliage.forEach((spray, index) => {
    const entry = sums.get(clumps[index]!) ?? { count: 0, sum: [0, 0, 0] };
    sums.set(clumps[index]!, { count: entry.count + 1, sum: add(entry.sum, spray.position) });
  });
  const result = new Map<number, Clump>();
  for (const [id, { count, sum }] of sums) {
    result.set(id, { centre: scale(sum, 1 / count), radius: 0 });
  }
  foliage.forEach((spray, index) => {
    const clump = result.get(clumps[index]!)!;
    clump.radius = Math.max(clump.radius, Math.hypot(...subtract(spray.position, clump.centre)));
  });
  return result;
};

/**
 * Sub-crowns: the sprays of one branch form a clump with its own lit cap and shaded underside,
 * so the crown reads as several rounded masses with gaps instead of one smooth ball. `clumps`
 * holds the clump id of every spray (the branch that carries it).
 */
export const shapeSubCrowns = (foliage: FoliageSpray[], clumps: number[]) => {
  const measured = measureClumps(foliage, clumps);
  foliage.forEach((spray, index) => {
    const clump = measured.get(clumps[index]!)!;
    const offset = subtract(spray.position, clump.centre);
    const distance = Math.hypot(...offset);
    if (distance < 1e-4 || clump.radius < 1e-4) return;
    const local = scale(offset, 1 / distance);
    const rim = distance / clump.radius;
    const light = 0.45 + dot(local, CLUMP_LIGHT) * 0.35 + rim * 0.2 - 0.1;
    spray.outward = normalize(
      add(scale(spray.outward, 1 - CLUMP_WEIGHT), scale(local, CLUMP_WEIGHT))
    );
    spray.shade = Math.min(1, Math.max(0, spray.shade * 0.6 + light * 0.4));
  });
};
