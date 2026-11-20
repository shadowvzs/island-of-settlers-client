import { emitUnitGone } from "../script-world/script-unit-events";
import { sampleSmooth } from "../world/grid-geometry";
import type { MilitaryTroopType } from "./military-combat-rules";
import type { MilitaryOrder } from "./military-targeting";
import type { CombatCore } from "./settlement-combat-core";
import type { SettlementSoldier } from "./settlement-military";
import { countOnDuty } from "./settlement-population";
import type { SettlementActor, SettlementPoint } from "./settlement-types";

/**
 * What the map script may do to soldiers (TRG5a presence and movement actions, design §5.2.1/§5.2.2): spawn,
 * kill (a death without a killer), despawn (no death), teleport, march with a stance, change owner. Every call
 * checks the unit itself and answers false instead of throwing; the script adapter turns that into an outcome.
 * Commanders keep their own system: they are never spawned, removed or handed to another owner here.
 */

const FIELD_PHASE = "militaryField";

export interface ScriptUnitControlDeps {
  core: CombatCore;
  /** The death of a fall without a killer (the casualties' `fell`). */
  fell: (soldier: SettlementSoldier) => void;
  /** Drops the field bookkeeping of a soldier (routes, memories, steering, melee claims). */
  forgetField: (uid: number) => void;
  /** Accepted ids of a march order (the player's march detaches escort members). */
  march: (ids: readonly number[], point: SettlementPoint, faction: number, mode: MilitaryOrder) => number[];
  removeSoldier: (soldier: SettlementSoldier, actor: SettlementActor) => void;
  /** A new field soldier at a clear point, or null (the development and scenario spawns). */
  spawn: (point: SettlementPoint, type: MilitaryTroopType, rank: number, faction: number) => number | null;
}

export const createScriptUnitControl = ({ core, fell, forgetField, march, removeSoldier, spawn }:
  ScriptUnitControlDeps) => {
  const { actorById, context, memoryOf, pendingMarches, soldiers } = core;
  const fieldSoldier = (uid: number) => {
    const soldier = soldiers.get(uid), actor = actorById(uid);
    if (!soldier?.combat || !actor || actor.phase !== FIELD_PHASE) return undefined;
    return { actor, soldier, state: soldier.combat };
  };
  const clearOrders = (uid: number) => {
    const found = fieldSoldier(uid)!;
    pendingMarches.delete(uid);
    Object.assign(found.state, {
      destination: undefined, pendingRoute: undefined, pendingTarget: undefined, siege: undefined, target: undefined
    });
    forgetField(uid);
    Object.assign(found.actor, { action: "idle", path: [], pathIndex: 0 });
    return found;
  };
  const placeAt = (actor: SettlementActor, point: SettlementPoint) => {
    const { world } = context.options;
    Object.assign(actor, { x: point.x, y: sampleSmooth(world, world.heights, point.x, point.z), z: point.z });
  };
  return {
    /** A soldier standing in the open field, which every scripted move, teleport and owner change needs. */
    isFieldSoldier: (uid: number) => fieldSoldier(uid) !== undefined,
    isCommander: (uid: number) => soldiers.get(uid)?.commanderId !== undefined,
    /** Still walking towards its order (a planned or queued route). */
    isMarching: (uid: number) => {
      const state = soldiers.get(uid)?.combat;
      return Boolean(state && (state.destination || state.pendingRoute || pendingMarches.has(uid)));
    },
    spawn: (point: SettlementPoint, type: MilitaryTroopType, rank: number, faction: number, yaw: number) => {
      const uid = spawn(point, type, rank, faction);
      const actor = uid === null ? undefined : actorById(uid);
      if (actor) actor.yaw = yaw;
      return uid;
    },
    /** Dies where it stands: the fall animation, `actorKilled` without a killer, then gone. */
    kill: (uid: number) => {
      const soldier = soldiers.get(uid);
      if (!soldier || soldier.commanderId !== undefined || !actorById(uid)) return false;
      fell(soldier);
      return true;
    },
    /** Leaves the world without a death (`actorGone` despawned). */
    despawn: (uid: number) => {
      const soldier = soldiers.get(uid), actor = actorById(uid);
      if (!soldier || !actor || soldier.commanderId !== undefined) return false;
      if (context.script) emitUnitGone(context, actor, "despawned");
      removeSoldier(soldier, actor);
      return true;
    },
    /** Jumps to `point` and stays there (its post moves with it); the region watch sees the new cell. */
    teleport: (uid: number, point: SettlementPoint, yaw: number) => {
      if (!fieldSoldier(uid)) return false;
      const { actor, state } = clearOrders(uid);
      placeAt(actor, point);
      actor.yaw = yaw;
      const horse = state.mount === undefined ? undefined : actorById(state.mount);
      if (horse) placeAt(horse, point);
      memoryOf(uid).anchor = { x: point.x, z: point.z };
      return true;
    },
    /** Field soldiers of `faction` march to `point`; returns the accepted ids. */
    march: (ids: readonly number[], point: SettlementPoint, faction: number, mode: MilitaryOrder) =>
      march(ids.filter(uid => fieldSoldier(uid)?.state.faction === faction), point, faction, mode),
    /** Hands a field soldier to another slot (grant, capture); its post becomes where it stands. */
    setFaction: (uid: number, faction: number) => {
      const found = fieldSoldier(uid);
      if (!found || found.soldier.commanderId !== undefined || !Number.isSafeInteger(faction) || faction < 0)
        return false;
      if (found.state.faction === faction) return true;
      if (found.state.faction === 0) countOnDuty(context, -1);
      if (faction === 0) countOnDuty(context, 1);
      clearOrders(uid);
      Object.assign(found.state, { faction, selected: false });
      memoryOf(uid).anchor = { x: found.actor.x, z: found.actor.z };
      return true;
    }
  };
};

export type ScriptUnitControl = ReturnType<typeof createScriptUnitControl>;
