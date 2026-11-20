import { COLONY_VOYAGE_SECONDS, TROOP_DECK_SLOTS } from "../balance/colonies";
import { DMath } from "../math/deterministic-math";
import { admitPlayerOrder } from "../script-world/script-order-guard";
import { colonyDeckItems, packColonyLoads } from "./colony-expedition-rules";
import { contextIslandRole, type IslandRole } from "./island-role";
import { landmassCount } from "./settlement-landmass-index";
import type { createNavalFleet } from "./settlement-naval-fleet";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { allAboard, canWalkToHarbour } from "./ship-troop-boarding";
import type { TroopShipOrderResult, TroopShipResult } from "./ship-troop-missions";
import type { TroopShipDestination } from "./ship-troop-targets";

/** How the panel's "Return home" works on this island: the colony recall, the campaign run's end, or none. */
export type TroopShipReturnHome = "colonyRecall" | "campaignRun" | null;

/** Ship actions valid in this map context (military controls research §9.3, owner 2026-11-13). */
export interface TroopShipActions {
  /** A selection can board it here: a docked or anchored own ship (on a colony: the called troop ship). */
  board: boolean;
  /** Soldiers aboard or walking aboard. */
  carrying: boolean;
  multiIsland: boolean;
  returnHome: TroopShipReturnHome;
  role: IslandRole;
  sailTo: boolean;
  unload: boolean;
}

interface TroopShipCommandOptions {
  context: SettlementContext;
  fleet: ReturnType<typeof createNavalFleet>;
  /** The colony recall's recorded pickup (`createColonyTroopPickup`). */
  requestTroopPickup: (ids: readonly number[], travelSeconds: number) => number[];
  /** The harbour a colony's troop ship calls at. */
  pickupHarbour: () => SettlementBuilding | undefined;
}

const refuse = (reason: string) => ({ ok: false as const, reason });

const deckSlotsOf = (context: SettlementContext, uid: number) =>
  TROOP_DECK_SLOTS[context.military?.troopType?.(uid) ?? "shield"];

/**
 * The recorded colony troop pickup (`requestTroopPickup`): one called troop ship per deck load collects the
 * soldiers at the pickup harbour, where they are sent first. Returns the soldiers a ship was called for.
 */
export const createColonyTroopPickup = (context: SettlementContext, fleet: ReturnType<typeof createNavalFleet>,
  pickupHarbour: () => SettlementBuilding | undefined) => (ids: readonly number[], travelSeconds: number) => {
  const harbour = pickupHarbour();
  if (!harbour) return [];
  const items = ids.map(uid => ({ slots: deckSlotsOf(context, uid), uid }));
  const loads = packColonyLoads(colonyDeckItems(items, {}));
  const accepted = loads.flatMap(load =>
    fleet.requestTroopPickup(harbour.uid, load.passengers, travelSeconds) === null ? [] : load.passengers);
  context.military?.returnToStorage?.(accepted, harbour.uid);
  return accepted;
};

const returnHomeFor = (role: IslandRole): TroopShipReturnHome => {
  if (role === "colony" || role === "adventure") return "colonyRecall";
  return role === "campaign" ? "campaignRun" : null;
};

/**
 * The troop ship commands and read-only checks under their simulation names (MIL-SHIPS-SIM). One entry point
 * boards a selection: on a colony the recorded troop pickup takes one deck load (the ship from home calls, as
 * the recall does), elsewhere the clicked own ship takes it at its harbour pier or its anchored gangway.
 */
