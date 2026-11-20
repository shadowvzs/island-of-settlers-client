import { SHIP_DECK_HORSE_WORLD } from "../../render-common/ships/ship-deck-layout";
import { DMath } from "../math/deterministic-math";
import { distanceToSegment } from "./settlement-geometry";
import type { SettlementActor } from "./settlement-types";

/** A horse from above: a capsule this wide round a core along its heading (tiles). */
const HORSE_RADIUS = SHIP_DECK_HORSE_WORLD.width / 2;
const HORSE_CORE = SHIP_DECK_HORSE_WORLD.depth / 2 - HORSE_RADIUS;

const horseCore = (horse: SettlementActor) => {
  const dx = DMath.sin(horse.yaw) * HORSE_CORE, dz = DMath.cos(horse.yaw) * HORSE_CORE;
  return [{ x: horse.x - dx, z: horse.z - dz }, { x: horse.x + dx, z: horse.z + dz }] as const;
};

/** Gap between two riders' horses seen from above (tiles; negative when they overlap). */
export const horseGap = (a: SettlementActor, b: SettlementActor) => {
  const [aFrom, aTo] = horseCore(a), [bFrom, bTo] = horseCore(b);
  return Math.min(distanceToSegment(aFrom, bFrom, bTo), distanceToSegment(aTo, bFrom, bTo),
    distanceToSegment(bFrom, aFrom, aTo), distanceToSegment(bTo, aFrom, aTo)) - 2 * HORSE_RADIUS;
};
