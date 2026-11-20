import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import type {
  MilitaryOrderQueueView, QueuedMilitaryStep
} from "../../../shared/settlement/military-order-queue-rules";
import type { MilitaryOrder } from "../../../shared/settlement/military-targeting";
import { isOwnBuilding } from "../../../shared/settlement/settlement-home";
import type { SettlementPoint } from "../../../shared/settlement/settlement-types";
import type { ArmyCursorMode } from "../army-order-cursor";
import type { ArmyOrder } from "../army-rail/helpers";
import { ARMY_TARGET_CURSORS, ARMY_TARGET_MARKER_TONES } from "./constants";

/** What a picked building means to a soldier order. */
export type ArmyTargetBuildingKind = "hostile" | "military" | "other" | "storage";

export interface ArmyTargetBuilding {
  access: SettlementPoint;
  kind: ArmyTargetBuildingKind;
  uid: number;
}

/** An own ship under the point (renderer ship id) and, when the selection cannot board it, the sim's reason. */
export interface ArmyTargetShip {
  id: string;
  point?: SettlementPoint;
  refusal?: string;
}

/** Everything under the clicked point; fogged enemies and fogged enemy buildings are left out. */
export interface ArmyTargetPicks {
  building?: ArmyTargetBuilding;
  enemy?: SettlementPoint & { uid: number };
  /** The visible enemy whose body the point actually lies on (not merely near it): it is chased. */
  enemyBody?: SettlementPoint & { uid: number };
  ground: SettlementPoint | null;
  /** One of the player's own soldiers is under the point (a neutral hover; the click still attack-moves). */
  ownSoldier?: boolean;
  ownShip?: ArmyTargetShip;
}

export interface ArmyTargetModifiers {
  altKey?: boolean;
  ctrlKey?: boolean;
  /** Shift: the order joins the selected group's order queue instead of replacing it. */
  shiftKey?: boolean;
  /** A long-press: the body hit takes a finger's tolerance. */
  touch?: boolean;
}

/** The smart order of a right tap / long-press: one entry per target kind of military controls §6. */
export type ArmyTarget =
  | { kind: "attackUnit" | "targetUnit"; point: SettlementPoint; targetUid: number }
  | { building: ArmyTargetBuilding; kind: "gather" | "garrison" | "siege" | "store" }
  | { kind: "board"; point?: SettlementPoint; shipId: string }
  | { kind: "boardRefused"; reason: string; point?: SettlementPoint; shipId: string }
  | { kind: "ground"; mode: MilitaryOrder; point: SettlementPoint }
  | { kind: "noGround" }
  | { kind: "ownSoldier"; point: SettlementPoint };

const groundTarget = (ground: SettlementPoint | null, mode: MilitaryOrder): ArmyTarget =>
  ground ? { kind: "ground", mode, point: ground } : { kind: "noGround" };

/** Own buildings: a military building garrisons, a storage takes the soldiers in, others gather at the door. */
const ownBuildingOrder = (kind: ArmyTargetBuildingKind) => {
  if (kind === "military") return "garrison";
  return kind === "storage" ? "store" : "gather";
};

/** Board an own ship, or the boarding check's reason why this selection cannot (hover and click agree). */
const shipTarget = ({ id, point, refusal }: ArmyTargetShip): ArmyTarget =>
  refusal === undefined
    ? { kind: "board", point, shipId: id }
    : { kind: "boardRefused", point, reason: refusal, shipId: id };

/** Open ground attack-moves; over one of the player's own soldiers the hover stays neutral. */
const defaultTarget = (picks: ArmyTargetPicks): ArmyTarget => {
  if (picks.ownSoldier && picks.ground) return { kind: "ownSoldier", point: picks.ground };
  return groundTarget(picks.ground, "attackMove");
};

/**
 * The smart order for a right tap with soldiers selected. Ctrl retreats and Alt moves to the ground
 * point whatever lies there; otherwise the first hit wins: an enemy body (chased: targetMilitary), an enemy
 * unit near the point (attack-move to it), enemy building, own ship, own
 * military building, own storage, other own building, then ground (attack-move, also over an own soldier).
 */
export const resolveArmyTarget = (picks: ArmyTargetPicks, modifiers: ArmyTargetModifiers = {}): ArmyTarget => {
  if (modifiers.ctrlKey) return groundTarget(picks.ground, "retreat");
  if (modifiers.altKey) return groundTarget(picks.ground, "move");
  const { enemy, enemyBody } = picks;
  if (enemyBody) return { kind: "targetUnit", point: { x: enemyBody.x, z: enemyBody.z }, targetUid: enemyBody.uid };
  if (enemy) return { kind: "attackUnit", point: { x: enemy.x, z: enemy.z }, targetUid: enemy.uid };
  const { building } = picks;
  if (building?.kind === "hostile") return { building, kind: "siege" };
  if (picks.ownShip) return shipTarget(picks.ownShip);
  if (building) return { building, kind: ownBuildingOrder(building.kind) };
  return defaultTarget(picks);
};

/**
 * The Shift queue step of a resolved target (phase 1): ground orders keep their mode, an enemy body is chased, a
 * point near an enemy or over an own soldier attack-moves. Buildings, ships and no ground cannot be queued yet.
 */
