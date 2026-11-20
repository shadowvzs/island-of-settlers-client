import { CatmullRomCurve3, Euler, Vector3 } from "three";

import type { Point3 } from "../buildings/building-recipe";
import type { CatalogConiferSpray } from "./catalog-columnar-graph";
import type { OrnamentalLimb } from "./ornamental-tree-graph";
import type { GardenTreeLeaf } from "./roman-garden-tree-graph";

export interface CatalogPlantVolume { min: Point3; max: Point3 }

const box = (): CatalogPlantVolume => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const include = (bounds: CatalogPlantVolume, point: readonly number[], radius = 0) => {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis]!, point[axis]! - radius);
    bounds.max[axis] = Math.max(bounds.max[axis]!, point[axis]! + radius);
  }
};

/** CPU placement bounds use each actual limb and leaf-bearing shoot, never one crown box down to ground. */
export const catalogWillowColumnarVolumes = (
  graphs: readonly { limbs: OrnamentalLimb[]; leaves: GardenTreeLeaf[]; sprays?: CatalogConiferSpray[] }[],
  potted: boolean
): readonly CatalogPlantVolume[] => {
  const result: CatalogPlantVolume[] = [];
  for (const graph of graphs) {
    for (const limb of graph.limbs) {
      const bounds = box(), curve = new CatmullRomCurve3(limb.path.map(point => new Vector3(...point)));
      for (let sample = 0; sample <= 64; sample++) {
        const t = sample / 64;
        const radius = (limb.radius * (1 - t) ** .95 + limb.tipRadius * t) * 1.094;
        include(bounds, curve.getPointAt(t).toArray(), radius + .001);
      }
      result.push(bounds);
    }
    const shoots = new Map<number, CatalogPlantVolume>();
    for (const leaf of graph.leaves) {
      const limb = leaf.petiole!.limb;
      const bounds = shoots.get(limb) ?? box(); shoots.set(limb, bounds);
      const rotation = new Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ");
      const origin = new Vector3(...leaf.position);
      for (const [x = 0, t = 0] of [[0, 0], [-.3, .18], [-.5, .3], [-.5, .42], [-.5, .43],
        [-.3, .73], [0, 1], [.3, .73], [.5, .3], [.5, .42], [.5, .43], [.3, .18]]) {
        const point = new Vector3(x * leaf.width, Math.sin(t * Math.PI) * leaf.length * .025,
          t * leaf.length).applyEuler(rotation).add(origin);
        include(bounds, point.toArray(), .001);
      }
      for (const keel of [.065, .085]) include(bounds, new Vector3(0, leaf.length * keel, leaf.length * .48)
        .applyEuler(rotation).add(origin).toArray(), .001);
      if (leaf.petiole) {
        include(bounds, leaf.petiole.node, leaf.petiole.radius);
        include(bounds, leaf.position, leaf.petiole.radius);
      }
    }
    result.push(...shoots.values());
    for (const spray of graph.sprays ?? []) {
      const bounds = box(), curve = new CatmullRomCurve3(spray.path.map(point => new Vector3(...point)));
      for (let sample = 0; sample <= 32; sample++) {
        const t = sample / 32;
        const radius = (Math.sin(Math.PI * t) + t * .8) * spray.width + .004;
        include(bounds, curve.getPointAt(t).toArray(), radius + .001);
      }
      result.push(bounds);
    }
  }
  if (potted) result.push({ min: [-.19, 0, -.19], max: [.19, .30, .19] });
  return result;
};