export const createTroopShipCommands = (options: TroopShipCommandOptions) => {
  const { context, fleet, pickupHarbour, requestTroopPickup } = options;
  const missions = fleet.troopMissions;
  const actorOf = (uid: number) => context.actors.find(actor => actor.uid === uid);
  /** Colony pickup: one deck load of the chosen soldiers nearest the harbour; the rest wait. */
  const planColonyPickup = (ids: readonly number[], harbour: SettlementBuilding) => {
    const distance = (actor: SettlementActor) => DMath.hypot(actor.x - harbour.access.x, actor.z - harbour.access.z);
    const chosen = [...new Set(ids)].flatMap(uid => actorOf(uid) ?? [])
      .filter(actor => canWalkToHarbour(context, actor))
      .sort((a, b) => distance(a) - distance(b) || a.uid - b.uid);
    const items = chosen.map(actor => ({ slots: deckSlotsOf(context, actor.uid), uid: actor.uid }));
    const boarding = packColonyLoads(colonyDeckItems(items, {}))[0]?.passengers ?? [];
    return { boarding, waiting: chosen.map(actor => actor.uid).filter(uid => !boarding.includes(uid)) };
  };
  const colonyPickup = (ids: readonly number[]): TroopShipResult => {
    const harbour = pickupHarbour();
    if (!harbour) return refuse("No harbour for a troop ship to call at");
    const plan = planColonyPickup(ids, harbour);
    if (!plan.boarding.length) return refuse("No chosen soldier can board");
    // The island's voyage is read in the simulation, as for the commander's return ship (never a client value).
    const voyage = context.options.commanderVoyageSeconds?.() ?? COLONY_VOYAGE_SECONDS;
    const boarding = requestTroopPickup(plan.boarding, voyage);
    if (!boarding.length) return refuse("No troop ship can call at the harbour");
    const waiting = [...plan.waiting, ...plan.boarding.filter(uid => !boarding.includes(uid))];
    const field = waiting.filter(uid => actorOf(uid)?.phase === "militaryField");
    if (field.length) context.military?.commandSoldiers?.(field, harbour.access, "attackMove");
    return { boarding, ok: true, waiting };
  };
  const isColony = () => contextIslandRole(context) === "colony";
  /** Read-only: who would board (the same plan the command applies), or why nobody can. */
  const boardingCheck = (ids: readonly number[], shipId: number) => {
    if (isColony()) {
      const harbour = pickupHarbour();
      return harbour ? { ok: true as const, pickup: true, ...planColonyPickup(ids, harbour) }
        : refuse("No harbour for a troop ship to call at");
    }
    const ship = missions.shipById(shipId);
    if (!ship) return refuse("No such ship");
    const site = missions.boardingSite(ship, ids);
    if ("reason" in site) return refuse(site.reason);
    return { ok: true as const, anchored: "anchor" in site, pickup: false, ...missions.planBoarding(ship, site, ids) };
  };
  const actions = (shipId: number): TroopShipActions | null => {
    const ship = missions.shipById(shipId);
    if (!ship) return null;
    const role = contextIslandRole(context), multiIsland = landmassCount(context.options.world) > 1;
    const carrying = Boolean(ship.passengers?.length || ship.troopMission?.boarding.length);
    const homeVoyage = role === "colony" || role === "adventure";
    return { board: role === "colony" || missions.canBoard(ship), carrying, multiIsland,
      returnHome: returnHomeFor(role), role, sailTo: carrying && multiIsland && !homeVoyage, unload: carrying };
  };
  const status = (shipId: number) => {
    const ship = missions.shipById(shipId), mission = ship?.troopMission;
    if (!ship) return null;
    const aboard = (ship.passengers ?? []).filter(uid => actorOf(uid)?.phase === "navalAboard").length;
    return { aboard, anchored: Boolean(mission?.anchor), boarding: (mission?.boarding.length ?? 0) +
      (ship.passengers?.length ?? 0) - aboard, capacityLeft: missions.capacityLeft(ship),
    harbourUid: mission?.harbourUid, landing: mission?.landers?.length ?? 0, mission: Boolean(mission),
    ready: Boolean(mission) && !mission!.boarding.length && allAboard(context, ship), target: mission?.target?.kind };
  };
  return {
    /** Recorded: boards the chosen soldiers on own ship `shipId` (a colony calls its troop ship instead). */
    embarkMilitary: (ids: readonly number[], shipId: number): TroopShipResult => {
      const admitted = admitPlayerOrder(context, Array.isArray(ids) ? ids : []);
      return isColony() ? colonyPickup(admitted) : missions.embark(admitted, shipId);
    },
    /** Recorded: a ship carrying or boarding soldiers sails to a harbour (docks, troops stay aboard) or a coast. */
    sailShip: (shipId: number, destination: TroopShipDestination): TroopShipOrderResult =>
      missions.sail(shipId, destination),
    /** Recorded: sails there if needed and lands the troops (a harbour pier: into the harbour; a coast: ashore). */
    landShipTroops: (shipId: number, point: TroopShipDestination): TroopShipOrderResult =>
      missions.land(shipId, point),
    troopShipActions: actions,
    troopShipBoardingCheck: boardingCheck,
    /** Read-only: a destination the ship could sail to or land at, with the reason when it cannot. */
    troopShipDestinationCheck: (shipId: number, destination: TroopShipDestination) => {
      const ship = missions.shipById(shipId);
      if (!ship) return refuse("No such ship");
      const check = missions.targets.resolve(ship, destination);
      return "reason" in check ? refuse(check.reason) : { kind: check.kind, ok: true as const };
    },
    troopShipStatus: status
  };
};
