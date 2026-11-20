import { DMath } from "../../shared/math/deterministic-math";
import {
  layoutShipDeck, SHIP_DECK, SHIP_DECK_HORSE_WORLD, SHIP_DECK_PERSON_WORLD, type ShipDeckSlot
} from "./ship-deck-layout";
import type { DeckRect } from "./ship-deck-way";
import { SAILING_SHIP_SCALE } from "./ship-dimensions";

/** A point on the deck in ship units (x across, z along the keel). */
export interface DeckPoint { x: number; z: number }
/** A ship lying at `x`, `z`, its waterline at `y`, turned by `yaw`. */
export interface DeckShip extends DeckPoint { y: number; yaw: number }

/** People and horses standing on a deck. */
export interface DeckPlacesWithHorses {
  horses: readonly ShipDeckSlot[];
  people: readonly ShipDeckSlot[];
}

/** Places of the people on a ship's deck, per head count. */
const slotCache = new Map<number, readonly ShipDeckSlot[]>();
/** People and horse places per head count and riders aboard. */
const horseCache = new Map<string, DeckPlacesWithHorses>();

/** The open deck first, so boarding and going ashore stay visible outside the stern canopy. */
const openDeckFirst = (a: ShipDeckSlot, b: ShipDeckSlot) =>
  Number(a.bounds.minZ < SHIP_DECK.canopy.maxZ) - Number(b.bounds.minZ < SHIP_DECK.canopy.maxZ) ||
  Math.abs(a.z - .5) - Math.abs(b.z - .5) || a.x - b.x;

/**
 * Where `count` people stand on the deck, open deck first. Simulation passengers take the first
 * places, soldiers from another island (not actors here) the ones after them.
 */
export const deckPeopleSlots = (count: number): readonly ShipDeckSlot[] => {
  let slots = slotCache.get(count);
  if (slots) return slots;
  slots = layoutShipDeck(SHIP_DECK_PERSON_WORLD, count, 0).slots.sort(openDeckFirst);
  slotCache.set(count, slots);
  return slots;
};

/** A clear bow place for one scout watching the coast: the lookout used while observing. */
let lookoutSlot: ShipDeckSlot | undefined;
export const deckLookoutSlot = (): ShipDeckSlot => {
  lookoutSlot ??= layoutShipDeck(SHIP_DECK_PERSON_WORLD, Infinity, 0).slots
    .filter(slot => slot.kind === "passenger")
    .sort((a, b) => b.z - a.z || Math.abs(a.x) - Math.abs(b.x))[0]!;
  return lookoutSlot;
};

/** The most horses an empty deck takes. */
let deckHorseCapacity: number | undefined;

/**
 * Deck places for `people` aboard, `riders` of them with a horse (owner, 2026-10-15): as many horses
 * as fit while everyone aboard keeps a place (as many places as without horses). The same shared
 * layout on every nation's ship; riders whose horse finds no room keep it below deck.
 */
export const deckPlacesWithHorses = (people: number, riders: number, reserveHorseHolders = false): DeckPlacesWithHorses => {
  const key = `${people}:${riders}:${reserveHorseHolders}`;
  const cached = horseCache.get(key);
  if (cached) return cached;
  deckHorseCapacity ??= layoutShipDeck(SHIP_DECK_PERSON_WORLD, 0, 0, undefined, Infinity).horses;
  const places = deckPeopleSlots(people).length;
  let result: DeckPlacesWithHorses = { horses: [], people: deckPeopleSlots(people) };
  for (let horses = Math.min(riders, deckHorseCapacity); horses > 0; horses--) {
    const layout = layoutShipDeck(SHIP_DECK_PERSON_WORLD, people, 0, undefined, horses, reserveHorseHolders);
    if (layout.horses < horses || layout.passengers < places) continue;
    result = { horses: layout.slots.filter(slot => slot.kind === "horse"),
      people: layout.slots.filter(slot => slot.kind === "passenger").sort(openDeckFirst) };
    break;
  }
  horseCache.set(key, result);
  return result;
};

/**
 * Deck places on a ship bringing soldiers from another island (`people` aboard in all): the riders'
 * horses stand on deck only when nobody else is aboard (simulation passengers keep their places).
 */
export const troopShipDeckPlaces = (people: number, troops: readonly { type: string }[]): DeckPlacesWithHorses =>
  people === troops.length
    ? deckPlacesWithHorses(people, troops.filter(troop => troop.type === "cavalry").length, true)
    : { horses: [], people: deckPeopleSlots(people) };

/** A horse on deck, which way it faces along the keel (+1 bow, -1 stern) and its holder's place. */
export interface HeldDeckHorse {
  facing: number;
  /** The horse and its holder together (others walk round both). */
  rect: DeckRect;
  slot: ShipDeckSlot;
  standing: ShipDeckSlot;
}

const HORSE_HALF_DEPTH = SHIP_DECK_HORSE_WORLD.depth / 2 / SAILING_SHIP_SCALE;
const deckDistance = (a: DeckPoint, b: DeckPoint) => DMath.hypot(a.x - b.x, a.z - b.z);
const enclose = (a: DeckRect, b: DeckRect): DeckRect => ({ maxX: Math.max(a.maxX, b.maxX),
  maxZ: Math.max(a.maxZ, b.maxZ), minX: Math.min(a.minX, b.minX), minZ: Math.min(a.minZ, b.minZ) });

/** Takes the free people place nearest `point` out of `free`. */
const takeNearest = (free: ShipDeckSlot[], point: DeckPoint) => {
  const index = free.reduce((best, slot, candidate) =>
    deckDistance(slot, point) < deckDistance(free[best]!, point) ? candidate : best, 0);
  return free.splice(index, 1)[0];
};

/**
 * Each horse on deck with its rider at its head holding it (owner, 2026-10-15): the people place
 * nearest its head (taken out of `free`); `facingOf` picks the way it faces.
 */
export const holdDeckHorses = (horses: readonly ShipDeckSlot[], free: ShipDeckSlot[],
  facingOf: (horse: ShipDeckSlot) => number): HeldDeckHorse[] => horses.flatMap(slot => {
  const facing = facingOf(slot);
  const standing = takeNearest(free, { x: slot.x, z: slot.z + facing * HORSE_HALF_DEPTH });
  return standing ? [{ facing, rect: enclose(slot.bounds, standing.bounds), slot, standing }] : [];
});

/** World position of a deck place on a ship lying at `ship`. */
export const deckSlotPosition = (ship: DeckShip, slot: DeckPoint & { y: number }) => {
  const cosine = DMath.cos(ship.yaw), sine = DMath.sin(ship.yaw);
  return { x: ship.x + SAILING_SHIP_SCALE * (slot.x * cosine + slot.z * sine), y: ship.y + SAILING_SHIP_SCALE * slot.y,
    z: ship.z + SAILING_SHIP_SCALE * (slot.z * cosine - slot.x * sine) };
};

/** A world point in the deck's ship units (the inverse of `deckSlotPosition` on the deck plane). */
export const shipLocalPoint = (ship: DeckShip, point: DeckPoint): DeckPoint => {
  const cosine = DMath.cos(ship.yaw), sine = DMath.sin(ship.yaw);
  const dx = point.x - ship.x, dz = point.z - ship.z;
  return { x: (dx * cosine - dz * sine) / SAILING_SHIP_SCALE, z: (dx * sine + dz * cosine) / SAILING_SHIP_SCALE };
};
