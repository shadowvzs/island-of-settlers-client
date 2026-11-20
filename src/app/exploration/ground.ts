import { sampleBilinear,sampleSmooth } from "../../shared/world/grid-geometry";
import { BLOCKING,PROP,type WorldData } from "../../shared/world/world-data";
import { type ExplorationGroundQuery } from "./contracts";
import { createExplorationWadeQuery } from "./wading";

/** The occupancy surface the presentation explorer reads; no actor or reservation is created. */
export interface ExplorationGroundOccupancy {
  isOccupied: (x: number, z: number) => boolean;
  ownsTerritory: (point: { x: number; z: number }) => boolean;
}

/**
 * Trees with a trunk the body collides with. Saplings, shrubs and other plants are walked
 * through (owner 2026-11-09), as the settlers' own walk cost already treats them.
 */
const TREE_TYPES = new Set<number>([
  PROP.broadleafTree,
  PROP.birchTree,
  PROP.coniferTree,
  PROP.hardwoodTree,
  PROP.cedarTree,
  PROP.walnutTree,
  PROP.mahoganyTree,
  PROP.palmTree
]);
/** Trunk collision, not the whole tree cell: a person may walk between mature trees. */
const TREE_TRUNK_RADIUS = 0.14;
/** Water depth below this reads as dry ground at a sampled point. */
const MIN_WATER_DEPTH = 0.02;
/** Low stones the possessed body steps onto instead of treating as a wall (main stone only). */
const STEPPABLE_PROPS: ReadonlyMap<number, { radius: number; top: number }> = new Map([
  [PROP.smallRock, { radius: 0.3, top: 0.35 }],
  [PROP.pebbles, { radius: 0.11, top: 0.08 }]
]);

/** Completed bridge decks and shore ramps (the renderer's shared B01 surface), undefined elsewhere. */
export type ExplorationBridgeHeight = (x: number, z: number) => number | undefined;

/**
 * Read-only ground query for the temporary first-person body. Cell layers use cell indices;
 * heights and water depth are vertex layers and must be sampled bilinearly. A completed bridge
 * deck or ramp is dry, walkable ground at the shared deck height, even over the river.
 */
