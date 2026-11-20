import type { ShipSiteFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import {
  SHIP_TROOP_MISSION_VERSION, TROOP_ANCHORAGE_SNAP, TROOP_ANCHORAGE_STALL_SPEED, TROOP_GANGWAY_SITE_ID_OFFSET,
  TROOP_SHIP_ANCHOR_LINGER_SECONDS, TROOP_SHIP_RETRY_SECONDS
} from "./constants";
import { ADVENTURE_LANDING_PHASES, type AdventureLanding } from "./settlement-adventure-landing";
import { landmassAt } from "./settlement-landmass-index";
import type { FleetBerthing } from "./settlement-naval-berthing";
import { createChannelYield } from "./settlement-naval-channel-yield";
import type { NavalPassengerHooks, NavalShip } from "./settlement-naval-fleet";
import type { createShipRoutePlanner } from "./settlement-ship-routes";
import type { SettlementActor, SettlementContext } from "./settlement-types";
import {
  advanceAnchorGlide, type AnchorGlide, liesAtAnchorage, startAnchorGlide
} from "./ship-troop-anchor-glide";
import { createTroopShipBerthYield } from "./ship-troop-berth-yield";
import {
  advanceGangwayBoarding, advanceHarbourBoarding, allAboard, boardingPoint, collectHarbourArrivals, planTroopBoarding,
  pruneLostPassengers, startGangwayBoarding, startHarbourBoarding, type TroopBoardingSite, troopShipCapacityLeft,
  waitingPoint
} from "./ship-troop-boarding";
import { createHarbourWaterGuard } from "./ship-troop-harbour-water";
import { bringsHorseAboard, createTroopShipHorses } from "./ship-troop-horse";
import { createShipTroopLanding } from "./ship-troop-landing";
import type { ShipTroopMission, ShipTroopTarget } from "./ship-troop-mission";
import { createTroopBoardingSites } from "./ship-troop-sites";
import {
  createTroopShipTargets, landingAnchorage, type ResolvedTroopDestination, type TroopShipDestination
} from "./ship-troop-targets";

/** A troop ship command's answer (recorded): who boards, who waits ashore, or why nothing happened. */
export type TroopShipResult =
  | { ok: true; boarding: number[]; waiting: number[] }
  | { ok: false; reason: string };
/** `sailShip` / `landShipTroops` answer: where the ship goes, or why it does not. */
export type TroopShipOrderResult = { ok: true; kind: ResolvedTroopDestination["kind"] } | { ok: false; reason: string };

interface TroopMissionOptions {
  berthing: FleetBerthing;
  context: SettlementContext;
  hooks?: NavalPassengerHooks;
  /** The harbours' boat jetties, which troop ship anchorages keep clear of. */
  jetties: () => readonly ShipSiteFrame[];
  planner: ReturnType<typeof createShipRoutePlanner>;
  sea: Uint8Array;
  ships: NavalShip[];
  /** The mission is over at a harbour pier: the ship joins the order-driven fleet there. */
  releaseAtHarbour: (ship: NavalShip, harbourUid: number) => void;
  /** The mission is over at sea (an empty anchored ship): the ship lies idle where it is. */
  releaseInPlace: (ship: NavalShip) => void;
}

const refuse = (reason: string) => ({ ok: false as const, reason });

/** Nobody chosen fits aboard: the deck is full, or there is no room left for the commander's horse. */
const fullShipReason = (context: SettlementContext, waiting: readonly number[]) => {
  if (!waiting.length) return "No chosen soldier can board";
  const horseOnly = waiting.length === 1 && bringsHorseAboard(context, waiting[0]!);
  return horseOnly ? "No deck room for the commander's horse" : "The ship is full";
};

const sameWater = (ship: NavalShip, target: ShipTroopTarget) => {
  const mission = ship.troopMission!;
  if (target.kind === "harbour") return mission.harbourUid === target.uid;
  const anchor = mission.anchor?.water, water = target.landing.water;
  return Boolean(anchor && DMath.hypot(anchor.x - water.x, anchor.z - water.z) < 1);
};

/**
 * Player-controlled troop ships (MIL-SHIPS-SIM, owner 2026-11-13): `embarkMilitary` at a docked or anchored
 * own ship, `sailShip` to a harbour or coast of this map and `landShipTroops` there. Created once per fleet; the
 * fleet hands a mission ship to `update` and `arrive` before its own order-driven handling.
 */
export const createShipTroopMissions = (options: TroopMissionOptions) => {
  const { berthing, context, hooks, ships } = options;
  const { clearWater } = createHarbourWaterGuard(options);
  const targets = createTroopShipTargets({ ...options, clearWater });
  const landing = createShipTroopLanding(context);
  const horses = createTroopShipHorses(context);
  const { boardingSite, canBoard, pickupSite } = createTroopBoardingSites({ ...options, clearWater, targets });
  const channel = createChannelYield({ ...options, clearWater });
  const berthYield = createTroopShipBerthYield({ ...options, channel });
  const shipById = (id: number) =>
    Number.isSafeInteger(id) ? ships.find(ship => ship.id === id && !ship.visitor && !ship.gone) : undefined;
  /** A free ship takes the harbour berth for boarding; false while the berth is not available. */
  const beginAtHarbour = (ship: NavalShip, harbourUid: number) => {
    const berth = berthing.dock(harbourUid, ship);
    if (!berth || !berthing.routeToBerth(ship, berth, "positioning", harbourUid)) return false;
    ship.troopMission = { boarding: [], harbourUid, version: SHIP_TROOP_MISSION_VERSION };
    ship.sourceUid = harbourUid;
    ship.destinationUid = undefined;
    return true;
  };
  /** A free ship sails to fetch soldiers from a coast; false (the ship stays free) when it has no course there. */
  const beginAtCoast = (ship: NavalShip, anchor: AdventureLanding) => {
    ship.troopMission = { boarding: [], target: { kind: "coast", land: false, landing: anchor },
      version: SHIP_TROOP_MISSION_VERSION };
    ship.sourceUid = undefined;
    if (depart(ship)) return true;
    ship.troopMission = undefined;
    return false;
  };
  const begin = (ship: NavalShip, site: TroopBoardingSite) =>
    ("harbour" in site ? beginAtHarbour(ship, site.harbour.uid) : beginAtCoast(ship, site.anchor));
  /** A loaded ship waiting off a harbour comes back to its berth for the new soldiers. */
  const atBerthFor = (ship: NavalShip, site: TroopBoardingSite) => !("harbour" in site) ||
    ship.troopMission!.harbourUid === site.harbour.uid || berthYield.returnToBerth(ship, site.harbour.uid);
  /**
   * Field soldiers the full ship left behind wait near the boarding point (an attack-move, owner 2026-11-13); those
   * on another landmass have no way there and keep their place.
   */
  const waitAshore = (ids: readonly number[], site: TroopBoardingSite, mission: ShipTroopMission) => {
    const land = landmassAt(context.options.world, boardingPoint(site));
    const point = waitingPoint(context, site, mission.boarding.length);
    const field = ids.filter(uid => context.actors.some(actor => actor.uid === uid &&
      actor.phase === "militaryField" && landmassAt(context.options.world, actor) === land));
    if (field.length) context.military?.commandSoldiers?.(field, point, "attackMove");
  };
  /** Starts the boarding at `site`; a free ship whose harbour berth is not available fetches from the coast. */
  const startAt = (ship: NavalShip, site: TroopBoardingSite, ids: readonly number[]) => {
    if (ship.troopMission) return atBerthFor(ship, site) ? site : null;
    if (begin(ship, site)) return site;
    const coast = "harbour" in site ? pickupSite(ship, ids) : site;
    return "anchor" in coast && coast !== site && begin(ship, coast) ? coast : null;
  };
  const embark = (ids: readonly number[], shipId: number): TroopShipResult => {
    const ship = shipById(shipId);
    if (!ship) return refuse("No such ship");
    if (!Array.isArray(ids)) return refuse("No soldiers chosen");
    const planned = boardingSite(ship, ids);
    if ("reason" in planned) return refuse(planned.reason);
    const first = planTroopBoarding(context, ship, planned, ids);
    if (!first.boarding.length) return refuse(fullShipReason(context, first.waiting));
    const fresh = !ship.troopMission, site = startAt(ship, planned, ids);
    if (!site)
      return refuse("harbour" in planned ? "The harbour berth is busy" : "Ship cannot reach the soldiers' coast");
    const plan = site === planned ? first : planTroopBoarding(context, ship, site, ids);
    const accepted = "harbour" in site ? startHarbourBoarding(context, ship, site.harbour, plan.boarding, hooks)
      : startGangwayBoarding(context, ship, site.anchor, plan.boarding);
    if (!accepted.length) {
      if (fresh) options.releaseInPlace(ship);
      return refuse("No chosen soldier can reach the ship");
    }
    ship.troopMission!.linger = undefined;
    const waiting = [...plan.waiting, ...plan.boarding.filter(uid => !accepted.includes(uid))];
    waitAshore(waiting, site, ship.troopMission!);
    return { boarding: accepted, ok: true, waiting };
  };
  /** The ship sets off for its target (or is already there); false when no course exists yet. */
  const depart = (ship: NavalShip) => {
    const mission = ship.troopMission!, target = mission.target!;
    if (sameWater(ship, target)) { ship.phase = "sailing"; arrive(ship); return true; }
    if (target.kind === "harbour") {
      const berth = berthing.dock(target.uid, ship);
      if (!berth || !berthing.routeToBerth(ship, berth, "sailing", target.uid)) return false;
      ship.destinationUid = target.uid;
    } else {
      const anchorage = landingAnchorage(target.landing);
      berthing.makeWay(ship, anchorage, mission.waitingOff ?? berthYield.nearestHarbour(ship));
      if (!berthing.route(ship, anchorage, "sailing")) return false;
      ship.destinationUid = undefined;
    }
    Object.assign(mission, { anchor: undefined, glide: undefined, harbourUid: undefined, linger: undefined,
      waitingOff: undefined });
    Object.assign(ship, { anchorage: undefined, outside: undefined });
    return true;
  };
  const order = (shipId: number, destination: TroopShipDestination, disembark: boolean): TroopShipOrderResult => {
    const ship = shipById(shipId), mission = ship?.troopMission;
    if (!ship || !mission || (!ship.passengers?.length && !mission.boarding.length))
      return refuse("Only a ship carrying or boarding soldiers can sail");
    if (ship.phase === "unloading") return refuse("Soldiers are going ashore");
    const check = targets.resolve(ship, destination);
    if ("reason" in check) return refuse(check.reason);
    mission.target = check.kind === "harbour" ? { kind: "harbour", uid: check.uid, unload: disembark }
      : { kind: "coast", land: disembark, landing: check.landing };
    // Under way, or waiting outside a narrow channel: it sets off at once (in from the map edge).
    if (ship.phase === "sailing" || ship.phase === "stranded" || ship.outside?.left) depart(ship);
    return { kind: check.kind, ok: true };
  };
  /** At a harbour: the troops walk ashore into it, or the ship lies at the pier with them aboard. */
  const dockAt = (ship: NavalShip, uid: number, unload: boolean) => {
    ship.troopMission!.harbourUid = uid;
    if (unload && ship.passengers?.length) { ship.phase = "unloading"; ship.destinationUid = uid; return; }
    Object.assign(ship, { destinationUid: undefined, phase: "loading", sourceUid: uid });
  };
  /** Off a coast: the ship anchors with its gangway out; the troops land, or stay aboard. */
  const anchorAt = (ship: NavalShip, target: Extract<ShipTroopTarget, { kind: "coast" }>) => {
    const mission = ship.troopMission!;
    Object.assign(ship, { destinationUid: undefined, sourceUid: undefined, speed: 0, x: target.landing.water.x,
      yaw: target.landing.yaw, z: target.landing.water.z });
    mission.anchor = { ...target.landing, ashore: 0 };
    mission.landedFoot = 0;
    mission.landedRiders = 0;
    if (!target.land || !ship.passengers?.length) { ship.phase = "loading"; return; }
    ship.phase = "unloading";
    landing.start(ship, mission.anchor);
  };
  /** The route ended (the fleet's hook): boarding berth, harbour or anchorage reached. */
  const arrive = (ship: NavalShip) => {
    const mission = ship.troopMission;
    if (!mission) return false;
    Object.assign(ship, { anchorage: undefined, cursor: 0, route: [], timer: 0 });
    const target = ship.phase === "positioning" ? undefined : mission.target;
    if (!target) { ship.phase = "loading"; return true; }
    // Short of its anchorage pose (a stall, or the helm's last tiles): it eases onto it first, nobody aboard jumps.
    if (target.kind === "coast" && !liesAtAnchorage(ship, target.landing)) {
      Object.assign(ship, { phase: "sailing", speed: 0 });
      mission.glide = startAnchorGlide(ship);
      return true;
    }
    mission.target = undefined;
    if (target.kind === "harbour") dockAt(ship, target.uid, target.unload);
    else anchorAt(ship, target);
    return true;
  };
  /** A stranded troop ship plans its course again every second. */
  const retry = (ship: NavalShip, dt: number) => {
    ship.timer -= dt;
    if (ship.timer > 0) return;
    ship.timer = TROOP_SHIP_RETRY_SECONDS;
    const mission = ship.troopMission!;
    if (ship.retryPhase === "positioning" && mission.harbourUid !== undefined) {
      const berth = berthing.dock(mission.harbourUid, ship);
      if (berth) berthing.routeToBerth(ship, berth, "positioning", mission.harbourUid);
      return;
    }
    if (!mission.target) { Object.assign(ship, { anchorage: undefined, phase: "loading" }); return; }
    depart(ship);
  };
  const boardingTick = (ship: NavalShip) => {
    const mission = ship.troopMission!;
    if (mission.anchor) return advanceGangwayBoarding(context, ship, mission.anchor);
    const harbour = mission.harbourUid === undefined ? undefined : targets.ownHarbour(mission.harbourUid);
    if (harbour) return advanceHarbourBoarding(context, ship, harbour, hooks);
    mission.boarding = [];
    return allAboard(context, ship);
  };
  /** Boarding (or holding troops) at a pier or an anchorage; sets off once everyone is aboard. */
  const updateLoading = (ship: NavalShip, dt: number) => {
    const mission = ship.troopMission!;
    if (!boardingTick(ship)) return;
    if (mission.target) {
      ship.timer -= dt;
      if (ship.timer <= 0 && !depart(ship)) ship.timer = TROOP_SHIP_RETRY_SECONDS;
      return;
    }
    if (ship.passengers?.length) { berthYield.moveAside(ship, dt); return; }
    if (mission.waitingOff !== undefined) { options.releaseInPlace(ship); return; }
    if (!mission.anchor) { options.releaseAtHarbour(ship, mission.harbourUid ?? ship.sourceUid!); return; }
    mission.linger = (mission.linger ?? TROOP_SHIP_ANCHOR_LINGER_SECONDS) - dt;
    if (mission.linger <= 0) options.releaseInPlace(ship);
  };
  const updateUnloading = (ship: NavalShip) => {
    const mission = ship.troopMission!;
    if (mission.anchor) {
      if (!landing.settle(ship)) return;
      ship.phase = "loading";
      mission.linger = TROOP_SHIP_ANCHOR_LINGER_SECONDS;
      return;
    }
    if (hooks?.unloadPassengers?.(ship) ?? true) options.releaseAtHarbour(ship, ship.destinationUid!);
  };
  /**
   * Stopped just short of its coast anchorage (seed 123: a pickup by the map edge could not swing into the last
   * tiles of its pose): it eases onto the pose (`AnchorGlide`) instead of waiting there for ever.
   */
  const stalledOffAnchorage = (ship: NavalShip) => {
    const target = ship.troopMission!.target;
    if (target?.kind !== "coast" || (ship.speed ?? 0) > TROOP_ANCHORAGE_STALL_SPEED) return false;
    return DMath.hypot(ship.x - target.landing.water.x, ship.z - target.landing.water.z) <= TROOP_ANCHORAGE_SNAP;
  };
  /** One tick easing onto the coast anchorage pose; at the end the ship anchors there. */
  const glideOntoAnchorage = (ship: NavalShip, glide: AnchorGlide, dt: number) => {
    const target = ship.troopMission!.target;
    if (target?.kind !== "coast") { ship.troopMission!.glide = undefined; return; }
    if (!advanceAnchorGlide(ship, glide, target.landing, dt)) return;
    ship.troopMission!.glide = undefined;
    arrive(ship);
  };
  /** The fleet's per-ship hook: true when the mission handled this tick (not under way). */
  const update = (ship: NavalShip, dt: number) => {
    const mission = ship.troopMission;
    if (!mission) return false;
    pruneLostPassengers(context, ship);
    horses.update(ship, dt);
    if (ship.phase === "positioning") {
      const harbour = mission.harbourUid === undefined ? undefined : targets.ownHarbour(mission.harbourUid);
      if (harbour) collectHarbourArrivals(context, ship, harbour, hooks);
      return false;
    }
    if (ship.phase === "stranded") { retry(ship, dt); return true; }
    if (ship.phase === "sailing" && mission.glide) { glideOntoAnchorage(ship, mission.glide, dt); return true; }
    if (ship.phase === "sailing" && stalledOffAnchorage(ship)) { arrive(ship); return true; }
    if (ship.phase === "unloading") { updateUnloading(ship); return true; }
    if (ship.phase === "loading") { updateLoading(ship, dt); return true; }
    return false;
  };
  /** The anchored ship's gangway as a dock site: passengers walk up it, the renderer draws it. */
  const gangwayDock = (ship: NavalShip): ShipSiteFrame | null => {
    const anchor = ship.troopMission?.anchor;
    if (!anchor || (ship.phase !== "loading" && ship.phase !== "unloading")) return null;
    return { id: TROOP_GANGWAY_SITE_ID_OFFSET + ship.id, kind: "dock", progress: 1, workPier: anchor.gangway,
      x: ship.x, y: context.options.world.seaLevel, yaw: ship.yaw, z: ship.z };
  };
  /** One tick of a soldier walking off an anchored troop ship; false for anyone else. */
  const updateLander = (actor: SettlementActor, dt: number) => {
    if (!ADVENTURE_LANDING_PHASES.includes(actor.phase)) return false;
    const ship = ships.find(candidate => candidate.troopMission?.landers?.includes(actor.uid));
    return ship ? landing.updateActor(ship, actor, dt) : false;
  };
  return {
    arrive, boardingSite, canBoard, channel, depart, embark, gangwayDock, shipById, targets, update, updateLander,
    land: (shipId: number, point: TroopShipDestination) => order(shipId, point, true),
    sail: (shipId: number, destination: TroopShipDestination) => order(shipId, destination, false),
    capacityLeft: (ship: NavalShip) => troopShipCapacityLeft(context, ship),
    planBoarding: (ship: NavalShip, site: TroopBoardingSite, ids: readonly number[]) =>
      planTroopBoarding(context, ship, site, ids),
    sites: () => ships.flatMap(ship => gangwayDock(ship) ?? []),
    horseFrames: () => [...landing.horseFrames(ships), ...horses.frames(ships)],
    /** The commander's horse standing on `ship`'s deck, for its frame. */
    horseOnDeck: horses.onDeck,
    restore: () => landing.clear()
  };
};
