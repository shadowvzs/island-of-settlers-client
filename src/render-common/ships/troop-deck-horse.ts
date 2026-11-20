import { DMath } from "../../shared/math/deterministic-math";
import { SHIP_DECK_HORSE_WORLD, type ShipDeckSlot } from "./ship-deck-layout";
import {
  deckPeopleSlots, deckPlacesWithHorses, type DeckPoint, type DeckShip, deckSlotPosition, holdDeckHorses,
  shipLocalPoint
} from "./ship-deck-people";
import { type DeckRect, deckWay } from "./ship-deck-way";
import { SAILING_SHIP_SCALE } from "./ship-dimensions";

/** A world point on the deck plane. */
interface WorldPoint { x: number; z: number }
/** A place on a ship's deck in the world, and which way the one standing there faces. */
export interface DeckPose extends WorldPoint { y: number; yaw: number }

/** The commander's horse stands on deck facing the bow (+1 along the keel), as on colony troop ships. */
const HORSE_DECK_FACING = 1;

/** The horse on a troop ship's deck: its place, its facing along the keel (+1 bow) and its own body (ship units). */
interface DeckHorsePlace { body: DeckRect; facing: number; slot: ShipDeckSlot }

/** A troop ship's deck: each passenger's place by manifest index, the rider's at his horse's head. */
export interface TroopDeckLayout { horse?: DeckHorsePlace; places: readonly (ShipDeckSlot | undefined)[] }

const layouts = new Map<string, TroopDeckLayout>();

const horseLayout = (count: number, riderIndex: number): TroopDeckLayout => {
  // Its holder's place is kept beside the horse's head (as on colony troop ships), the others fill the rest.
  const { horses, people } = deckPlacesWithHorses(count, 1, true);
  const free = [...people];
  const held = holdDeckHorses(horses, free, () => HORSE_DECK_FACING)[0];
  // No room on deck for the horse (never with the deck places it takes): everyone keeps an ordinary place.
  if (!held) return { places: deckPeopleSlots(count) };
  const places: (ShipDeckSlot | undefined)[] = [];
  let next = 0;
  for (let index = 0; index < count; index++) places.push(index === riderIndex ? held.standing : free[next++]);
  return { horse: { body: held.slot.bounds, facing: held.facing, slot: held.slot }, places };
};

/**
 * The commander's horse on a troop ship's deck (2026-11-17), shared by the simulation (where he and his horse stand)
 * and the drawn hull (passenger poses). The deck of a troop ship with `count` people aboard (the shared layout of every hull style). With a rider at
 * `riderIndex` his horse stands on deck and he holds it at its head; otherwise the ordinary people places.
 */
export const troopDeckLayout = (count: number, riderIndex: number): TroopDeckLayout => {
  if (riderIndex < 0 || riderIndex >= count) return { places: deckPeopleSlots(count) };
  const key = `${count}:${riderIndex}`;
  let layout = layouts.get(key);
  if (!layout) { layout = horseLayout(count, riderIndex); layouts.set(key, layout); }
  return layout;
};

/** The horse's heading on deck relative to the keel (radians). */
export const deckHorseYaw = (horse: DeckHorsePlace) => (horse.facing < 0 ? Math.PI : 0);

/** The heading of passenger `index` relative to the keel: the rider faces his horse, the others the bow. */
export const deckPassengerYaw = (layout: TroopDeckLayout, index: number, rider: boolean) => {
  const slot = layout.places[index], horse = layout.horse?.slot;
  return rider && slot && horse ? DMath.atan2(horse.x - slot.x, horse.z - slot.z) : 0;
};

/** Where the horse stands on the ship lying at `ship`. */
export const deckHorsePose = (ship: DeckShip, horse: DeckHorsePlace): DeckPose =>
  ({ ...deckSlotPosition(ship, horse.slot), yaw: ship.yaw + deckHorseYaw(horse) });

/** Where passenger `index` stands on the ship lying at `ship`. */
export const deckPassengerPose = (ship: DeckShip, layout: TroopDeckLayout, index: number, rider: boolean) => {
  const slot = layout.places[index];
  return slot && { ...deckSlotPosition(ship, slot), yaw: ship.yaw + deckPassengerYaw(layout, index, rider) };
};

const toWorld = (ship: DeckShip, points: readonly DeckPoint[]) =>
  points.map(point => { const { x, z } = deckSlotPosition(ship, { ...point, y: 0 }); return { x, z }; });

/** The deck walk from `from` to `to` round the hatch, the mast and `obstacles` (world points, ending at `to`). */
export const deckWalkAround = (ship: DeckShip, from: WorldPoint, to: WorldPoint,
  obstacles: readonly DeckRect[]) => {
  const turns = deckWay(shipLocalPoint(ship, from), shipLocalPoint(ship, to), obstacles).slice(0, -1);
  return [{ x: from.x, z: from.z }, ...toWorld(ship, turns), { x: to.x, z: to.z }];
};

/**
 * The rider leads his horse in from the gangway head (`from`): round the hatch and the mast to the tail end of the
 * horse's place, then along it to his own place at its head, so the horse he leads walks into its place.
 */
export const leadInWalk = (ship: DeckShip, horse: DeckHorsePlace, from: WorldPoint, to: WorldPoint) => {
  const halfDepth = SHIP_DECK_HORSE_WORLD.depth / 2 / SAILING_SHIP_SCALE;
  const tail = { x: horse.slot.x, z: horse.slot.z - horse.facing * halfDepth };
  const turns = deckWay(shipLocalPoint(ship, from), tail).slice(0, -1);
  return [{ x: from.x, z: from.z }, ...toWorld(ship, [...turns, tail]), { x: to.x, z: to.z }];
};
