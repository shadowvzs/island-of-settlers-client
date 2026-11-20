import { SHIP_DECK, type ShipDeckSlot } from "../../render-common/ships/ship-deck-layout";
import {
  deckSlotPosition, type HeldDeckHorse, holdDeckHorses, shipLocalPoint, troopShipDeckPlaces
} from "../../render-common/ships/ship-deck-people";
import { deckWay, wayLength } from "../../render-common/ships/ship-deck-way";
import { SAILING_SHIP_SCALE } from "../../render-common/ships/ship-dimensions";
import type { ShipDeckTroop, ShipFrame, ShipSiteFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import type { ShipWorkpoint } from "./settlement-ship-workpoint";
import type { SettlementPoint } from "./settlement-types";
import { TROOP_LANDING_SPEED, troopLandingStart } from "./ship-cargo-handling";

const FACING_BOW = () => 1;
export interface Spot extends SettlementPoint { y: number; yaw: number }
/** A soldier's start aboard: where he stands, where his way ashore begins, his horse if it is on deck. */
interface Aboard { horse?: Spot; place: Spot; start: Spot; slot?: ShipDeckSlot }

/** The way ashore: the soldier's start on deck, the gangway, down the pier and up to the harbour door. */
const wayAshore = (ship: ShipFrame, at: Aboard, aboard: readonly (Aboard | undefined)[], index: number,
  dock: ShipSiteFrame) => {
  const obstacles = aboard.slice(index + 1).flatMap(place => place?.slot ? [place.slot.bounds] : []);
  const turns = deckWay(shipLocalPoint(ship, at.start), shipLocalPoint(ship, dock.workPier!.contact), obstacles)
    .slice(0, -1).map(point => deckSlotPosition(ship, { ...point, y: SHIP_DECK.floorY }));
  return [at.start, ...turns, dock.workPier!.contact, dock.workPier!.point,
    dock.workPier!.shore, ...[...dock.porterRoute!].reverse()];
};

const spotOn = (ship: ShipFrame, slot: ShipDeckSlot, yaw = ship.yaw): Spot =>
  ({ ...deckSlotPosition(ship, slot), yaw });

/** A rider at his horse's head, facing it; his way ashore starts mounted from the horse's middle. */
const holding = (ship: ShipFrame, { facing, slot, standing }: HeldDeckHorse): Aboard => {
  const horse = spotOn(ship, slot, ship.yaw + (facing < 0 ? Math.PI : 0)), place = spotOn(ship, standing);
  return { horse, place: { ...place, yaw: DMath.atan2(horse.x - place.x, horse.z - place.z) }, start: horse };
};

/**
 * Where each soldier (landing order: foot soldiers, then riders) is aboard: the men on foot at their
 * deck places, riders whose horse stands on deck at its head; other riders wait below deck (no place)
 * and come up mounted at the gangway head.
 */
const aboardPlaces = (ship: ShipFrame, troops: readonly ShipDeckTroop[], foot: number,
  dock: ShipSiteFrame | undefined) => {
  const people = ship.deckPassengers ?? troops.length, places = troopShipDeckPlaces(people, troops);
  const free = places.people.slice(people - troops.length);
  const held = holdDeckHorses(places.horses, free, FACING_BOW).map(horse =>
    ({ ...holding(ship, horse), slot: horse.slot }));
  if (dock?.workPier) {
    const contact = shipLocalPoint(ship, dock.workPier.contact);
    free.sort((a, b) => DMath.hypot(a.x - contact.x, a.z - contact.z) -
      DMath.hypot(b.x - contact.x, b.z - contact.z));
  }
  const deckY = ship.y + SAILING_SHIP_SCALE * SHIP_DECK.floorY;
  const head = dock?.workPier && { ...dock.workPier.contact, y: deckY, yaw: ship.yaw };
  return troops.map((_, index): Aboard | undefined => {
    if (index < foot) {
      const slot = free[index];
      return slot ? { place: spotOn(ship, slot), slot, start: spotOn(ship, slot) } :
        head && { place: head, start: head };
    }
    return held[index - foot] ?? (head && { place: head, start: head });
  });
};


interface LandingPlan {
  aboard: readonly (Aboard | undefined)[];
  paths: readonly (readonly SettlementPoint[])[];
  starts: readonly number[];
  seconds: number;
  troops: readonly ShipDeckTroop[];
}
const plans = new WeakMap<readonly ShipDeckTroop[], Map<string, LandingPlan>>();

/** The fleet clock and its stand-ins share actual deck walks and one pier-entry schedule. */
export const planTroopShipLanding = (ship: ShipFrame,
  dock?: { workPier: ShipWorkpoint; porterRoute: readonly SettlementPoint[] }): LandingPlan => {
  const original = ship.deckTroops ?? [];
  const key = dock && `${ship.x}:${ship.y}:${ship.z}:${ship.yaw}:${ship.deckPassengers}:` +
    JSON.stringify([dock.workPier, dock.porterRoute]);
  const cache = plans.get(original);
  if (key && cache?.has(key)) return cache.get(key)!;
  const troops = [...original].sort((a, b) => Number(a.type === "cavalry") - Number(b.type === "cavalry"));
  const foot = troops.filter(troop => troop.type !== "cavalry").length;
  const site = dock as ShipSiteFrame | undefined;
  const aboard = aboardPlaces(ship, troops, foot, site);
  const paths = aboard.map((at, index) => at && site ? wayAshore(ship, at, aboard, index, site) : []);
  const deckWalks = paths.map(path => {
    const contact = dock ? path.indexOf(dock.workPier.contact) : -1;
    return contact < 0 ? 0 : wayLength(path[0]!, path.slice(1, contact + 1));
  });
  const starts: number[] = [];
  let arrival = -Infinity;
  for (let index = 0; index < troops.length; index++) {
    const gap = index >= foot ? 2.1 : 1.44;
    const start = Math.max(troopLandingStart(index, foot),
      arrival + gap / TROOP_LANDING_SPEED - deckWalks[index]! / TROOP_LANDING_SPEED);
    starts.push(start);
    arrival = start + deckWalks[index]! / TROOP_LANDING_SPEED;
  }
  const seconds = paths.reduce((maximum, path, index) => path.length ?
    Math.max(maximum, starts[index]! + wayLength(path[0]!, path.slice(1)) / TROOP_LANDING_SPEED) : maximum, 0);
  const result = { aboard, paths, seconds, starts, troops };
  if (key) {
    const entries = cache ?? new Map<string, LandingPlan>();
    if (entries.size >= 32) entries.delete(entries.keys().next().value!);
    entries.set(key, result); plans.set(original, entries);
  }
  return result;
};
