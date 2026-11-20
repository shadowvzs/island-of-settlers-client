import type { WorldData } from "../../../shared/world/world-data";
import { getTreeSpecies } from "../../props/island-trees";

/** Side of the buckets that index the climbable trees (world units). */
const TREE_BUCKET = 4;
/** Where a climbing critter disappears into the crown: this share of the tree's placement scale. */
const CROWN_ENTRY = 1.25;

/** How far in front of a point (towards the camera) and to its sides a crown hides it. */
const VIEW_REACH = 7;
const VIEW_SIDE = 1.7;
const BEHIND = 0.8;

/** A tree at this offset is between the point and the camera (or right at the point). */
const isInFront = (dx: number, dz: number) => {
  const along = (dx + dz) * Math.SQRT1_2;
  return along > -BEHIND && along < VIEW_REACH && Math.abs(dx - dz) * Math.SQRT1_2 < VIEW_SIDE;
};

/**
 * The trees by area: squirrels climb oaks, pines and birches (`findNearest` leaves palms out),
 * every crown (palms too) hides the ground behind it from the camera. Felled
 * trees are skipped through `isStanding`.
 */
export const createClimbableTrees = (
  world: WorldData,
  isStanding: (tree: number) => boolean = () => true
) => {
  const bucketsX = Math.ceil(world.cellsX / TREE_BUCKET);
  const bucketsZ = Math.ceil(world.cellsZ / TREE_BUCKET);
  const { props } = world;
  let buckets: number[][] = [];

  /** Every tree by its bucket (again after map edits placed or removed trees). */
  const fillBuckets = () => {
    buckets = Array.from({ length: bucketsX * bucketsZ }, () => []);
    for (let tree = 0; tree < props.count; tree += 1) {
      const species = getTreeSpecies(props.types[tree]!);
      if (!species) continue;
      const bucketX = Math.min(bucketsX - 1, Math.floor(props.x[tree]! / TREE_BUCKET));
      const bucketZ = Math.min(bucketsZ - 1, Math.floor(props.z[tree]! / TREE_BUCKET));
      buckets[bucketZ * bucketsX + bucketX]!.push(tree);
    }
  };
  fillBuckets();

  const isPalm = (tree: number) => getTreeSpecies(props.types[tree]!) === "palm";

  /** The nearest standing tree within `radius` other than `except` (-1 none). */
  const findNearest = (x: number, z: number, radius: number, except = -1) => {
    let best = -1;
    let bestDistance = radius;
    const minX = Math.max(0, Math.floor((x - radius) / TREE_BUCKET));
    const maxX = Math.min(bucketsX - 1, Math.floor((x + radius) / TREE_BUCKET));
    const minZ = Math.max(0, Math.floor((z - radius) / TREE_BUCKET));
    const maxZ = Math.min(bucketsZ - 1, Math.floor((z + radius) / TREE_BUCKET));
    for (let bucketZ = minZ; bucketZ <= maxZ; bucketZ += 1) {
      for (let bucketX = minX; bucketX <= maxX; bucketX += 1) {
        for (const tree of buckets[bucketZ * bucketsX + bucketX]!) {
          const distance = Math.hypot(props.x[tree]! - x, props.z[tree]! - z);
          if (tree === except || distance >= bestDistance || isPalm(tree)) continue;
          if (!isStanding(tree)) continue;
          best = tree;
          bestDistance = distance;
        }
      }
    }
    return best;
  };

  /**
   * Whether a crown or trunk stands between a ground point and the iso camera (towards +x +z:
   * the view ray rises 30 degrees, so crowns up to about 7 units in front hide the point).
   */
  const hidesFromView = (x: number, z: number) => {
    const minX = Math.max(0, Math.floor((x - VIEW_SIDE) / TREE_BUCKET));
    const maxX = Math.min(bucketsX - 1, Math.floor((x + VIEW_REACH) / TREE_BUCKET));
    const minZ = Math.max(0, Math.floor((z - VIEW_SIDE) / TREE_BUCKET));
    const maxZ = Math.min(bucketsZ - 1, Math.floor((z + VIEW_REACH) / TREE_BUCKET));
    for (let bucketZ = minZ; bucketZ <= maxZ; bucketZ += 1) {
      for (let bucketX = minX; bucketX <= maxX; bucketX += 1) {
        for (const tree of buckets[bucketZ * bucketsX + bucketX]!) {
          if (isInFront(props.x[tree]! - x, props.z[tree]! - z) && isStanding(tree)) return true;
        }
      }
    }
    return false;
  };

  return {
    findNearest,
    /** Map editor: the trees were placed or removed (the buckets are filled again). */
    refresh: fillBuckets,
    hidesFromView,
    /** Height where the trunk enters the crown (the climber vanishes into the leaves there). */
    getCrownHeight: (tree: number) => props.y[tree]! + props.scale[tree]! * CROWN_ENTRY,
    x: (tree: number) => props.x[tree]!,
    z: (tree: number) => props.z[tree]!
  };
};

export type ClimbableTrees = ReturnType<typeof createClimbableTrees>;
