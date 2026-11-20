import type { ShipFrame } from "../../render-common/ships/ship-frame";
import { lighterDeckBoxes } from "./harbour-lighters";
import { findHarbourDock } from "./settlement-harbour-docks";
import type { NavalShip } from "./settlement-naval-fleet";
import { visibleDeckBoxes } from "./settlement-naval-logistics";
import { contextTalents } from "./settlement-talents";
import type { SettlementContext } from "./settlement-types";
import { cargoBoxes } from "./ship-cargo-boxes";
import { deckBoxesAt, dockPorterSpeedFactor, planCargoHandling, routeLength } from "./ship-cargo-handling";
import { cargoPresentation } from "./ship-cargo-presentation";
import { planTroopShipLanding } from "./troop-ship-landing";

/** Seconds a ship lies at the pier at least to load or unload. */
const TRANSFER_SECONDS = 10;
const TRADER_NATIONS = ["roman", "viking", "japanese", "nubian"] as const;

/**
 * The boxes a ship carries: a colony load's packed boxes, else one box per ware load. Logistics visitors (trade,
 * supply, ore) carry everything but show and handle at most a full hold (settlement-naval-logistics.ts).
 */
export const shipBoxes = (ship: NavalShip) => ship.colony?.boxes ?? visibleDeckBoxes(ship, cargoBoxes(ship.cargo));
/** Boxes on the deck now: none before loading, the porters' progress at the pier, else all of them. */
const deckBoxes = (ship: NavalShip) => {
  const transfer = ship.phase === "loading" || ship.phase === "unloading";
  if (transfer && ship.lighters) {
    const { plan } = ship.lighters;
    return lighterDeckBoxes(plan, plan.seconds - ship.timer, ship.phase === "unloading");
  }
  if (transfer && ship.handling)
    return deckBoxesAt(ship.handling, ship.handling.seconds - ship.timer, ship.phase === "unloading");
  const toLoad = ship.phase === "positioning" || ship.retryPhase === "positioning" || ship.phase === "idle";
  return toLoad ? 0 : shipBoxes(ship);
};
/** The lighters working the ship at its waiting spot: their plan and the seconds since the job began. */
const lighterWork = (ship: NavalShip, manifest: ShipFrame["cargoManifest"]) => {
  const job = ship.lighters, working = ship.phase === "loading" || ship.phase === "unloading";
  if (!job || !working) return {};
  return { lighterWork: { manifest, passengerIds: ship.passengers, boats: job.boats, elapsed: job.plan.seconds - ship.timer, plan: job.plan,
    unloading: ship.phase === "unloading" } };
};
/** Shared render/register identity; no UI-specific visitor nation calculation. */
export const shipAppearance = (ship: NavalShip): Pick<ShipFrame, "nation" | "livery"> => {
  const trader = ship.visitor?.role === "trade";
  return { livery: ship.livery ?? (trader ? "neutral" : undefined),
    nation: trader ? TRADER_NATIONS[Math.abs(ship.id) % TRADER_NATIONS.length] : undefined };
};
export const shipFrame = (ship: NavalShip): ShipFrame => {
  const { anchorage, cargo, colony, cursor, handling, lighters, route: path, timer, transfer: moved, ...frame } = ship;
  // The porters turn out once the passengers are through (the job's clock has started).
  const transfer = handling && (ship.phase === "loading" || ship.phase === "unloading") && timer < handling.seconds;
  const manifest = cargoPresentation(moved?.load ?? cargo,
    lighters?.plan.boxes ?? handling?.boxes ?? shipBoxes(ship));
  const observing = ship.exploration !== undefined && !ship.exploration.returning && ship.phase === "unloading";
  const observationSeconds = observing && handling ? Math.max(0, handling.seconds - timer) : undefined;
  return { ...frame, ...shipAppearance(ship),
    cargoManifest: manifest,
    deckBoxes: deckBoxes(ship),
    deckPassengers: (ship.passengers?.length ?? 0) + (ship.troops?.length ?? 0), deckTroops: ship.troops,
    ...(observing ? { observing: true, observationSeconds } : {}),
    ...(transfer ? { cargoWork: { elapsed: handling.seconds - timer, manifest, plan: handling,
      unloading: ship.phase === "unloading" } } : {}), ...lighterWork(ship, manifest) };
};
/**
 * Dock porters carry the ship's boxes over the pier: the job lasts at least the ship's own loading
 * time, and as long as the porters need. Without a pier (a beach, an anchorage) only that time.
 */
export const planHandling = (context: SettlementContext, ship: NavalShip, loading: boolean) => {
  const harbourUid = loading ? ship.sourceUid : ship.destinationUid;
  const dock = findHarbourDock(context, harbourUid, ship);
  const route = dock && [...dock.porterRoute, dock.workPier.shore, dock.workPier.point];
  const length = route ? routeLength(route) : 0;
  // Soldiers from another island walk ashore over the pier before the harbour takes them in.
  const landing = !loading && dock ? planTroopShipLanding(shipFrame(ship), dock).seconds : 0;
  // Passengers walking over the pier take their own time before the porters start.
  const own = route && ship.passengers?.length ? 0 : TRANSFER_SECONDS;
  const minimum = loading ? own : Math.max(own, landing);
  return planCargoHandling(route ? shipBoxes(ship) : 0, length, minimum, harbourPorterSpeed(context, harbourUid));
};
/** Porters of an upgraded harbour walk and lift faster (owner 2026-10-19), for every ship handled there. */
export const harbourPorterSpeed = (context: SettlementContext, harbourUid: number | undefined) => {
  const harbour = context.buildings.find(building => building.uid === harbourUid);
  return dockPorterSpeedFactor(harbour?.workshopUpgrade?.level ?? 0, contextTalents(context).dockPorterSpeed);
};
