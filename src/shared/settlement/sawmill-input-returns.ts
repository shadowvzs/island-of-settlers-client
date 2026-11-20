import { SAWMILL_RECIPES } from "@shared/catalog/balance";

import { selectedSawmillRecipe } from "./sawmill-recipes";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** Input remains on its bay until its assigned carrier physically picks it up. */
export const reservedInputReturns = (context: SettlementContext, building: SettlementBuilding, ware: string) => {
  if (building.typeId !== 33) return 0;
  return context.actors.reduce((total, actor) => total + Number(Boolean(actor.delivery?.source === building.uid &&
    actor.delivery.ware === ware && actor.delivery.sourceInput && actor.delivery.reserved)) +
    (actor.nextDelivery?.source === building.uid && actor.nextDelivery.ware === ware &&
      actor.nextDelivery.sourceInput ? actor.nextDelivery.units : 0), 0);
};
export const committedWorkerInputs = (context: SettlementContext, building: SettlementBuilding, ware: string) => {
  const worker = context.actors.find(actor => actor.uid === building.worker);
  const promised = worker?.productionInputs?.filter(input => input === ware).length ?? 0;
  // The first receipt remains in productionInputs until the worker reaches the door, although
  // that item has already left building.input and is in actor.consumed / the worker's hands.
  const carrying = worker?.productionInputs?.[0] === ware && worker.ware === ware &&
    ["inputPickup", "inputReturn", "inputReturnBlocked"].includes(worker.phase);
  return Math.max(0, promised - Number(carrying));
};
export const unusedSawmillInputs = (context: SettlementContext, building: SettlementBuilding) => {
  if (building.typeId !== 33 || building.construction !== 1) return [];
  const activeInput = building.handcartMode ? "logs" : selectedSawmillRecipe(building).input;
  return Object.entries(building.input).filter(([ware, count]) =>
    SAWMILL_RECIPES.some(recipe => recipe.input === ware) && ware !== activeInput &&
    count > committedWorkerInputs(context, building, ware) + reservedInputReturns(context, building, ware));
};
