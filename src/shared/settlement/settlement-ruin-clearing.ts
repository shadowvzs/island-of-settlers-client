import {
  OUTING_OUTBOUND_PHASE, returnFromOuting, returnsFromOuting, startOuting, walkHomeFromOuting, walkOutbound
} from "./settlement-outing";
import { backOffRuin, removeRuin, ruinClearingSeconds, type SettlementRuin } from "./settlement-ruins";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * BD2 clearing job, the clearer's side (`actor.ruinClearing` names the ruin): an outing (`settlement-outing.ts`)
 * from its storage to the ruin's road access, where it clears the ruin (`ruinClearingSeconds`) and carries the
 * salvage back in `demolitionCargo`, so a clearer put to flight on the way (MIL-ASSAULT refuge rules) still
 * delivers it wherever the demolition return takes it.
 */
const RUIN_CLEARING_PHASE = "ruinClearing";

/** Whether the person works on ruin `uid` now (walking there or clearing it), so the ruin stays assigned. */
export const clearsRuin = (actor: SettlementActor, uid: number) => actor.ruinClearing === uid &&
  !actor.demolitionReturning && (actor.phase === OUTING_OUTBOUND_PHASE || actor.phase === RUIN_CLEARING_PHASE);

/** Sends a settler of `storage` out to the ruin along `path` (from the storage's access). */
export const startRuinClearer = (actor: SettlementActor, storage: SettlementBuilding, ruin: SettlementRuin,
  path: readonly SettlementPoint[]) => {
  actor.ruinClearing = ruin.uid;
  startOuting(actor, storage, path);
};

/** The clearer gives the ruin up (stalled on its way): the ruin backs off and the clearer goes home idle. */
const giveUp = (context: SettlementContext, actor: SettlementActor, ruin: SettlementRuin) => {
  ruin.clearer = undefined;
  backOffRuin(context, ruin, context.clock?.tick() ?? 0);
  walkHomeFromOuting(context, actor);
};

const clear = (context: SettlementContext, actor: SettlementActor, ruin: SettlementRuin, dt: number) => {
  ruin.work = (ruin.work ?? 0) + dt;
  if (ruin.work < ruinClearingSeconds(ruin)) return;
  actor.demolitionCargo = { ...ruin.salvage };
  removeRuin(context, ruin);
  walkHomeFromOuting(context, actor);
};

/** Advances a ruin clearer; true when this updater owns the person this tick. */
export const updateRuinClearer = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  const uid = actor.ruinClearing;
  if (uid === undefined) return false;
  const ruin = context.ruins?.find(entry => entry.uid === uid && entry.clearer === actor.uid);
  if (returnsFromOuting(actor)) returnFromOuting(context, actor, dt);
  else if (!ruin) walkHomeFromOuting(context, actor);
  else if (actor.phase !== OUTING_OUTBOUND_PHASE) clear(context, actor, ruin, dt);
  else if (walkOutbound(context, actor, dt, RUIN_CLEARING_PHASE, ruin)) giveUp(context, actor, ruin);
  return true;
};
