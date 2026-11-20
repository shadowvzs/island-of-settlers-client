import type { I18n } from "@lingui/core";

import { formatDomainWareCount } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import { expeditionReadinessReason, expeditionRequiredSoldiers } from "../../../shared/settlement/expedition-launch-rules";
import type { ShuttleStatus } from "../../../shared/settlement/harbour-shuttle-plan";
import type { ScoutingAvailability, ScoutingAvailabilityReason } from "../../../shared/settlement/settlement-naval-charting";
import type { ExpeditionPreparationSnapshot } from "../../../shared/settlement/settlement-naval-preparation";
import type { ShippingDemandSnapshot } from "../../../shared/settlement/settlement-shipping-demand";
import { getFeatureGate } from "../feature-gate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiSnapshot } from "../types";
import type { BuildingDetailsData } from "./helpers";

const PREPARATION_LABELS = {
  crew: M.details.harbour.preparationCrew,
  ready: M.details.harbour.preparationReady,
  shore: M.details.harbour.preparationShore,
  ship: M.details.harbour.preparationShip,
  supplies: M.details.harbour.preparationSupplies
} as const satisfies Readonly<Record<ExpeditionPreparationSnapshot["status"], unknown>>;

/** The harbour's static action copy, resolved for the active locale. */
export const getHarbourText = (i18n?: I18n) => ({
  adventure: translateMessage(i18n, M.details.harbour.adventure),
  busy: translateMessage(i18n, M.details.harbour.busy),
  colony: translateMessage(i18n, M.details.harbour.colony),
  explore: translateMessage(i18n, M.details.harbour.explore),
  exploreAccepted: translateMessage(i18n, M.details.harbour.exploreAccepted),
  exploreRefused: translateMessage(i18n, M.details.harbour.exploreRefused),
  launchAccepted: translateMessage(i18n, M.details.harbour.launchAccepted),
  launchRefused: translateMessage(i18n, M.details.harbour.launchRefused),
  orderCancelled: translateMessage(i18n, M.details.harbour.orderCancelled),
  orderDone: translateMessage(i18n, M.details.harbour.orderDone),
  preparationCancelled: translateMessage(i18n, M.details.harbour.preparationCancelled),
  preparationLaunched: translateMessage(i18n, M.details.harbour.preparationLaunched)
});

const scoutingReasonMessage = (reason: ScoutingAvailabilityReason) => {
  switch (reason) {
    case "active": return M.details.harbour.scoutingActive;
    case "scout": return M.details.harbour.scoutingMissingScout;
    case "ship": return M.details.harbour.scoutingWaitingShip;
    case "spyglass": return M.details.harbour.scoutingMissingSpyglass;
    case "featureOff": return M.common.featureMapOff;
    default: return undefined;
  }
};

/** Visibility/readiness of the scouting action; available without a query in authored snapshots. */
export const getScoutingView = (availability?: ScoutingAvailability, i18n?: I18n) => {
  if (!availability) return { disabled: false, hidden: false, title: undefined };
  const descriptor = availability.reason ? scoutingReasonMessage(availability.reason) : undefined;
  return {
    disabled: !availability.ready,
    hidden: availability.hidden,
    title: descriptor ? translateMessage(i18n, descriptor) : undefined
  };
};

/** Expedition preparations started at this harbour, with their supply / crew progress. */
export const getHarbourPreparations = (
  uid: number, preparations: SettlementUiSnapshot["expeditionPreparations"] = [], i18n?: I18n
) => preparations.filter(preparation => preparation.sourceUid === uid).map(preparation => ({
  id: preparation.id,
  text: translateMessage(i18n, M.details.harbour.preparation, {
    crew: preparation.crew,
    hammer: preparation.cargo.hammer ?? 0,
    planks: preparation.cargo.planks ?? 0,
    shovel: preparation.cargo.shovel ?? 0,
    status: translateMessage(i18n, PREPARATION_LABELS[preparation.status]),
    stone: preparation.cargo.stone ?? 0
  })
}));

/** Exploration and settlement voyages from this harbour that can still be cancelled. */
export const getHarbourOrders = (uid: number, orders: SettlementUiSnapshot["seaOrders"] = [], i18n?: I18n) =>
  orders
    .filter(order => order.sourceUid === uid && (order.exploration || order.expedition))
    .map(order => ({ id: order.id, label: translateMessage(i18n,
      order.exploration ? M.details.harbour.cancelExploration : M.details.harbour.cancelSettlement,
      { id: order.id }) }));

