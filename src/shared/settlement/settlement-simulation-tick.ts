import { updateCampaignMapOutcome } from "../campaign/campaign-map-outcome";
import type { createSettlementTrade } from "../trade/settlement-trade";
import { updateAuthoredPatrols } from "./authored-scenario-patrol";
import { updateAuthoredScenario } from "./authored-scenario-progress";
import { updateStoneRespawns } from "./boulder-respawn";
import { updateBridgeConstruction } from "./bridge-construction-runtime";
import { updateBridgeRemovals } from "./bridge-dismantling";
import { updateRoadVergePlanting } from "./road-verge-planting";
import { RESPAWNING_DEPOSITS } from "./colony-marble-deposits";
import { returnObsoleteInputs } from "./drink-chain-saves";
import {
  type SettlementActorTickSystems,
  updateSettlementActorTick
} from "./settlement-actor-tick";
import { FACTION_AI_TICK_PHASE } from "./economy-ai/constants";
import { updateDoorActivity } from "./settlement-door-activity";
import { beginStorageTrafficTick } from "./settlement-door-traffic";
import { collectAbandonedHandcarts } from "./settlement-handcart-collect";
import { reclaimIdleCarriers } from "./settlement-idle-carriers";
import { initializeLandTransportReuse, scheduleDeliveries } from "./settlement-logistics";
import { beginPersonTrafficTick } from "./settlement-person-index";
import { updateFactionPopulationGrowth } from "./faction-population";
import { compactRetiredSettlers, updatePopulationGrowth } from "./settlement-population";
import { beginNavigationRepairTick } from "./settlement-repair-budget";
import { updateReservationWatchdogs } from "./settlement-reservation-watchdog";
import { refreshSettlementRoadTerrain } from "./settlement-road-terrain";
import { dispatchRuinClearing } from "./settlement-ruin-dispatch";
import { collectFinishedHandcarts } from "./settlement-sawmill-handcarts";
import { separateIdlePeople } from "./settlement-idle-separation";
import type { SettlementActor, SettlementContext } from "./settlement-types";
import { tickSystemMasked } from "./settlement-types";
import { updateSettlementVision } from "./settlement-vision";
import { recruitWorkers } from "./settlement-workers";
import { reconcileStorageAccess } from "./shared-storage";
import { updateStrandedRelocation } from "./stranded-relocation";
import { endTickPhases, markTickPhase } from "./tick-phase-profile";
import { recruitUpgradeBuilders } from "./workshop-upgrade-workers";
import { updateWorkshopUpgrades } from "./workshop-upgrades";

/** The island systems one fixed simulation tick advances. */
export interface SettlementTickSystems extends SettlementActorTickSystems {
  trade: ReturnType<typeof createSettlementTrade>;
}

/** One fixed simulation step: island systems, half-second scheduling, then every actor. */
export const createSettlementTick = (context: SettlementContext, systems: SettlementTickSystems) => {
  initializeLandTransportReuse(context);
  const { adventure, colony, military, naval, tavern, trade } = systems;
  /** The actors as they stood when the actor pass began; reused instead of copying with `slice()`. */
  const startingActors: SettlementActor[] = [];
  return (dt: number) => {
    const gameTick = context.clock?.tick() ?? 0;
    context.randomAudit?.setTick(gameTick);
    context.options.onTickStart?.(dt, gameTick);
    markTickPhase("prelude");
    refreshSettlementRoadTerrain(context);
    context.roadDecorations?.processPending();
    reconcileStorageAccess(context);
    beginStorageTrafficTick(context, dt);
    updateReservationWatchdogs(context, dt);
    beginNavigationRepairTick(context, dt);
    markTickPhase("naval");
    naval.update(dt);
    markTickPhase("military");
    military.update(dt);
    markTickPhase("scenario");
    updateAuthoredScenario(context, dt, military.soldiers);
    updateCampaignMapOutcome(context, military);
    updateAuthoredPatrols(context, dt, military.combat);
    markTickPhase("fields");
    if (!tickSystemMasked(context.options.tickMask?.fieldGrowth)) context.fieldCycles!.update(dt);
    markTickPhase("upgradesHorses");
    returnObsoleteInputs(context);
    updateWorkshopUpgrades(context);
    context.horses!.update(dt);
    // After the military update, before the scheduler: AI sites and demands are served this tick (EAI plan §3.1).
    markTickPhase(FACTION_AI_TICK_PHASE);
    context.factionAi?.update();
    context.scheduling += dt;
    if (context.scheduling >= 0.5) {
      context.scheduling -= 0.5;
      markTickPhase("schedule.population");
      if (tickSystemMasked(context.options.tickMask?.populationGrowth) && context.options.onSchedulerPhase)
        context.options.onSchedulerPhase("population", 0.5);
      else updatePopulationGrowth(context, 0.5);
      updateFactionPopulationGrowth(context, 0.5);
      markTickPhase("schedule.recruit");
      recruitWorkers(context); recruitUpgradeBuilders(context);
      markTickPhase("schedule.military");
      military.schedule();
      // Escrows follow their harbour and trade/relief ships set off (payments are staged in pool custody).
      markTickPhase("schedule.trade");
      context.relief?.schedule(); trade.schedule();
      scheduleDeliveries(context);
      markTickPhase("schedule.relocation");
      updateStrandedRelocation(context);
      markTickPhase("schedule.carts");
      collectFinishedHandcarts(context);
      collectAbandonedHandcarts(context);
      // Lowest priority (plan review B8c): ruins take only the settlers deliveries and carts left idle.
      markTickPhase("schedule.ruins");
      dispatchRuinClearing(context);
      markTickPhase("schedule.colonyAdventure");
      colony.update(.5);
      adventure.update();
      markTickPhase("schedule.stone");
      if (tickSystemMasked(context.options.tickMask?.stoneRespawns) && context.options.onSchedulerPhase)
        context.options.onSchedulerPhase("stone", 0.5);
      else updateStoneRespawns(context, .5, RESPAWNING_DEPOSITS);
    }
    markTickPhase("personIndex");
    beginPersonTrafficTick(context);
    for (const building of context.buildings) {
      if (building.construction < 1 && building.worker === undefined) building.working = false;
    }
    startingActors.length = context.actors.length;
    for (let index = 0; index < context.actors.length; index++)
      startingActors[index] = context.actors[index]!;
    for (const actor of startingActors) {
      markTickPhase("actor", actor.job ?? "none");
      updateSettlementActorTick(context, systems, actor, dt);
    }
    // Finished bridge and verge sites commit their road work only after the last builder contact.
    markTickPhase("bridges");
    updateBridgeConstruction(context);
    markTickPhase("verges");
    updateRoadVergePlanting(context);
    updateBridgeRemovals(context, dt);
    // After the workers: the Tavern's recruiting status replaces the innkeeper's "Staffed".
    markTickPhase("tavernTrade");
    tavern.update(dt);
    trade.update(dt);
    markTickPhase("idle");
    separateIdlePeople(context);
    markTickPhase("idleCarriers");
    reclaimIdleCarriers(context);
    compactRetiredSettlers(context);
    markTickPhase("door");
    if (!context.options.tickMask?.doorActivity) updateDoorActivity(context, dt);
    // Last: the vision layer stamps the positions this tick ended on and writes the player's fog.
    markTickPhase("vision");
    updateSettlementVision(context);
    endTickPhases();
  };
};