export const queuedArmyStep = (target: ArmyTarget): QueuedMilitaryStep | null => {
  switch (target.kind) {
    case "ground": return { kind: "ground", mode: target.mode, x: target.point.x, z: target.point.z };
    case "attackUnit":
    case "ownSoldier": return { kind: "ground", mode: "attackMove", x: target.point.x, z: target.point.z };
    case "targetUnit": return { kind: "target", uid: target.targetUid, x: target.point.x, z: target.point.z };
    case "siege":
    case "garrison":
    case "store":
      return { kind: target.kind, building: target.building.uid,
        x: target.building.access.x, z: target.building.access.z };
    case "board":
      return { kind: "board", ship: Number(target.shipId),
        x: target.point?.x ?? 0, z: target.point?.z ?? 0 };
    default: return null;
  }
};

/** Which handler takes a right tap: an armed rail / hotkey order wins for that one tap. */
export const routeRightTap = (armed: ArmyOrder, selectedCount: number) => {
  if (armed) return "armed";
  return selectedCount > 0 ? "smart" : "none";
};

/** A building's role for soldier orders, from its ownership, completion and catalogue tables. */
export const classifyArmyTargetBuilding = (
  building: { construction: number; militaryFaction?: number; typeId: number },
  tables: { garrisonCapacity: (typeId: number) => number; isStorage: (typeId: number) => boolean }
): ArmyTargetBuildingKind => {
  if (!isOwnBuilding(building)) return "hostile";
  if (building.construction < 1) return "other";
  if (tables.garrisonCapacity(building.typeId) > 0) return "military";
  return tables.isStorage(building.typeId) ? "storage" : "other";
};

/** Splits a selection for "garrison": riders cannot garrison and wait outside instead. */
export const splitRiders = (ids: readonly number[], typeOf: (id: number) => MilitaryTroopType | undefined) => {
  const infantry: number[] = [], riders: number[] = [];
  for (const id of ids) (typeOf(id) === "cavalry" ? riders : infantry).push(id);
  return { infantry, riders };
};

/** Selected archers a siege did not take (it refuses archers until the door falls). */
export const refusedSiegeArchers = (
  ids: readonly number[], soldierOf: (id: number) => { siege?: number; type?: MilitaryTroopType } | undefined,
  uid: number
) => ids.filter(id => {
  const soldier = soldierOf(id);
  return soldier?.type === "archer" && soldier.siege !== uid;
});

const groundTone = (mode: MilitaryOrder) => {
  if (mode === "retreat") return ARMY_TARGET_MARKER_TONES.retreat;
  return mode === "move" ? ARMY_TARGET_MARKER_TONES.move : ARMY_TARGET_MARKER_TONES.attack;
};

/** The marker tone of an accepted target: fighting orders, plain moves, retreats, or stationing. */
export const armyTargetTone = (target: ArmyTarget) => {
  if (target.kind === "ground") return groundTone(target.mode);
  if (target.kind === "garrison" || target.kind === "store") return ARMY_TARGET_MARKER_TONES.station;
  return ARMY_TARGET_MARKER_TONES.attack;
};

/** The marker tone of an armed rail / hotkey order after its click. */
export const armedOrderTone = (order: Exclude<ArmyOrder, null>, accepted: boolean) => {
  if (!accepted) return ARMY_TARGET_MARKER_TONES.refused;
  if (order === "move" || order === "retreat") return ARMY_TARGET_MARKER_TONES[order];
  return order === "attack" ? ARMY_TARGET_MARKER_TONES.attack : ARMY_TARGET_MARKER_TONES.station;
};

const groundCursor = (mode: MilitaryOrder): ArmyCursorMode => {
  if (mode === "retreat") return "retreat";
  return mode === "move" ? "move" : "attack";
};

/**
 * The army cursor of a resolved smart target (the cursor-art modes; the P3 hover applies it). Null keeps the
 * game's neutral cursor (over an own soldier).
 */
export const armyTargetCursor = (target: ArmyTarget): ArmyCursorMode | null => {
  if (target.kind === "ground") return groundCursor(target.mode);
  const mode = ARMY_TARGET_CURSORS[target.kind];
  return mode === undefined ? "attack" : mode;
};

/** One selected group's queue to draw: its members and each step's point and marker tone, in order. */
export interface ArmyQueueRoute {
  members: readonly number[];
  steps: readonly { tone: string; x: number; z: number }[];
}

const queuedStepTone = (step: MilitaryOrderQueueView["steps"][number]) => {
  if (step.kind === "garrison" || step.kind === "store") return ARMY_TARGET_MARKER_TONES.station;
  if (step.kind === "target" || step.kind === "siege" || step.kind === "board")
    return ARMY_TARGET_MARKER_TONES.attack;
  return groundTone(step.mode ?? "attackMove");
};

/** The Shift queues of the selection: every queue with a selected member (other groups' queues stay hidden). */
export const selectedQueueRoutes = (
  views: readonly MilitaryOrderQueueView[], selected: ReadonlySet<number>
): ArmyQueueRoute[] => views.filter(view => view.members.some(uid => selected.has(uid)))
  .map(view => ({ members: view.members,
    steps: view.steps.map(step => ({ tone: queuedStepTone(step), x: step.x, z: step.z })) }));

/** Where a group's route line starts: the mean position of its members (none: no member body found). */
export const groupCentre = (bodies: readonly SettlementPoint[]): SettlementPoint | undefined => {
  if (!bodies.length) return undefined;
  let x = 0, z = 0;
  for (const body of bodies) { x += body.x; z += body.z; }
  return { x: x / bodies.length, z: z / bodies.length };
};
