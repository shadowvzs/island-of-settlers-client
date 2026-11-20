import {
  MILITARY_QUEUE_GROUND_MODES, MILITARY_QUEUE_MAX_STEPS, MILITARY_QUEUE_STRAGGLERS_PER
} from "./constants";
import type { MilitaryCombatant } from "./military-combat-rules";
import type { MilitaryOrder } from "./military-targeting";
import type { TargetMilitaryRefusal } from "./settlement-combat-chase";
import type { SettlementSoldier } from "./settlement-military";
import type { SettlementActor } from "./settlement-types";

/** A queued ground order: march to the point (attack-move, Alt move or Ctrl retreat). */
export interface QueuedGroundStep { kind: "ground"; mode: MilitaryOrder; x: number; z: number }
/** A queued targetMilitary: chase the unit; the point is where it stood when queued (the fallback place). */
export interface QueuedTargetStep { kind: "target"; uid: number; x: number; z: number }
/** A queued siege, garrison or return-to-storage order for a building. */
export interface QueuedBuildingStep {
  kind: "siege" | "garrison" | "store";
  building: number;
  x: number;
  z: number;
}
/** A queued board-ship order. */
export interface QueuedBoardStep { kind: "board"; ship: number; x: number; z: number }
/** One step a player can put in a soldier group's Shift queue. */
export type QueuedMilitaryStep = QueuedGroundStep | QueuedTargetStep | QueuedBuildingStep | QueuedBoardStep;
/** The step the group is carrying out: a queued one, or `active` (the order it already had when queued). */
export type CurrentMilitaryStep = QueuedMilitaryStep | { kind: "active" };

/** One saved Shift queue; its members are the soldiers whose combat state names its id. */
export interface MilitaryOrderQueueSave {
  current: CurrentMilitaryStep;
  id: number;
  pending: QueuedMilitaryStep[];
  /** Seconds the group has waited for its last stragglers on the current step (absent while 0). */
  straggle?: number;
}

export type QueueMilitaryRefusal = "invalidStep" | "queueFull" | TargetMilitaryRefusal;

/** `immediate`: the step started now (no queue to append to); `waiting`: queued steps after the current one. */
export type QueueMilitaryResult =
  | { immediate: boolean; ok: true; waiting: number }
  | { ok: false; reason: QueueMilitaryRefusal };

/** One queue for the client's waypoints: its members and the step points in order (the current one first). */
export interface MilitaryOrderQueueView {
  id: number;
  members: number[];
  steps: { kind: QueuedMilitaryStep["kind"]; mode?: MilitaryOrder; x: number; z: number }[];
}

const isFinitePoint = (step: { x?: unknown; z?: unknown }) => Number.isFinite(step.x) && Number.isFinite(step.z);

/** A recorded or saved step: a known kind with a finite point and its target id. */
export const isQueuedMilitaryStep = (value: unknown): value is QueuedMilitaryStep => {
  if (!value || typeof value !== "object") return false;
  const step = value as { kind?: unknown; mode?: unknown; uid?: unknown; building?: unknown; ship?: unknown;
    x?: unknown; z?: unknown };
  if (!isFinitePoint(step)) return false;
  if (step.kind === "ground") return typeof step.mode === "string" && MILITARY_QUEUE_GROUND_MODES.has(step.mode);
  if (step.kind === "target") return Number.isSafeInteger(step.uid) && (step.uid as number) >= 0;
  if (step.kind === "siege" || step.kind === "garrison" || step.kind === "store")
    return Number.isSafeInteger(step.building) && (step.building as number) >= 0;
  return step.kind === "board" && Number.isSafeInteger(step.ship) && (step.ship as number) >= 0;
};

/** A plain copy of a valid step (recorded arguments are never kept by reference). */
export const copyQueuedStep = (step: QueuedMilitaryStep): QueuedMilitaryStep => {
  if (step.kind === "ground") return { kind: "ground", mode: step.mode, x: step.x, z: step.z };
  if (step.kind === "target") return { kind: "target", uid: step.uid, x: step.x, z: step.z };
  if (step.kind === "board") return { kind: "board", ship: step.ship, x: step.x, z: step.z };
  return { kind: step.kind, building: step.building, x: step.x, z: step.z };
};

const isCurrentStep = (value: unknown) =>
  (value as { kind?: unknown } | undefined)?.kind === "active" || isQueuedMilitaryStep(value);

/** Saved queues (format 27): unique positive ids, valid steps, at most the step limit each. */
export const isValidOrderQueueSave = (value: unknown) => {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<number>();
  for (const queue of value as Partial<MilitaryOrderQueueSave>[]) {
    if (!queue || !Number.isSafeInteger(queue.id) || queue.id! < 1 || ids.has(queue.id!)) return false;
    if (!isCurrentStep(queue.current) || !Array.isArray(queue.pending)) return false;
    if (queue.pending.length > MILITARY_QUEUE_MAX_STEPS || !queue.pending.every(isQueuedMilitaryStep)) return false;
    if (queue.straggle !== undefined && (!Number.isFinite(queue.straggle) || queue.straggle < 0)) return false;
    ids.add(queue.id!);
  }
  return true;
};

/** A soldier still busy with its current order: marching somewhere or chasing a unit. */
export const isMarchBusy = (state: MilitaryCombatant) => state.destination !== undefined || state.chase !== undefined;

/** Whether one member has finished the group's current step. */
export const memberFinished = (
  state: MilitaryCombatant,
  step: CurrentMilitaryStep,
  soldier?: SettlementSoldier,
  actor?: SettlementActor
) => {
  if (step.kind === "siege") return state.siege !== step.building;
  if (step.kind === "garrison") return Boolean(soldier?.stationed && soldier.building === step.building);
  if (step.kind === "store") return !state.returnToStorage;
  if (step.kind === "board") return actor?.phase === "navalAboard" || actor?.navalOrder !== undefined;
  if (state.destination !== undefined) return false;
  if (step.kind === "target") return state.chase?.uid !== step.uid;
  return step.kind === "ground" || state.chase === undefined;
};

/**
 * The group may leave its stragglers behind after a wait: someone finished and at most one member in ten (at least
 * one) has not, so a single stuck soldier never holds the queue forever. A lone soldier is always waited for.
 */
export const mostFinished = (finished: number, members: number) =>
  finished > 0 && members - finished <= Math.max(1, Math.floor(members / MILITARY_QUEUE_STRAGGLERS_PER));
