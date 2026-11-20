import { startCivilianFlight } from "./military-civilian-safety";
import type { createSettlementAdventure } from "./settlement-adventure";
import { getBuilding } from "./settlement-building-index";
import type { createSettlementColony } from "./settlement-colony";
import { updateDemolitionReturn } from "./settlement-demolition";
import { updateHandcartCarrier } from "./settlement-handcarts";
import { updateCarrier } from "./settlement-logistics";
import type { createSettlementMilitary } from "./settlement-military";
import type { createSettlementNaval } from "./settlement-naval";
import { cancelUnreachableTask } from "./settlement-navigation-cancellation";
import {
  beginActorMovement, holdNavigationFailure, updateNavigationRecovery
} from "./settlement-navigation-recovery";
import { setActorPath } from "./settlement-paths";
import { updatePersonTraffic } from "./settlement-person-index";
import { updateStationaryRoadYield } from "./settlement-road-shoulders";
import { updateRuinClearer } from "./settlement-ruin-clearing";
import { updateSurveyWorker } from "./settlement-surveying";
import type { createSettlementTavern } from "./settlement-tavern";
import type { EventCoreActorLane, SettlementActor, SettlementContext } from "./settlement-types";
import { tickSystemMasked } from "./settlement-types";
import { updateWallRepairer } from "./settlement-wall-repair";
import { updateWorker } from "./settlement-workers";
import { updateSettlerRelocation } from "./settler-relocation";
import { updateUpgradeBuilder } from "./workshop-upgrade-workers";
import { workerCycleRate } from "./workshop-upgrades";

/** The systems one actor's fixed-tick update may call, shared by the tick and the movement skip. */
export interface SettlementActorTickSystems {
  adventure: ReturnType<typeof createSettlementAdventure>;
  colony: ReturnType<typeof createSettlementColony>;
  military: ReturnType<typeof createSettlementMilitary>;
  naval: ReturnType<typeof createSettlementNaval>;
  tavern: ReturnType<typeof createSettlementTavern>;
}

/**
 * One actor's exact fixed-tick update. Extracted unchanged from `createSettlementTick` so the
 * movement-skip prototype can replay the same actor pipeline without calling the whole tick.
 */
export const updateSettlementActorTick = (
  context: SettlementContext, systems: SettlementActorTickSystems, actor: SettlementActor, dt: number
) => {
  const { adventure, colony, military, naval, tavern } = systems;
  if (actor.phase === "militaryDead") return;
  const workerRate = workerCycleRate(context, actor);
  const eventOwned = workerRate === 1;
  const owns = (lane: EventCoreActorLane) =>
    context.options.eventCoreOwns?.(actor, lane) === true;
  if (tickSystemMasked(context.options.tickMask?.fishing) && eventOwned && owns("fishing") &&
    ["fishCast", "fishWait", "fishReel"].includes(actor.phase)) return;
  if (tickSystemMasked(context.options.tickMask?.productionWork) && eventOwned && owns("work") &&
    actor.phase === "work") return;
  if (tickSystemMasked(context.options.tickMask?.foresterPlant) && eventOwned && owns("foresterPlant") &&
    actor.phase === "foresterPlant") return;
  if (tickSystemMasked(context.options.tickMask?.huntFlight) && eventOwned && owns("huntFlight") &&
    actor.phase === "huntFlight") return;
  if (tickSystemMasked(context.options.tickMask?.huntAim) && eventOwned && owns("huntAim") &&
    actor.phase === "huntAim") return;
  if (tickSystemMasked(context.options.tickMask?.huntWait) && eventOwned && owns("huntWait") &&
    actor.phase === "huntWait") return;
  if (!context.horses!.handles(actor)) beginActorMovement(actor);
  if (holdNavigationFailure(context, actor)) return;
  // A civilian outside with raiders close drops its work and runs for a safe storage (MIL-ASSAULT).
  startCivilianFlight(context, actor);
  if (updateDemolitionReturn(context, actor, dt) || context.horses!.handles(actor)) {
    updatePersonTraffic(context, actor);
    return;
  }
  // An unfinished founding owns its landed crew until the ship is released: those phases are
  // advanced by settlement-naval-founding (carrying boxes, walking into the finished harbour).
  if (actor.phase.startsWith("founding")) {
    updatePersonTraffic(context, actor);
    return;
  }
  const previousPhase = actor.phase, previousAction = actor.action;
  // An upgraded production building's worker runs its in-place work (clips included) faster.
  const workDt = dt * workerRate;
  if (!context.options.tickMask?.animationTime || actor.job === "Builder")
    actor.animationTime += workDt;
  if (updateStationaryRoadYield(context, actor, dt)) {
    updatePersonTraffic(context, actor);
    if (actor.action !== previousAction) actor.animationTime = 0;
    return;
  }
  if (updateRuinClearer(context, actor, dt) || updateWallRepairer(context, actor, dt)) {
    updatePersonTraffic(context, actor);
    if (actor.phase !== previousPhase || actor.action !== previousAction) actor.animationTime = 0;
    return;
  }
  const workplace = actor.job === "Carrier" ? getBuilding(context, actor.building) : undefined;
  if (actor.handcart) updateHandcartCarrier(context, actor, dt);
  else if (actor.job === "Carrier" && actor.navalOrder === undefined &&
    !(workplace?.typeId === 16 && workplace.worker === actor.uid)) updateCarrier(context, actor, dt);
  else if (!naval.updatePassenger(actor, dt) && !adventure.updateActor(actor, dt) &&
    !colony.updateActor(actor, dt) &&
    !military.updateActor(actor, dt) && !tavern.updateActor(actor, dt) &&
    !updateSurveyWorker(context, actor, dt) && !updateSettlerRelocation(context, actor, dt) &&
    !naval.updateShipwright(actor, workDt) &&
    !updateUpgradeBuilder(context, actor, dt)) updateWorker(context, actor, workDt);
  updateNavigationRecovery(context, actor, dt,
    path => setActorPath(actor, path, actor.phase), () => cancelUnreachableTask(context, actor));
  updatePersonTraffic(context, actor);
  if (actor.phase !== previousPhase || actor.action !== previousAction) actor.animationTime = 0;
};
