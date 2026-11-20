import { isBlockingProp } from "../generation/gameplay";
import { somePropInCell, somePropNear } from "../prop-cell-index";
import { PROP_REMOVED, type WorldData } from "../world-data";
import { isDecorationKind } from "./decoration-editing";

/**
 * Editor authoring (owner 2026-11-10): decorations may stand as close as the author wants, down to half a
 * tile between centres. Water, cliffs, buildings, roads and trees keep refusing them as in the game.
 */
export const DECORATION_MIN_SPACING = .5;

interface Point { x: number; z: number }

/** No ground decoration prop centre closer than the minimum spacing (the ignored prop excepted). */
export const isGroundDecorationSpacingClear = (world: WorldData, point: Point, ignore = -1) =>
  !somePropNear(world, point.x, point.z, DECORATION_MIN_SPACING, id => {
    if (id === ignore) return false;
    const kind = world.props.types[id]!;
    if (kind === PROP_REMOVED || !isDecorationKind(kind)) return false;
    const dx = world.props.x[id]! - point.x;
    const dz = world.props.z[id]! - point.z;
    return dx * dx + dz * dz < DECORATION_MIN_SPACING * DECORATION_MIN_SPACING;
  });

/** No point of the list closer than the minimum spacing. */
export const isPointSpacingClear = (points: readonly Point[], point: Point) => points.every(other => {
  const dx = other.x - point.x;
  const dz = other.z - point.z;
  return dx * dx + dz * dz >= DECORATION_MIN_SPACING * DECORATION_MIN_SPACING;
});

/** Every live blocking prop of the cell is a ground decoration (a tree there still blocks). */
export const isDecorationOnlyCell = (world: WorldData, cell: number) => !somePropInCell(world, cell, id => {
  const kind = world.props.types[id]!;
  return kind !== PROP_REMOVED && isBlockingProp(kind) && !isDecorationKind(kind);
});
