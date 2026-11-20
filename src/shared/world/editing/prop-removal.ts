import { DMath } from "../../math/deterministic-math";
import { releasePropCells } from "../build-class";
import { getCellsRegion } from "../grid-geometry";
import { PROP, PROP_REMOVED, type WorldData } from "../world-data";
import { type Brush,listPaintedCells } from "./brush";
import { refreshWalkCost } from "./build-refresh";

/**
 * Small props a painted ground tile clears: bushes, shrubs, flowers, ferns, mushrooms, reeds,
 * saplings and the meadow stones. Grown trees and the mountain rock stay.
 */
export const CLEARED_BY_PAINT: ReadonlySet<number> = new Set<number>([
  PROP.bush,
  PROP.smallRock,
  PROP.largeRock,
  PROP.pebbles,
  PROP.flowers,
  PROP.mushrooms,
  PROP.reeds,
  PROP.cattail,
  PROP.riverShrub,
  PROP.willowShrub,
  PROP.sedge,
  PROP.berryBush,
  PROP.fern,
  PROP.sapling,
  PROP.broadleafShrub,
  PROP.fieldShrub,
  PROP.waterLily
]);

/**
 * Removes the props (their entries become PROP_REMOVED, indices stay valid) and frees their
 * cells: blocking, walk cost and the build class around them follow.
 */
export const removePropsAt = (world: WorldData, indices: readonly number[]) => {
  const { props } = world;
  const cells = new Set<number>();
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= props.count) continue;
    props.types[index] = PROP_REMOVED;
    const x = Math.min(world.cellsX - 1, Math.max(0, Math.floor(props.x[index]!)));
    const z = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(props.z[index]!)));
    cells.add(z * world.cellsX + x);
  }
  if (!cells.size) return;
  releasePropCells(world, cells);
  refreshWalkCost(world, getCellsRegion(world, [...cells]));
};

/** Meadow rock props: their stones are drawn by the rock layer (rebuilt where they went). */
export const STONE_PROPS: ReadonlySet<number> = new Set<number>([
  PROP.smallRock,
  PROP.largeRock,
  PROP.pebbles
]);

/** Plants a remover clears (the small props of CLEARED_BY_PAINT that are not stones). */
export const PLANT_PROPS: ReadonlySet<number> = new Set(
  [...CLEARED_BY_PAINT].filter((kind) => !STONE_PROPS.has(kind))
);

/** Trees (and saplings) the tree remover takes away. */
export const TREE_PROPS: ReadonlySet<number> = new Set<number>([
  PROP.cedarTree,
  PROP.walnutTree,
  PROP.mahoganyTree,
  PROP.hardwoodTree,
  PROP.broadleafTree,
  PROP.coniferTree,
  PROP.palmTree,
  PROP.birchTree,
  PROP.sapling
]);

const getPropCell = (world: WorldData, index: number) =>
  Math.floor(world.props.z[index]!) * world.cellsX + Math.floor(world.props.x[index]!);

/**
 * Removes the props that pass `wanted` and stand where `inside` says; returns them and the
 * cells where removed meadow stones stood (their stones are rebuilt).
 */
const removeWhere = (
  world: WorldData,
  wanted: (index: number) => boolean,
  inside: (index: number) => boolean
) => {
  const { props } = world;
  const removed: number[] = [];
  const stoneCells: number[] = [];
  for (let index = 0; index < props.count; index += 1) {
    if (props.types[index] === PROP_REMOVED || !wanted(index) || !inside(index)) continue;
    removed.push(index);
    if (STONE_PROPS.has(props.types[index]!)) stoneCells.push(getPropCell(world, index));
  }
  removePropsAt(world, removed);
  return { removed, stoneCells: getCellsRegion(world, stoneCells) };
};

/** The small props (CLEARED_BY_PAINT) standing on the cells the brush paints, removed. */
export const clearPaintedProps = (world: WorldData, brush: Brush) => {
  const cells = new Set(listPaintedCells(world, brush).map(({ cell }) => cell));
  return removeWhere(
    world,
    (index) => CLEARED_BY_PAINT.has(world.props.types[index]!),
    (index) => cells.has(getPropCell(world, index))
  );
};

/**
 * Removes the props that pass `wanted` within the brush (map editor removers: plants, trees,
 * the editor's own props when the ground is reset); the ground stays as it is.
 */
export const removePropsInBrush = (
  world: WorldData,
  brush: Brush,
  wanted: (index: number) => boolean
) =>
  removeWhere(world, wanted, (index) => {
    const { x, z } = world.props;
    return DMath.hypot(x[index]! - brush.x, z[index]! - brush.z) <= brush.radius;
  });