const shippingStatusMessage = (demand: ShippingDemandSnapshot) => {
  switch (demand.reason) {
    case "batching": return M.details.harbour.shippingBatching;
    case "no-harbour": return M.details.harbour.shippingNoHarbour;
    case "no-ship": return M.details.harbour.shippingWaitingShip;
    case "no-source": return M.details.harbour.shippingWaitingSource;
    case "not-accepted": return M.details.harbour.shippingNotAccepted;
    case "reduced": return M.details.harbour.shippingReduced;
    case "route-lost": return M.details.harbour.shippingRouteLost;
    case "storage-full": return M.details.harbour.shippingStorageFull;
    default: return demand.fleet > 0 ? M.details.harbour.shippingInTransit : M.details.harbour.shippingOutstanding;
  }
};
/** Outstanding, in-transit and blocked destination needs for this harbour, with their honest reason. */
export const getHarbourShippingDemands = (
  uid: number, demands: readonly ShippingDemandSnapshot[] = [], i18n?: I18n
) => demands
  .filter(demand => demand.harbourUid === uid || (demand.harbourUid === undefined &&
    demand.destinationUid === uid))
  .map(demand => {
    const count = Math.max(demand.outstanding, demand.fleet);
    return { id: demand.id, text: translateMessage(i18n, M.details.harbour.shippingDemand, {
      cargo: formatDomainWareCount(demand.ware, count, i18n),
      status: translateMessage(i18n, shippingStatusMessage(demand))
    }) };
  });

/** A clear line for the nearby boat service's availability or exact waiting reason. */
export const getHarbourShuttleText = (status: ShuttleStatus | undefined, i18n?: I18n) => {
  if (!status) return undefined;
  const cargo = Object.entries(status.cargo ?? {}).map(([ware, count]) =>
    formatDomainWareCount(ware, count, i18n)).join(", ");
  switch (status.reason) {
    case "active": return translateMessage(i18n, M.details.harbour.shuttleActive, {
      cargo, destination: status.destinationUid ?? 0, seconds: Math.ceil(status.secondsLeft ?? 0)
    });
    case "cargo-blocked": return translateMessage(i18n, M.details.harbour.shuttleCargoBlocked, { cargo });
    case "destination-full":
      return translateMessage(i18n, M.details.harbour.shuttleDestinationFull, { cargo });
    case "route-blocked": return translateMessage(i18n, M.details.harbour.shuttleRouteBlocked);
    case "idle": return translateMessage(i18n, M.details.harbour.shuttleIdle,
      { boats: status.freeBoats, rowers: status.idleRowers });
    case "no-crew": return translateMessage(i18n, M.details.harbour.shuttleNoCrew);
    case "no-landing": return translateMessage(i18n, M.details.harbour.shuttleNoLanding);
    case "no-partner": return translateMessage(i18n, M.details.harbour.shuttleNoPartner);
    case "no-route": return translateMessage(i18n, M.details.harbour.shuttleNoRoute);
    default: return translateMessage(i18n, M.details.harbour.shuttleWaitingBoat);
  }
};

/**
 * Colony / adventure planner buttons: hidden without a planner or while the game switches the feature off,
 * disabled while an expedition runs or the map narrows the feature.
 */
export const getPlannerButtons = (
  busy: boolean, hasColony: boolean, hasAdventure: boolean, data?: BuildingDetailsData, i18n?: I18n
) => {
  const text = getHarbourText(i18n);
  const colonyGate = getFeatureGate(data?.features?.colonies, i18n);
  const adventureGate = getFeatureGate(data?.features?.adventures, i18n);
  const reasonFor = (islands: NonNullable<BuildingDetailsData["adventureIslands"]> |
    NonNullable<BuildingDetailsData["colonyIslands"]>, gateReason: string | undefined) => {
    if (gateReason) return gateReason;
    if (busy) return text.busy;
    const offered = islands.filter(island => !("taken" in island && island.taken));
    if (!offered.length) return translateMessage(i18n, M.details.harbour.noTarget);
    const required = Math.min(...offered.map(expeditionRequiredSoldiers));
    return expeditionReadinessReason(required, data?.colonyTroops ?? {}, data?.idleExpeditionShips ?? 0);
  };
  const colonyReason = reasonFor(data?.colonyIslands ?? [], colonyGate.reason);
  const adventureReason = reasonFor(data?.adventureIslands ?? [], adventureGate.reason);
  return {
    adventureDisabled: Boolean(adventureReason), adventureTitle: adventureReason ?? text.adventure,
    busy, colonyDisabled: Boolean(colonyReason), colonyTitle: colonyReason ?? text.colony,
    hideAdventure: !hasAdventure || adventureGate.hidden, hideColony: !hasColony || colonyGate.hidden
  };
};


/**
 * "Potential settlement" rows: none while the game switches settlement expeditions off; their Occupy buttons are
 * disabled with the reason while the map narrows them or a voyage from this harbour runs (`blocked`).
 */
export const getPotentialSettlementGate = (data: BuildingDetailsData, expeditionActive: boolean, i18n?: I18n) => {
  const gate = getFeatureGate(data.features?.settlementExpeditions, i18n);
  const busy = expeditionActive ? getHarbourText(i18n).busy : undefined;
  return { blocked: gate.reason ?? busy, hidden: gate.hidden };
};
