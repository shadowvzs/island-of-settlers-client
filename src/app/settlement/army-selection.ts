import { SELECTABLE_MILITARY_PHASES } from "../../shared/settlement/military-orders";
import type { SettlementActor } from "../../shared/settlement/settlement-types";
import { isInsideBox, type ScreenBox, toScreenBox } from "../worker-selection";

export interface ScreenPoint { x: number; y: number }
type Project = (x: number, y: number, z: number) => ScreenPoint;
type SelectableBody = Pick<SettlementActor, "mounted" | "navalOrder" | "phase" | "uid" | "visible" | "x" | "y" | "z">;

/** CSS pixels: a click this close to a soldier's body picks it. */
const SOLDIER_PICK_RADIUS = 22;
/** World units above a soldier's feet where clicks, boxes and the on-screen test look for the chest. */
export const SOLDIER_CHEST_HEIGHT = .55;

/** A soldier the player sees outside and may select: in the field, leaving, besieging or returning. */
export const isSelectableSoldierBody = (actor: SelectableBody) =>
  actor.visible && actor.navalOrder === undefined && SELECTABLE_MILITARY_PHASES.includes(actor.phase);

/** Body points picked on screen: the chest, and a rider's chest up on the horse as well. */
const screenPoints = (actor: SelectableBody, project: Project) =>
  (actor.mounted ? [SOLDIER_CHEST_HEIGHT, 1.25] : [SOLDIER_CHEST_HEIGHT])
    .map(height => project(actor.x, actor.y + height, actor.z));

export const nearestSoldierAt = <Body extends SelectableBody>(
  actors: readonly Body[], project: Project, point: ScreenPoint
) => {
  let nearest: { actor: Body; distance: number } | undefined;
  for (const actor of actors) {
    const distance = Math.min(...screenPoints(actor, project).map(screen =>
      Math.hypot(screen.x - point.x, screen.y - point.y)));
    if (!nearest || distance < nearest.distance) nearest = { actor, distance };
  }
  return nearest && nearest.distance <= SOLDIER_PICK_RADIUS ? nearest.actor : undefined;
};

export const boxFromCorners = (from: ScreenPoint, to: ScreenPoint): ScreenBox => toScreenBox(from.x, from.y, to.x, to.y);

/** Soldiers with any picked body point inside the dragged box. */
export const soldiersInBox = (actors: readonly SelectableBody[], project: Project, box: ScreenBox) =>
  actors.filter(actor => screenPoints(actor, project).some(point => isInsideBox(box, point.x, point.y))).map(actor => actor.uid);

/** A second soldier tap this soon (ms) and this close (CSS pixels) is a double tap (§7). */
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_PIXELS = 12;

/** One tap that hit a soldier: when and where. */
export interface SoldierTap extends ScreenPoint {
  time: number;
}

/** The browser `dblclick` is unusable (the rail stops it, touch needs it too): taps are compared instead. */
export const isDoubleTap = (previous: SoldierTap | null, next: SoldierTap) =>
  previous !== null && next.time - previous.time <= DOUBLE_TAP_MS &&
  Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_PIXELS;

/** A screen point inside the visible viewport. */
export const isOnScreen = (point: ScreenPoint, viewport: { height: number; width: number }) =>
  point.x >= 0 && point.y >= 0 && point.x <= viewport.width && point.y <= viewport.height;
