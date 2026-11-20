import {
  deckHorsePose, deckPassengerPose, type DeckPose, deckWalkAround, leadInWalk, troopDeckLayout
} from "../../render-common/ships/troop-deck-horse";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import {
  TROOP_HORSE_DECK_PACE, TROOP_HORSE_GROUND_PHASES as GROUND_PHASES, TROOP_HORSE_LEAD_DISTANCE,
  TROOP_HORSE_LEAD_MAX_SPEED, TROOP_HORSE_RIDER_PHASES, TROOP_HORSE_SETTLED as SETTLED, TROOP_HORSE_TURN_SPEED,
  TROOP_SHIP_STATIONARY_PHASES as STATIONARY_PHASES
} from "./constants";
import { NO_BUILDING } from "./settlement-home";
import type { TransportHorseFrame } from "./settlement-horses";
import type { NavalShip } from "./settlement-naval-fleet";
import { updatePersonTraffic } from "./settlement-person-index";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

const actorOf = (context: SettlementContext, uid: number | undefined) =>
  uid === undefined ? undefined : context.actors.find(actor => actor.uid === uid);
const mountOf = (context: SettlementContext, uid: number) => context.military?.soldierOf?.(uid)?.combat?.mount;

/**
 * Only the commander rides (HORSE-RETIREMENT-01): he brings his horse aboard a troop ship. Ordinary riders of old
 * saves board on foot and their horse stays ashore, as before.
 */
export const bringsHorseAboard = (context: SettlementContext, uid: number) =>
  (context.commander?.isCommanderActor(uid) ?? false) && mountOf(context, uid) !== undefined;

/** The passenger who leads (or holds on deck) his horse, its manifest index and the horse, if any. */
export const horseRiderOf = (context: SettlementContext, ship: NavalShip) => {
  const passengers = ship.passengers ?? [];
  if (!ship.troopMission || !passengers.length) return undefined;
  for (let index = 0; index < passengers.length; index++) {
    const uid = passengers[index]!;
    if (!bringsHorseAboard(context, uid)) continue;
    const rider = actorOf(context, uid), horse = actorOf(context, mountOf(context, uid));
    if (!rider || !horse || !TROOP_HORSE_RIDER_PHASES.includes(rider.phase)) return undefined;
    return { horse, index, rider };
  }
  return undefined;
};

/** The deck of `ship` as its passengers stand on it, the rider at `riderIndex` (-1: none) with his horse. */
const troopShipDeck = (ship: NavalShip, riderIndex: number) =>
  troopDeckLayout((ship.passengers?.length ?? 0) + (ship.troops?.length ?? 0), riderIndex);

/** Where passenger `uid` stands on a troop ship's deck: his people place, or his place beside the horse there. */
export const troopShipDeckPose = (context: SettlementContext, ship: NavalShip, uid: number) => {
  const index = ship.passengers?.indexOf(uid) ?? -1;
  if (index < 0) return undefined;
  const found = horseRiderOf(context, ship);
  return deckPassengerPose(ship, troopShipDeck(ship, found?.index ?? -1), index, found?.rider.uid === uid);
};

/**
 * The commander's horse standing still on deck stands exactly at its place for the hull as it lies now (it was
 * snapped there under way); one still walking or turning into its place keeps where it is.
 */
export const settleDeckHorse = (context: SettlementContext, ship: NavalShip) => {
  const found = horseRiderOf(context, ship);
  if (!found?.horse.visible || found.horse.action !== "idle") return;
  const place = troopShipDeck(ship, found.index).horse;
  if (place) Object.assign(found.horse, deckHorsePose(ship, place));
};

/**
 * The rider steps off the field to board: he gets down and his horse stands where it carried him, shown and held
 * by the halter, to be led after him up the pier or gangway.
 */
export const leadHorseAboard = (context: SettlementContext, rider: SettlementActor) => {
  const horse = actorOf(context, mountOf(context, rider.uid));
  rider.mounted = false;
  if (!horse) return;
  Object.assign(horse, { action: "idle", path: [], pathIndex: 0, visible: true, x: rider.x, y: rider.y,
    yaw: rider.yaw, z: rider.z });
  updatePersonTraffic(context, horse);
};

const turnToward = (from: number, to: number, step: number) => {
  const delta = DMath.atan2(DMath.sin(to - from), DMath.cos(to - from));
  return Math.abs(delta) <= step ? to : from + Math.sign(delta) * step;
};

/** One tick of the led horse: it keeps its lead's length behind its rider (never faster than a trot). */
const follow = (context: SettlementContext, horse: SettlementActor, rider: SettlementActor, dt: number) => {
  const dx = rider.x - horse.x, dz = rider.z - horse.z, distance = DMath.hypot(dx, dz);
  const step = Math.min(distance - TROOP_HORSE_LEAD_DISTANCE, TROOP_HORSE_LEAD_MAX_SPEED * dt);
  if (step <= SETTLED) { horse.action = "idle"; return; }
  const share = step / distance, { world } = context.options;
  horse.x += dx * share; horse.z += dz * share;
  horse.y = GROUND_PHASES.has(rider.phase) ? sampleSmooth(world, world.heights, horse.x, horse.z)
    : horse.y + (rider.y - horse.y) * share;
  Object.assign(horse, { action: "walk", yaw: DMath.atan2(dx, dz) });
  horse.animationTime += dt;
  updatePersonTraffic(context, horse);
};

