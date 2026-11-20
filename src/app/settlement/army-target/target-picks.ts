import type { SettlementSimulation } from "../../../shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementPoint } from "../../../shared/settlement/settlement-types";
import { nearestSoldierAt, type ScreenPoint } from "../army-selection";
import type { MilitarySelection } from "../military-selection";
import { boardingRefusal } from "../ship-orders/helpers";
import { BODY_HIT_RADIUS, bodyHitAt } from "./body-hit";
import { ARMY_TARGET_CATALOGUE } from "./constants";
import { type ArmyTargetBuilding, type ArmyTargetPicks, type ArmyTargetShip, classifyArmyTargetBuilding } from "./helpers";

export interface ArmyTargetPickOptions {
  /** Live sight: enemies and enemy buildings under fog are not targets (the click falls to the ground). */
  isVisible: (point: SettlementPoint) => boolean;
  pick: (x: number, y: number) => SettlementPoint | null;
  pickShip?: (x: number, y: number) => string | null;
  project: (x: number, y: number, z: number) => ScreenPoint;
  /** The clicked building as the left-click chain finds it (plot under the ground point, else the roof centre). */
  pickTargetBuilding: (x: number, y: number) => SettlementBuilding | undefined;
  /** The selected soldiers (the boarding check) and the player's own soldiers on the map (a neutral hover). */
  selection: Pick<MilitarySelection, "ids" | "selectableBodies">;
  simulation: SettlementSimulation;
}

/** Enemy soldiers the player sees on the map now (fogged and garrisoned ones are hidden). */
const visibleEnemies = (options: ArmyTargetPickOptions) => {
  const enemies = new Set(options.simulation.militarySoldiers().filter(soldier =>
    (soldier.combat?.faction ?? 0) > 0 && (soldier.combat?.hp ?? 1) > 0).map(soldier => soldier.actor));
  return options.simulation.frames().filter(actor =>
    enemies.has(actor.uid) && actor.visible && options.isVisible(actor));
};

const pickTargetBuilding = (options: ArmyTargetPickOptions, x: number, y: number): ArmyTargetBuilding | undefined => {
  const building = options.pickTargetBuilding(x, y);
  if (!building) return undefined;
  const kind = classifyArmyTargetBuilding(building, ARMY_TARGET_CATALOGUE);
  if (kind === "hostile" && !options.isVisible(building)) return undefined;
  return { access: building.access, kind, uid: building.uid };
};

/** The ship under the point with the selection's boarding verdict (`troopShipBoardingCheck`, read-only). */
const pickOwnShip = (options: ArmyTargetPickOptions, x: number, y: number): ArmyTargetShip | undefined => {
  const id = options.pickShip?.(x, y);
  if (id == null) return undefined;
  const ship = options.simulation.ships().find(entry => String(entry.id) === id);
  const point = ship && { x: ship.x, z: ship.z };
  const refusal = boardingRefusal(options.simulation.troopShipBoardingCheck(options.selection.ids(), Number(id)));
  return refusal === undefined ? { id, ...(point ? { point } : {}) } : { id, ...(point ? { point } : {}), refusal };
};

/** The visible enemy whose body the point lies on (a touch gets a finger's tolerance). */
const enemyBodyAt = (enemies: ReturnType<typeof visibleEnemies>, options: ArmyTargetPickOptions,
  point: { x: number; y: number }, touch: boolean) => {
  const body = bodyHitAt(enemies, options.project, point, touch ? BODY_HIT_RADIUS.touch : BODY_HIT_RADIUS.mouse);
  return body && { uid: body.uid, x: body.x, z: body.z };
};

/**
 * Everything under one right tap / long-press, picked once (no hover work): the nearest visible enemy
 * soldier within the selection pick radius and the one whose body is hit, the building, the own ship, an own
 * soldier and the ground.
 */
export const collectArmyTargetPicks = (options: ArmyTargetPickOptions, x: number, y: number, touch = false)
  : ArmyTargetPicks => {
  const point = { x, y };
  const enemies = visibleEnemies(options);
  const enemy = nearestSoldierAt(enemies, options.project, point);
  const enemyBody = enemyBodyAt(enemies, options, point, touch);
  const ownShip = pickOwnShip(options, x, y);
  const ownSoldier = !enemy && nearestSoldierAt(options.selection.selectableBodies(), options.project, point);
  return {
    building: pickTargetBuilding(options, x, y),
    enemy: enemy && { uid: enemy.uid, x: enemy.x, z: enemy.z },
    ...(enemyBody ? { enemyBody } : {}),
    ground: options.pick(x, y),
    ...(ownShip ? { ownShip } : {}),
    ...(ownSoldier ? { ownSoldier: true } : {})
  };
};
