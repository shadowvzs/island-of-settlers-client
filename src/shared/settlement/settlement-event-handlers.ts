import { completeForesterPlant } from "./settlement-forester-work";
import { completeHuntAim, completeHuntFlight, completeHuntWait } from "./settlement-hunting";
import type { SettlementContext } from "./settlement-types";
import {
  advanceFishingWorker, applyBuilderContact, finishWorkerProduction, finishWorkWorker
} from "./settlement-workers";
import { workerCycleRate } from "./workshop-upgrades";

/** Event-core actor callbacks kept out of the simulation factory's 300-line body. */
export const createEventActorHandlers = (context: SettlementContext) => {
  const actorOf = (uid: number) => context.actors.find(entry => entry.uid === uid);
  const buildingOf = (uid: number | undefined) =>
    uid === undefined ? undefined : context.buildings.find(entry => entry.uid === uid);
  return {
    eventFishingTick: (uid: number) => {
      const actor = actorOf(uid);
      return actor ? advanceFishingWorker(context, actor) : undefined;
    },
    eventWorkTick: (uid: number) => {
      const actor = actorOf(uid);
      return actor ? finishWorkWorker(context, actor) : false;
    },
    eventWorkerCycleRate: (uid: number) => {
      const actor = actorOf(uid);
      return actor ? workerCycleRate(context, actor) : 1;
    },
    eventBuilderContactTick: (uid: number) => {
      const actor = actorOf(uid);
      return actor ? applyBuilderContact(context, actor) : false;
    },
    eventForesterPlantTick: (uid: number) => {
      const actor = actorOf(uid), building = buildingOf(actor?.building);
      return actor && building && actor.phase === "foresterPlant"
        ? completeForesterPlant(context, actor, building) : false;
    },
    eventHuntFlightTick: (uid: number) => {
      const actor = actorOf(uid), building = buildingOf(actor?.building);
      return actor && building && actor.phase === "huntFlight"
        ? completeHuntFlight(context, actor, () => finishWorkerProduction(context, actor, building)) : false;
    },
    eventHuntAimTick: (uid: number) => {
      const actor = actorOf(uid), building = buildingOf(actor?.building);
      return actor && building && actor.phase === "huntAim"
        ? completeHuntAim(context, actor, () => finishWorkerProduction(context, actor, building)) : false;
    },
    eventHuntWaitTick: (uid: number) => {
      const actor = actorOf(uid), building = buildingOf(actor?.building);
      return actor && building && actor.phase === "huntWait"
        ? completeHuntWait(context, actor, () => finishWorkerProduction(context, actor, building)) : false;
    }
  };
};
