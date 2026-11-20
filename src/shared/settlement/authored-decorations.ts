import { isDecorationKind } from "../world/editing/decoration-editing";
import {
  DECORATION_MIN_SPACING, isDecorationOnlyCell, isGroundDecorationSpacingClear
} from "../world/editing/decoration-spacing";
import type { ScenarioDecoration } from "../world/scenario-decorations";
import { BLOCKING } from "../world/world-data";
import { createRoadDecorationContext } from "./road-decoration-context";
import { createRoadDecorationState, type RoadDecorationSave } from "./road-decoration-state";
import type { SettlementContext } from "./settlement-types";

/**
 * Map-authored decorations (editor palette rows): the game's placement rules (real model volumes against
 * water, cliffs, buildings, roads, trees and rocks) with the authoring relaxations (owner 2026-11-10):
 * any point on the map counts as owned, ground decoration props and other authored rows only need half a
 * tile between centres, and a cell blocked only by ground decorations is usable ground. Both the editor
 * layout and the played map's fixed scenery use this one owner.
 */
export const createAuthoredDecorationState = (context: SettlementContext) => {
  const { world } = context.options;
  const adapter = createRoadDecorationContext(context, { ignoreProp: isDecorationKind });
  const isOnMap = (point: { x: number; z: number }) =>
    point.x >= 0 && point.z >= 0 && point.x < world.cellsX && point.z < world.cellsZ;
  const isDecorationGround = (point: { x: number; z: number }) => {
    const cell = Math.floor(point.z) * world.cellsX + Math.floor(point.x);
    return world.blocking[cell] === BLOCKING.prop && isDecorationOnlyCell(world, cell);
  };
  const create = () => {
    const base = adapter.create();
    return { ...base, isOwned: isOnMap,
      canPlaceGround: (point: { x: number; z: number }) => base.canPlaceGround!(point) || isDecorationGround(point) };
  };
  return createRoadDecorationState(create, () => undefined, {
    minSpacing: DECORATION_MIN_SPACING, spotClear: point => isGroundDecorationSpacingClear(world, point)
  });
};

export type AuthoredDecorationState = ReturnType<typeof createAuthoredDecorationState>;

/** Authored rows as an owner save: stable uids are the row order (1-based); refused rows return once. */
export const toAuthoredDecorationSave = (rows: readonly ScenarioDecoration[]): RoadDecorationSave => ({
  nextReturn: 1, nextUid: rows.length + 1, returns: [],
  placed: rows.map((row, index) => ({ item: row.item, position: { x: row.x, z: row.z }, uid: index + 1, yaw: row.yaw }))
});
