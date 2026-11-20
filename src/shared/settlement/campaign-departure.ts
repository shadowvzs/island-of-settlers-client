import type { CampaignCargo } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { takeHarbourHelpers } from "./harbour-helper-supply";
import type { MilitaryTroopType } from "./military-combat-rules";
import { addGood } from "./production-rules";
import type { EmigratedTroop } from "./settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * The simple campaign departure (C8): the map's cargo leaves the home island at once, without loading or boarding.
 * The caller has passed the launch gate (`campaignRequirements`), so every line is in stock: the wares leave the
 * harbour's pooled stock, the free reserve soldiers emigrate with their rank and health, the idle settlers leave
 * the storages that can reach the harbour.
 */
export type CampaignReserve = (type: MilitaryTroopType) => readonly SettlementActor[];

const takeGoods = (source: SettlementBuilding, goods: CampaignCargo["goods"]) => {
  for (const { amount, ware } of goods) addGood(source.inventory, ware, -Math.min(amount, source.inventory[ware] ?? 0));
};

const takeSoldiers = (context: SettlementContext, soldiers: CampaignCargo["soldiers"], reserve: CampaignReserve) =>
  soldiers.flatMap(({ amount, type }) => reserve(type).slice(0, amount)
    .flatMap(actor => context.military?.emigrate?.(actor.uid) ?? []));

/** Takes the cargo out of the home island; returns the soldiers that left, in cargo line order. */
export const takeCampaignCargo = (
  context: SettlementContext, source: SettlementBuilding, cargo: CampaignCargo, reserve: CampaignReserve
): EmigratedTroop[] => {
  takeGoods(source, cargo.goods);
  takeHarbourHelpers(context, source, cargo.settlers);
  return takeSoldiers(context, cargo.soldiers, reserve);
};
