import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { HARBOUR_TYPE_ID } from "../../../shared/settlement/building-type-ids";
import { joinDetails } from "../../components/helpers";
import { getFeatureGate } from "../feature-gate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { shipJourneyLabel } from "../ship-journey-label";
import type { ShoreTarget } from "../shore-target";
import type {
  SettlementBuildingSummary, SettlementShipSummary, SettlementUiOptions, SettlementUiSnapshot
} from "../types";

const CARGO_LIMIT = 40;

/** Static Ships view and command copy, resolved for the active locale. */
export const getFleetText = (i18n?: I18n) => ({
  cargoInvalid: translateMessage(i18n, M.fleet.cargoInvalid),
  cargoQueued: translateMessage(i18n, M.fleet.cargoQueued),
  cargoRefused: translateMessage(i18n, M.fleet.cargoRefused),
  empty: translateMessage(i18n, M.fleet.empty),
  expeditionQueued: translateMessage(i18n, M.fleet.expeditionQueued),
  expeditionRefused: translateMessage(i18n, M.fleet.expeditionRefused),
  passengersQueued: translateMessage(i18n, M.fleet.passengersQueued),
  passengersRefused: translateMessage(i18n, M.fleet.passengersRefused),
  shoreCost: translateMessage(i18n, M.fleet.shoreCost),
  shoreMissing: translateMessage(i18n, M.fleet.shoreMissing),
  voyageCancelled: translateMessage(i18n, M.fleet.voyageCancelled),
  voyageDone: translateMessage(i18n, M.fleet.voyageDone)
});

/** What the Ships view reads from the snapshot (shallow-compared). */
export const selectFleet = (snapshot: SettlementUiSnapshot) => ({
  buildings: snapshot.buildings,
  resources: snapshot.resources,
  seaOrders: snapshot.seaOrders,
  settlementExpeditions: snapshot.features?.settlementExpeditions,
  ships: snapshot.ships
});

export type FleetSlice = ReturnType<typeof selectFleet>;

const isCompletedHarbour = (building: SettlementBuildingSummary) =>
  building.type === HARBOUR_TYPE_ID && Boolean(building.completed);

/** Completed harbours as select options, labelled with the spelling each form always used. */
export const getHarbourOptions = (
  buildings: readonly SettlementBuildingSummary[] | undefined, noun: string, i18n?: I18n
) => (buildings ?? []).filter(isCompletedHarbour).map(building => ({
  label: translateMessage(i18n, noun === "Harbor" ? M.fleet.harbor : M.fleet.harbour, { id: building.id }),
  value: building.id
}));

/** How many harbours are completed (no option lists are built just to count them). */
const countCompletedHarbours = (buildings: readonly SettlementBuildingSummary[] | undefined) => {
  let count = 0;
  for (const building of buildings ?? []) if (isCompletedHarbour(building)) count += 1;
  return count;
};

/** The chosen harbour while it still exists, else the option at `fallback` (clamped to the list). */
export const resolveChoice = (choices: readonly { value: string }[], chosen: string | null, fallback: number) => {
  if (choices.some(choice => choice.value === chosen)) return chosen!;
  return choices[Math.min(fallback, choices.length - 1)]?.value ?? "";
};

/** Wares in stock that a ship can carry. */
export const getCargoWares = (resources: Readonly<Record<string, number>> | undefined) =>
  Object.entries(resources ?? {}).filter(([, count]) => count > 0)
    .map(([name]) => ({ label: name, value: name }));

/** Different harbours, a ware and 1–40 of it; otherwise the reason. */
export const getCargoRequest = (source: string, destination: string, ware: string, quantity: string) => {
  const count = Number(quantity);
  if (source === destination || !ware || !Number.isInteger(count) || count < 1 || count > CARGO_LIMIT) return null;
  return { destination: Number(destination), goods: { [ware]: count }, source: Number(source) };
};

/** Fleet rows: name and the status · journey · cargo line. */
export const getShipRows = (ships: readonly SettlementShipSummary[] | undefined, i18n?: I18n) =>
  (ships ?? []).map(ship => ({
    detail: joinDetails(ship.status, shipJourneyLabel(ship, i18n), ship.cargo),
    id: ship.id,
    name: ship.name
  }));

export type FleetShipRow = ReturnType<typeof getShipRows>[number];

export const getCancelOrderLabel = (order: { expedition: boolean; id: number }, i18n?: I18n) =>
  translateMessage(i18n, order.expedition ? M.fleet.cancelExpedition : M.fleet.cancelVoyage, { id: order.id });

export const getShoreOptions = (targets: readonly ShoreTarget[], i18n?: I18n) =>
  targets.map((target, index) => ({
    label: translateMessage(i18n, M.fleet.shore, {
      x: Math.round(target.x), z: Math.round(target.z)
    }),
    value: String(index)
  }));

/**
 * Which Ships view sections exist: cargo needs two harbours, passengers one. The settlement shore controls hide
 * while the game switches settlement expeditions off; `shoreBlocked` disables founding where the map narrows it.
 */
export const getFleetSections = (slice: FleetSlice, options: SettlementUiOptions, i18n?: I18n) => {
  const harbours = countCompletedHarbours(slice.buildings);
  const cargo = Boolean(options.onQueueTransport) && harbours >= 2;
  const passengers = Boolean(options.onQueuePassengers) && harbours > 0;
  const gate = getFeatureGate(slice.settlementExpeditions, i18n);
  const shores = passengers && !gate.hidden && Boolean(options.onExpeditionTargets && options.onQueueExpedition);
  return { cargo, empty: !cargo && !passengers && !slice.ships?.length, passengers, shoreBlocked: gate.reason, shores };
};
