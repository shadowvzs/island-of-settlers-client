import { COMMANDER_LODGE_TYPE_ID } from "./building-type-ids";
import { canPayMilitaryCost } from "./military-economy";
import { STORAGE_IDS } from "./production-rules";
import { hasRoadRoute } from "./road-route-helpers";
import { type CommanderRecruitAvailability,commanderRecruitCatalog, commanderRecruitCost } from "./settlement-commander";
import { isOwnBuilding } from "./settlement-home";
import { localStockSources, sharesLocalStockPool } from "./settlement-local-stock";
import { availableIdleSettlers } from "./settlement-population";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** Paid recruitment requirements for one completed lodge. */
const commanderChoiceAvailability = (
  context: SettlementContext, lodgeUid: number, hasCommander: boolean, definitionId?: string
): CommanderRecruitAvailability => {
  const lodge = context.buildings.find(building => building.uid === lodgeUid &&
    building.typeId === COMMANDER_LODGE_TYPE_ID && building.construction === 1 &&
    isOwnBuilding(building));
  const connected = context.buildings.filter(building => building.construction === 1 &&
    isOwnBuilding(building) && STORAGE_IDS.has(building.typeId) &&
    Boolean(lodge && sharesLocalStockPool(context, lodge.access, building) &&
      hasRoadRoute(context.options.roads, building.access, lodge.access)));
  const cost = commanderRecruitCost(context.playerNation ?? "roman", definitionId);
  const missing: Record<string, number> = {};
  const sources = lodge ? localStockSources(context, lodge.access, connected) : [];
  for (const [ware, count] of Object.entries(cost)) {
    const stock = sources.reduce((sum, building) => sum + (building.inventory[ware] ?? 0), 0);
    if (stock < count) missing[ware] = count - stock;
  }
  const idleSettlers = connected.reduce((sum, building) => sum + availableIdleSettlers(context, building), 0);
  const readySource = connected.find(building => canPayMilitaryCost(building.inventory, cost) &&
    availableIdleSettlers(context, building) > 0);
  const owner = context.options.commanderOwner?.get();
  let reason: string | null = null;
  if (!lodge) reason = "A completed Commander's Lodge is required";
  else if (hasCommander) reason = "A commander already serves this island";
  else if (owner && owner.homeIslandSeed !== context.options.world.seed)
    reason = "Another island already has your commander";
  else if (owner) reason = "A commander already serves this player";
  else if (Object.keys(missing).length) reason = "Missing recruit goods";
  else if (idleSettlers < 1) reason = "No idle settler is available";
  else if (!readySource) reason = "Connect a storehouse holding the recruit cost and an idle settler";
  else if (!connected.length) reason = "Connect a storehouse to the Commander's Lodge";
  return { available: reason === null, canRecruitMore: Boolean(lodge && !hasCommander && !owner), cost: { ...cost }, hasCommander,
    idleSettlers, missing, reason };
};

export const commanderRecruitAvailability = (context: SettlementContext, lodgeUid: number, hasCommander: boolean) => ({
  ...commanderChoiceAvailability(context, lodgeUid, hasCommander),
  choices: commanderRecruitCatalog(context.playerNation ?? "roman").map(definition => ({
    ...commanderChoiceAvailability(context, lodgeUid, hasCommander, definition.id), definitionId: definition.id
  }))
});

export const commanderRecruitSource = (context: SettlementContext, lodge: SettlementBuilding,
  cost: Readonly<Record<string, number>>) => context.buildings.find(building => building.construction === 1 &&
    isOwnBuilding(building) && STORAGE_IDS.has(building.typeId) &&
    sharesLocalStockPool(context, lodge.access, building) &&
    hasRoadRoute(context.options.roads, building.access, lodge.access) &&
    canPayMilitaryCost(building.inventory, cost) && availableIdleSettlers(context, building) > 0);