export const createExplorationGroundQuery = (
  world: WorldData,
  occupancy: ExplorationGroundOccupancy,
  bridgeHeight: ExplorationBridgeHeight = () => undefined
): ExplorationGroundQuery => {
  const onBridge = (x: number, z: number) => bridgeHeight(x, z) !== undefined;
  const shallowShore = createExplorationWadeQuery(world);
  const index = (x: number, z: number) => Math.floor(z) * world.cellsX + Math.floor(x);
  const treesByCell = new Map<number, { x: number; z: number }[]>();
  for (let tree = 0; tree < world.props.count; tree += 1) {
    if (!TREE_TYPES.has(world.props.types[tree]!)) continue;
    const x = world.props.x[tree]!, z = world.props.z[tree]!;
    const key = index(x, z);
    const bucket = treesByCell.get(key);
    if (bucket) bucket.push({ x, z });
    else treesByCell.set(key, [{ x, z }]);
  }
  const steppedProps = new Map<number, { base: number; radius: number; top: number; x: number; z: number }[]>();
  for (let prop = 0; prop < world.props.count; prop += 1) {
    const shape = STEPPABLE_PROPS.get(world.props.types[prop]!);
    if (!shape) continue;
    const scale = world.props.scale[prop] ?? 1;
    const x = world.props.x[prop]!, z = world.props.z[prop]!;
    const entry = { base: world.props.y[prop]!, radius: shape.radius * scale, top: shape.top * scale, x, z };
    const bucketKey = index(x, z);
    const bucket = steppedProps.get(bucketKey);
    if (bucket) bucket.push(entry);
    else steppedProps.set(bucketKey, [entry]);
  }
  /** Raise the walking surface over a low main stone; companions stay decorative. */
  const steppedGroundHeight = (x: number, z: number, terrainHeight: number) => {
    if (steppedProps.size === 0) return terrainHeight;
    let height = terrainHeight;
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (const prop of steppedProps.get((cz + dz) * world.cellsX + cx + dx) ?? []) {
          if (Math.hypot(prop.x - x, prop.z - z) > prop.radius) continue;
          height = Math.max(height, prop.base + prop.top);
        }
      }
    }
    return height;
  };
  const treeWithin = (x: number, z: number, radius: number) => {
    const minX = Math.max(0, Math.floor(x - radius - 1));
    const maxX = Math.min(world.cellsX - 1, Math.floor(x + radius + 1));
    const minZ = Math.max(0, Math.floor(z - radius - 1));
    const maxZ = Math.min(world.cellsZ - 1, Math.floor(z + radius + 1));
    for (let cz = minZ; cz <= maxZ; cz += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        for (const tree of treesByCell.get(cz * world.cellsX + cx) ?? []) {
          if (Math.hypot(tree.x - x, tree.z - z) <= radius) return true;
        }
      }
    }
    return false;
  };
  const inside = (x: number, z: number) =>
    Number.isFinite(x) && Number.isFinite(z) && x >= 0.12 && z >= 0.12 &&
    x < world.cellsX - 0.12 && z < world.cellsZ - 0.12;
  const water = (x: number, z: number) => {
    if (!inside(x, z)) return true;
    if (onBridge(x, z)) return false;
    const cell = index(x, z);
    return world.blocking[cell] === BLOCKING.water ||
      sampleBilinear(world, world.waterDepth, x, z) > MIN_WATER_DEPTH;
  };
  const walkable = (x: number, z: number) => {
    if (!inside(x, z)) return false;
    if (onBridge(x, z)) return true;
    const cell = index(x, z);
    // Tree/plant cells carry BLOCKING.prop but a positive walk cost; only terrain walls and
    // large rocks are impassable. Trunks get their own radius check below.
    return world.walkCost[cell]! > 0 &&
      world.blocking[cell] !== BLOCKING.water && world.blocking[cell] !== BLOCKING.cliff;
  };
  const wadeable = (x: number, z: number) => inside(x, z) && !onBridge(x, z) && shallowShore(x, z);
  /** Dry walkable ground, a bridge deck or shallow shore water. */
  const standable = (x: number, z: number) => wadeable(x, z) || (walkable(x, z) && !water(x, z));
  return {
    cellsX: world.cellsX,
    cellsZ: world.cellsZ,
    groundHeight: (x, z) => bridgeHeight(x, z) ?? steppedGroundHeight(x, z, sampleSmooth(world, world.heights, x, z)),
    isClear: (x, z, radius) => {
      if (!standable(x, z) || occupancy.isOccupied(x, z)) return false;
      // The deck is clear between its railings: the river cells under it never block the body.
      if (onBridge(x, z)) return true;
      if (treeWithin(x, z, Math.max(0, radius) + TREE_TRUNK_RADIUS)) return false;
      const reach = Math.max(0, radius) + 0.6;
      const minX = Math.max(0, Math.floor(x - reach)), maxX = Math.min(world.cellsX - 1, Math.ceil(x + reach));
      const minZ = Math.max(0, Math.floor(z - reach)), maxZ = Math.min(world.cellsZ - 1, Math.ceil(z + reach));
      for (let cz = minZ; cz <= maxZ; cz++)
        for (let cx = minX; cx <= maxX; cx++) {
          if ((cx + .5 - x) ** 2 + (cz + .5 - z) ** 2 > reach ** 2) continue;
          const cell = cz * world.cellsX + cx;
          // Water is not a wall: the body's own point test decides how far it may wade.
          const wall = world.walkCost[cell] === 0 && world.blocking[cell] !== BLOCKING.water;
          if (wall || occupancy.isOccupied(cx + .5, cz + .5)) return false;
        }
      return true;
    },
    isOwned: (x, z) => occupancy.ownsTerritory({ x, z }),
    isWadeable: wadeable,
    isWalkable: walkable,
    isWater: water
  };
};
