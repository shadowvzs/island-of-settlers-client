import type { SettlementContext } from "../settlement/settlement-types";

/**
 * The lock rule outside cinematics (trigger design §6.6, owner 5): one shared check in the order handlers. A unit
 * busy with a story action that is not overridable refuses player orders ("busy with a story task"); an
 * overridable one accepts the order and its story action ends `interrupted`. The CPU AI never re-tasks a unit while
 * a story action controls it. Islands without a script pay one optional read.
 *
 * Cinematics (CIN4): while a sequence plays, CIN3's input lock already blocks every player order; the members of
 * the playing sequence are additionally locked here (player and AI orders left out) and invulnerable until it ends.
 */

/** Player orders: the ids that may take the order (overridable story actions are interrupted). */
export const admitPlayerOrder = (context: SettlementContext, ids: readonly number[]): readonly number[] => {
  const script = context.script;
  if (!script) return ids;
  return script.actions.admitPlayerOrder(ids.filter(uid => !script.isCinematicMember(uid)));
};

/** Ids among `ids` that refuse player orders now (the UI notice "busy with a story task"). */
export const storyLockedUnits = (context: SettlementContext, ids: readonly number[]): number[] =>
  context.script ? ids.filter(uid => context.script!.isCinematicMember(uid) ||
    context.script!.actions.lockOf(uid) === "locked") : [];

/** A story action controls the unit: the CPU AI must not re-task it. */
export const isStoryControlled = (context: SettlementContext, uid: number) =>
  context.script !== undefined &&
  (context.script.isCinematicMember(uid) || context.script.actions.lockOf(uid) !== "free");

/** CPU AI orders: the ids no story action controls. */
export const admitAiOrder = (context: SettlementContext, ids: readonly number[]): readonly number[] =>
  context.script ? ids.filter(uid => !isStoryControlled(context, uid)) : ids;
