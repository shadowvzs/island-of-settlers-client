import { KNOWLEDGE_MEMORY_SECONDS } from "../balance/vision";
import type { MilitaryChase, MilitaryCombatant } from "./military-combat-rules";
import { orderTargetCandidates } from "./military-order-target";
import type { CombatCore, FieldMemory, FieldTarget } from "./settlement-combat-core";
import type { CombatRouting } from "./settlement-combat-routing";
import type { SettlementActor, SettlementPoint } from "./settlement-types";

/** Phases in which a chased unit stands on reachable land (outside, leaving a door, besieging one). */
const CHASEABLE_PHASES: ReadonlySet<string> = new Set(["militaryField", "militaryLeaving", "militarySiege"]);

/** Why a targetMilitary order is refused (the client words these as `settlement.armyTarget.*`). */
export type TargetMilitaryRefusal = "noTroops" | "targetHidden" | "targetMissing" | "targetNotHostile" |
  "targetUnreachable";

export type TargetMilitaryResult = { chasing: number; ok: true } | { ok: false; reason: TargetMilitaryRefusal };
/** The same order with the soldiers that took it (the Shift queue's group). */
export type TargetMilitaryOutcome = { accepted: number[]; ok: true } | { ok: false; reason: TargetMilitaryRefusal };

/** The chased unit lost, unseen: where it vanished, after `seconds` more out of sight. */
export const lostChase = (chase: MilitaryChase, body: SettlementPoint, seconds: number): MilitaryChase => ({
  lost: { seconds: (chase.lost?.seconds ?? 0) + seconds, x: chase.lost?.x ?? body.x, z: chase.lost?.z ?? body.z },
  uid: chase.uid
});

/** The chase lock still applies: an explicit attack order with no siege or way home taken since. */
const chaseHolds = (state: MilitaryCombatant) =>
  state.order === "attackMove" && state.siege === undefined && !state.returnToStorage;

interface ChaseServices {
  arrive: CombatRouting["arrive"];
  /** The attacker of the chaser within reach (its self-defence), as the move order's strike back finds it. */
  strikeBack: (actor: SettlementActor, state: MilitaryCombatant, memory: FieldMemory) => FieldTarget | undefined;
}

/**
 * targetMilitary (owner 2026-11-17): soldiers locked on one enemy unit chase it while the player sees it. They
 * fight back at an attacker in reach first, then resume. It dying ends the chase where they stand (attack-move
 * seeking); leaving the land (a ship, a building) sends them to where it was last; out of sight they head for
 * where it vanished, and past the sight memory they attack-move there.
 */
export const createCombatChase = ({ actorById, context, knowledge, soldiers }: CombatCore,
  { arrive, strikeBack }: ChaseServices) => {
  /** The chase ends: attack-move to the nearest open ground at `point` (the order's own way of stopping). */
  const attackMoveTo = (state: MilitaryCombatant, point: SettlementPoint) => {
    state.chase = undefined;
    const ground = orderTargetCandidates(context, point, 1)[0];
    if (!ground) { state.destination = undefined; return; }
    state.destination = ground; state.routeAge = 0;
  };
  /** Out of sight: march where it vanished; once the memory has run out the chase is given up there. */
  const loseSight = (state: MilitaryCombatant, chase: MilitaryChase, body: SettlementActor, dt: number) => {
    const lost = lostChase(chase, body, dt).lost!;
    if (lost.seconds > KNOWLEDGE_MEMORY_SECONDS) { attackMoveTo(state, lost); return; }
    if (!chase.lost) { state.destination = { x: lost.x, z: lost.z }; state.routeAge = 0; }
    state.chase = { lost, uid: chase.uid };
  };
  /** The live chased foe this tick, or undefined when the chase ended or the foe is out of sight. */
  const chasedFoe = (actor: SettlementActor, state: MilitaryCombatant, chase: MilitaryChase, dt: number) => {
    const soldier = soldiers.get(chase.uid), body = actorById(chase.uid);
    if (!soldier?.combat || soldier.combat.hp <= 0 || !body) {
      state.chase = undefined; arrive(actor, state); return undefined;
    }
    if (body.navalOrder !== undefined || !body.visible || !CHASEABLE_PHASES.has(body.phase)) {
      attackMoveTo(state, chase.lost ?? body); return undefined;
    }
    if (!knowledge.troopKnows(state.faction, body)) { loseSight(state, chase, body, dt); return undefined; }
    if (chase.lost) state.chase = { uid: chase.uid };
    return { body, soldier };
  };
  /**
   * The target of a chasing soldier this tick (an attacker in reach first), or undefined: the soldier then
   * behaves as an ordinary attack-move (no chase, or the foe out of sight on the way to where it vanished).
   */
  const target = (actor: SettlementActor, state: MilitaryCombatant, memory: FieldMemory, dt: number) => {
    const chase = state.chase;
    if (!chase) return undefined;
    if (!chaseHolds(state)) { state.chase = undefined; return undefined; }
    const foe = chasedFoe(actor, state, chase, dt);
    if (!foe) return undefined;
    // Contact: each chaser runs at its own pace (riders charge ahead).
    state.marchSpeed = undefined; state.rallyRunning = undefined;
    const attacker = memory.lastAttacker === chase.uid ? undefined : strikeBack(actor, state, memory);
    return attacker ?? foe;
  };
  /** Why `uid` cannot be chased by the player now (null: it can), by the player's sight (A13). */
  const refusal = (uid: number): TargetMilitaryRefusal | null => {
    const soldier = soldiers.get(uid), body = actorById(uid);
    if (!soldier?.combat || soldier.combat.hp <= 0 || !body) return "targetMissing";
    if (soldier.combat.faction === 0) return "targetNotHostile";
    if (body.navalOrder !== undefined || !body.visible || !CHASEABLE_PHASES.has(body.phase))
      return "targetUnreachable";
    return knowledge.troopKnows(0, body) ? null : "targetHidden";
  };
  /** Locks the soldiers that accepted the attack order onto `uid`. */
  const lock = (ids: readonly number[], uid: number) => {
    for (const id of ids) {
      const state = soldiers.get(id)?.combat;
      if (state) state.chase = { uid };
    }
  };
  return { lock, refusal, target };
};

export type CombatChase = ReturnType<typeof createCombatChase>;