/** One tick of the horse on deck: it walks into its place and turns to stand there (under way it stays put). */
const standOnDeck = (context: SettlementContext, horse: SettlementActor, pose: DeckPose, stationary: boolean,
  dt: number) => {
  const dx = pose.x - horse.x, dz = pose.z - horse.z, distance = DMath.hypot(dx, dz);
  if (!stationary) { Object.assign(horse, { action: "idle", x: pose.x, y: pose.y, yaw: pose.yaw, z: pose.z }); return; }
  if (distance > SETTLED) {
    const share = Math.min(1, TROOP_HORSE_DECK_PACE * dt / distance);
    Object.assign(horse, { action: "walk", x: horse.x + dx * share, y: pose.y, yaw: DMath.atan2(dx, dz),
      z: horse.z + dz * share });
    horse.animationTime += dt;
  } else {
    const yaw = turnToward(horse.yaw, pose.yaw, TROOP_HORSE_TURN_SPEED * dt);
    Object.assign(horse, { action: yaw === pose.yaw ? "idle" : "walk", x: pose.x, y: pose.y, yaw, z: pose.z });
  }
  updatePersonTraffic(context, horse);
};

/**
 * The commander's horse on a troop ship (2026-11-17): led up the pier or gangway behind him, standing at its deck
 * place for the voyage with him at its head, and led down again at a harbour (at a coast the landing deck takes
 * over and he rides it off). Its body is the ordinary saved horse actor; nothing else is kept.
 */
export const createTroopShipHorses = (context: SettlementContext) => {
  const poseOnDeck = (ship: NavalShip, riderIndex: number) => {
    const horse = troopShipDeck(ship, riderIndex).horse;
    return horse && deckHorsePose(ship, horse);
  };
  /** Where passenger `uid` stands aboard, when a horse shares the deck (undefined: the ordinary place). */
  const deckPlace = (ship: NavalShip, uid: number) => {
    const found = horseRiderOf(context, ship), index = ship.passengers?.indexOf(uid) ?? -1;
    if (!found || index < 0) return undefined;
    return deckPassengerPose(ship, troopShipDeck(ship, found.index), index, found.rider.uid === uid);
  };
  /** The deck walk of `uid` from `from` to `to`: round the horse, or (its rider) leading it into its place. */
  const deckWalk = (ship: NavalShip, uid: number, from: SettlementPoint, to: SettlementPoint, aboard: boolean) => {
    const found = horseRiderOf(context, ship), horse = found && troopShipDeck(ship, found.index).horse;
    if (!found || !horse) return [from, to];
    if (found.rider.uid !== uid) return deckWalkAround(ship, from, to, [horse.body]);
    return aboard ? leadInWalk(ship, horse, from, to) : deckWalkAround(ship, from, to, [horse.body]);
  };
  const update = (ship: NavalShip, dt: number) => {
    const found = horseRiderOf(context, ship);
    if (!found?.horse.visible) return;
    const { horse, rider } = found;
    if (rider.phase !== "navalAboard") { follow(context, horse, rider, dt); return; }
    const pose = poseOnDeck(ship, found.index);
    if (pose) standOnDeck(context, horse, pose, STATIONARY_PHASES.has(ship.phase), dt);
    else horse.visible = false;
  };
  /** The led horses and those standing on deck, held by their riders (under way: where the deck is now). */
  const frames = (ships: readonly NavalShip[]): TransportHorseFrame[] => ships.flatMap(ship => {
    // Beyond the map edge (outside a narrow channel) the ship and everyone aboard are out of sight.
    const found = ship.phase === "away" ? undefined : horseRiderOf(context, ship);
    if (!found?.horse.visible) return [];
    const { horse, rider } = found;
    const underWay = rider.phase === "navalAboard" && !STATIONARY_PHASES.has(ship.phase);
    const pose = (underWay && poseOnDeck(ship, found.index)) || { x: horse.x, y: horse.y, yaw: horse.yaw, z: horse.z };
    return [{ heading: pose.yaw, held: true, id: horse.uid, leader: rider.uid, moving: horse.action === "walk",
      visible: true, x: pose.x, y: pose.y, z: pose.z }];
  });
  /**
   * Landing at a harbour pier: once his horse is off the pier (he walks its lead's length and more inland) the
   * rider gets on it and stays in the field, as after a coast landing; he never goes into the harbour.
   */
  const landInField = (ship: NavalShip, rider: SettlementActor, shore: SettlementPoint) => {
    const found = horseRiderOf(context, ship);
    if (found?.rider !== rider) return false;
    const off = DMath.hypot(rider.x - shore.x, rider.z - shore.z) >= TROOP_HORSE_LEAD_DISTANCE + 1;
    if (!off && rider.pathIndex < rider.path.length) return false;
    const { horse } = found;
    Object.assign(rider, { action: "idle", building: NO_BUILDING, home: NO_BUILDING, mounted: true,
      navalOrder: undefined, path: [], pathIndex: 0, phase: "militaryField", visible: true, x: horse.x, y: horse.y,
      yaw: horse.yaw, z: horse.z });
    Object.assign(horse, { action: "idle", visible: false });
    context.military?.landFromShip?.(rider.uid);
    ship.passengers = (ship.passengers ?? []).filter(uid => uid !== rider.uid);
    ship.cargoCount--;
    updatePersonTraffic(context, rider); updatePersonTraffic(context, horse);
    return true;
  };
  /** The horse standing on deck with its rider at its head (for the drawn hull), if any. */
  const onDeck = (ship: NavalShip) => {
    const found = horseRiderOf(context, ship);
    if (!found?.horse.visible || found.rider.phase !== "navalAboard" || !troopShipDeck(ship, found.index).horse)
      return undefined;
    return { horse: found.horse.uid, rider: found.index };
  };
  return {
    deckPlace, deckWalk, frames, landInField, onDeck, update,
    /** The rider walks the passage alone with his horse (nobody else on the pier or gangway meanwhile). */
    leadsHorse: (ship: NavalShip, uid: number) => horseRiderOf(context, ship)?.rider.uid === uid
  };
};
