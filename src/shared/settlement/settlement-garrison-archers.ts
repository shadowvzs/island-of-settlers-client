import { banditDefenderHallSize, isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import {
  assignGarrisonSlots, exposedGarrisonFigure, garrisonSlots
} from "../../render-common/buildings/military-garrison-slots";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import {
  GARRISON_ARCHER_DEAD_ZONE, GARRISON_POST_MAX_RANGE_FACTOR, MILITARY_PROFILES, WINDOW_FIRING_HALF_ANGLE
} from "../balance/military";
import { DMath } from "../math/deterministic-math";
import { ARROW_GRAVITY, ARROW_SPEED } from "./military-projectiles";
import { nationArcherRangeFactor } from "./nation-bonuses";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

type Point3 = { x: number; y: number; z: number };
/** An archer seen on a tower post or at a window: it shoots from there and can be shot. */
export interface ExposedGarrisonArcher {
  soldier: SettlementSoldier;
  building: number;
  /** The building's footprint (centre and half extents); enemies near it are out of reach. */
  footprint: { x: number; z: number; halfWidth: number; halfDepth: number };
  /** Arrow release point. */
  origin: Point3;
  /** Body for arrow contact: x/z of the exposed figure, y where its contact band starts. */
  body: Point3;
  /** Window facing (Three.js yaw); null on a tower post, which shoots all around. */
  facing: number | null;
  /** World height the archer stands on (its post's floor, or the window soldier's feet). */
  floor: number;
  /** The island's nation; national range applies only to the player faction. */
  nation: WorkerNation;
  /**
   * An open scaffold post: nothing hides the ground below, so it shoots down at soldiers striking
   * its supports (no dead zone; minimum range measured with the drop, owner request 2026-10-22).
   */
  shootsDown: boolean;
}
interface FieldEnemy { soldier: SettlementSoldier; x: number; y: number; z: number }

/** Below the head centre, where a leaning window figure's contact band starts. */
const WINDOW_BODY_DROP = .9;
/** Bow hand above the feet of a standing archer. */
const BOW_HEIGHT = .815;
/** Tiles from a building's footprint to a point (0 inside it). */
export const footprintDistance = (footprint: ExposedGarrisonArcher["footprint"], x: number, z: number) =>
  DMath.hypot(Math.max(0, Math.abs(x - footprint.x) - footprint.halfWidth),
    Math.max(0, Math.abs(z - footprint.z) - footprint.halfDepth));
/** A building's footprint as centre and half extents. */
export const buildingFootprint = (building: SettlementBuilding): ExposedGarrisonArcher["footprint"] =>
  ({ halfDepth: building.depth / 2, halfWidth: building.width / 2, x: building.x, z: building.z });
/** Use the visible freestanding hall instead of its larger reserved plot for weapon contact. */
export const structureAttackFootprint = (building: SettlementBuilding) => {
  if (building.enemyCampEnclosure !== "building" || building.bandit === undefined ||
    isOpenArcherTower(building)) return buildingFootprint(building);
  const hall = banditDefenderHallSize(building.bandit);
  const angle = building.rotation * Math.PI / 2, offset = hall.front - hall.depth / 2;
  const turned = building.rotation % 2 !== 0;
  return { x: building.x + DMath.sin(angle) * offset, z: building.z + DMath.cos(angle) * offset,
    halfWidth: (turned ? hall.depth + .1 : hall.width) / 2,
    halfDepth: (turned ? hall.width : hall.depth + .1) / 2 };
};
/** Under the walls: inside the dead zone where the building's own archers cannot shoot. */
export const isUnderWalls = (footprint: ExposedGarrisonArcher["footprint"], x: number, z: number, margin = 0) =>
  footprintDistance(footprint, x, z) < GARRISON_ARCHER_DEAD_ZONE - margin;
/**
 * Vertical speed of the longest level shot: an arrow flying `ARROW_SPEED` across that lands at the
 * archer's base range on level ground (from R(0) = 2·vx·vy / g).
 */
const LEVEL_SHOT_RISE = ARROW_GRAVITY * MILITARY_PROFILES.archer.range / (2 * ARROW_SPEED);
/**
 * Range multiplier of a shot from `drop` tiles above the target's ground (owner request
 * 2026-10-19): the same launch carries R(h) = vx·(vy + √(vy² + 2gh)) / g, so R(h)/R(0) =
 * (1 + √(1 + 2gh/vy²)) / 2, capped at `GARRISON_POST_MAX_RANGE_FACTOR`; level or uphill: 1.
 */
export const postRangeFactor = (drop: number) => drop <= 0 ? 1 : Math.min(GARRISON_POST_MAX_RANGE_FACTOR,
  (1 + Math.sqrt(1 + 2 * ARROW_GRAVITY * drop / (LEVEL_SHOT_RISE * LEVEL_SHOT_RISE))) / 2);
/** Farthest any garrison archer can shoot (a post at the range cap). */
export const GARRISON_ARCHER_MAX_REACH = MILITARY_PROFILES.archer.range * GARRISON_POST_MAX_RANGE_FACTOR;
/**
 * Bow reach (tiles) of a garrison archer at a target standing on ground height `targetGround`: a
 * post archer gains range from its height above that ground; a window archer keeps the base range.
 * The one reach rule of garrison archers: targeting, aiming views and tests all use it.
 */
const archerNationRangeFactor = (archer: Pick<ExposedGarrisonArcher, "facing" | "floor"> &
  Partial<Pick<ExposedGarrisonArcher, "nation" | "soldier">>) =>
  archer.nation && archer.soldier?.combat?.faction === 0 ? nationArcherRangeFactor(archer.nation) : 1;

export const garrisonArcherReach = (
  archer: Pick<ExposedGarrisonArcher, "facing" | "floor"> &
    Partial<Pick<ExposedGarrisonArcher, "nation" | "soldier">>, targetGround: number
) => {
  const { range } = MILITARY_PROFILES.archer;
  const national = archerNationRangeFactor(archer);
  if (archer.facing !== null) return range * national;
  // A tower's height and national range use the better factor, never their product, and the
  // established 1.125× tower cap still bounds the result.
  return range * Math.min(GARRISON_POST_MAX_RANGE_FACTOR,
    Math.max(national, postRangeFactor(archer.floor - targetGround)));
};
const angleBetween = (a: number, b: number) => Math.abs(DMath.atan2(DMath.sin(a - b), DMath.cos(a - b)));

const exposedAt = (
  building: SettlementBuilding, garrison: readonly SettlementSoldier[], nation: WorkerNation
) => assignGarrisonSlots(garrisonSlots(building.typeId, nation, true,
  building.militaryFaction ? building.bandit : undefined,
  building.bandit !== undefined, building.enemyCampEnclosure), garrison)
  .filter(({ soldier }) => soldier.combat?.type === "archer")
  .map(({ slot, soldier }): ExposedGarrisonArcher => {
    const figure = exposedGarrisonFigure(slot, building);
    const footprint = building.eventCourtyard ?
      { x: figure.feet.x, z: figure.feet.z, halfWidth: .4, halfDepth: .4 } : buildingFootprint(building);
    if (slot.kind === "archer") return { body: figure.feet, building: building.uid, facing: null, floor: figure.feet.y,
      footprint, nation, origin: { ...figure.feet, y: figure.feet.y + BOW_HEIGHT },
      shootsDown: isOpenArcherTower(building), soldier };
    const out = { x: DMath.sin(figure.yaw) * .15, z: DMath.cos(figure.yaw) * .15 };
    return { body: { ...figure.head, y: figure.head.y - WINDOW_BODY_DROP }, building: building.uid,
      facing: figure.yaw, floor: figure.feet.y, footprint, nation,
      origin: { x: figure.head.x + out.x, y: figure.head.y - .1, z: figure.head.z + out.z },
      shootsDown: false, soldier };
  });

/** Every exposed garrison archer, in deterministic building and soldier order. */
export const exposedGarrisonArchers = (
  context: SettlementContext, soldiers: ReadonlyMap<number, SettlementSoldier>
) => {
  const garrisons = new Map<number, SettlementSoldier[]>();
  for (const soldier of soldiers.values()) {
    if (!soldier.stationed || soldier.building < 0) continue;
    const list = garrisons.get(soldier.building) ?? [];
    list.push(soldier); garrisons.set(soldier.building, list);
  }
  const nation = context.playerNation ?? "roman";
  return context.buildings.flatMap(building => {
    const garrison = garrisons.get(building.uid);
    if (!garrison || building.construction !== 1) return [];
    return exposedAt(building, garrison.sort((a, b) => a.actor - b.actor), nation);
  });
};

/** Too close to draw on: an open scaffold post counts its drop to the target's feet as distance. */
const insideMinimumRange = (archer: ExposedGarrisonArcher, distance: number, targetGround: number) => {
  const { minimumRange } = MILITARY_PROFILES.archer;
  if (!archer.shootsDown) return distance < minimumRange;
  return DMath.hypot(distance, archer.floor - targetGround) < minimumRange;
};

/**
 * The nearest enemy this archer may shoot: inside its bow reach (`garrisonArcherReach`), outside the dead zone under the
 * building's walls (open scaffold posts have none) and, at a window, inside its cone.
 */
/** `knows`: whether the archer's faction knows an enemy (A13 phase 3); unknown enemies are never aimed at. */
export const garrisonArcherTarget = <Enemy extends FieldEnemy>(
  archer: ExposedGarrisonArcher, enemies: readonly Enemy[], knows?: (faction: number, enemy: Enemy) => boolean
) => {
  const { range } = MILITARY_PROFILES.archer;
  const national = archerNationRangeFactor(archer);
  const farthest = archer.facing === null
    ? range * Math.max(national, GARRISON_POST_MAX_RANGE_FACTOR) : range * national;
  let best: Enemy | undefined, bestDistance = Infinity;
  for (const enemy of enemies) {
    if (enemy.soldier.combat?.faction === archer.soldier.combat?.faction) continue;
    const dx = enemy.x - archer.origin.x, dz = enemy.z - archer.origin.z, distance = DMath.hypot(dx, dz);
    if (distance > farthest || distance >= bestDistance || insideMinimumRange(archer, distance, enemy.y)) continue;
    if (distance > range && distance > garrisonArcherReach(archer, enemy.y)) continue;
    if (!archer.shootsDown && isUnderWalls(archer.footprint, enemy.x, enemy.z)) continue;
    if (archer.facing !== null && angleBetween(DMath.atan2(dx, dz), archer.facing) > WINDOW_FIRING_HALF_ANGLE) continue;
    if (knows && !knows(archer.soldier.combat?.faction ?? 0, enemy)) continue;
    best = enemy; bestDistance = distance;
  }
  return best;
};
