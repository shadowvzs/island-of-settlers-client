import {
  SHIP_DECK, SHIP_DECK_HORSE_WORLD, SHIP_DECK_PERSON_WORLD, type ShipDeckSlot
} from "../../render-common/ships/ship-deck-layout";
import {
  deckPlacesWithHorses, type DeckShip, deckSlotPosition, holdDeckHorses, shipLocalPoint
} from "../../render-common/ships/ship-deck-people";
import { type DeckRect, deckWay, wayLength } from "../../render-common/ships/ship-deck-way";
import { SAILING_SHIP_SCALE } from "../../render-common/ships/ship-dimensions";
import type { ShipWorkpoint } from "./settlement-ship-workpoint";
import type { SettlementPoint } from "./settlement-types";

/** An anchored ship, its gangway and how many soldiers are already ashore. */
export interface AnchoredShip {
  ashore: number;
  gangway: ShipWorkpoint;
  water: SettlementPoint;
  yaw: number;
}
interface DeckSpot extends SettlementPoint { y: number }
/** A rider's horse standing on deck: its middle, its facing, and its place with its holder's (ship units). */
export interface DeckHorse extends DeckSpot {
  rect: DeckRect;
  yaw: number;
}
/**
 * Where a soldier stands and the walk to the gangway head (tiles; a rider's from his horse). A place kept
 * from the voyage also keeps the heading he stood with.
 */
export interface DeckPlace extends DeckSpot {
  horse?: DeckHorse;
  way: number;
  yaw?: number;
}
/** Where a passenger stood aboard when the landing began, and his horse when it stood on deck (world). */
export interface AboardPose extends DeckSpot {
  horse?: DeckSpot & { yaw: number };
  yaw: number;
}
/** Deck places in landing order: the foot soldiers', then the riders' with their horses. */
interface LandingDeckPlan {
  foot: DeckPlace[];
  riders: DeckPlace[];
}

const deckShip = (ship: AnchoredShip, seaLevel: number): DeckShip =>
  ({ ...ship.water, y: seaLevel, yaw: ship.yaw });

/** World height of the deck of a ship lying at `seaLevel`. */
export const deckHeight = (seaLevel: number) => seaLevel + SAILING_SHIP_SCALE * SHIP_DECK.floorY;

/**
 * The world walk from `from` on deck to the gangway head: round the hatch, the mast and the horses
 * still standing (`obstacles`), to the ship's side, onto the head.
 */
export const wayToGangway = (ship: AnchoredShip, seaLevel: number, from: SettlementPoint,
  obstacles: readonly DeckRect[] = []) => {
  const deck = deckShip(ship, seaLevel), { contact, point } = ship.gangway;
  const local = deckWay(shipLocalPoint(deck, from), shipLocalPoint(deck, contact), obstacles);
  const turns = local.slice(0, -1).map(turn => {
    const { x, z } = deckSlotPosition(deck, { ...turn, y: 0 });
    return { x, z };
  });
  return [...turns, { ...contact }, { ...point }];
};

const byWay = (a: DeckPlace, b: DeckPlace) => a.way - b.way;

/**
 * The anchored landing ship's deck (owner, 2026-10-15): horses where room allows (as many riders'
 * horses as fit while everyone keeps a place), each facing the end of the deck nearer the gangway with
 * its rider at its head; the foot soldiers on the other places. Each list nearest the gangway first.
 */
export const planLandingDeck = (ship: AnchoredShip, seaLevel: number, foot: number, riders: number) => {
  const deck = deckShip(ship, seaLevel), contact = shipLocalPoint(deck, ship.gangway.contact);
  const { horses, people } = deckPlacesWithHorses(foot + riders, riders);
  const free = [...people];
  // Others walk round the horse and the rider holding it.
  const held = holdDeckHorses(horses, free, slot => contact.z < slot.z ? -1 : 1);
  const obstacles = held.map(({ rect }) => rect);
  const place = (standing: ShipDeckSlot, start: ShipDeckSlot = standing): DeckPlace => {
    const from = deckSlotPosition(deck, start);
    return { ...deckSlotPosition(deck, standing), way: wayLength(from, wayToGangway(ship, seaLevel, from, obstacles)) };
  };
  const mounted = held.map(({ facing, rect, slot, standing }) => ({ ...place(standing, slot),
    horse: { ...deckSlotPosition(deck, slot), rect, yaw: ship.yaw + (facing < 0 ? Math.PI : 0) } }));
  const plan: LandingDeckPlan = { foot: free.map(slot => place(slot)).sort(byWay), riders: mounted.sort(byWay) };
  return plan;
};

/** A body of `size` (world units) standing on deck at `local` (ship units), as a deck rect. */
const bodyRect = (local: SettlementPoint, size: { depth: number; width: number }): DeckRect => {
  const halfX = size.width / 2 / SAILING_SHIP_SCALE, halfZ = size.depth / 2 / SAILING_SHIP_SCALE;
  return { maxX: local.x + halfX, maxZ: local.z + halfZ, minX: local.x - halfX, minZ: local.z - halfZ };
};

/** The horse with its holder at its head (others walk round both), from where they stand. */
const heldRect = (deck: DeckShip, horse: SettlementPoint, holder: SettlementPoint): DeckRect => {
  const body = bodyRect(shipLocalPoint(deck, horse), SHIP_DECK_HORSE_WORLD);
  const person = bodyRect(shipLocalPoint(deck, holder), SHIP_DECK_PERSON_WORLD);
  return { maxX: Math.max(body.maxX, person.maxX), maxZ: Math.max(body.maxZ, person.maxZ),
    minX: Math.min(body.minX, person.minX), minZ: Math.min(body.minZ, person.minZ) };
};

/** The deck's widest half beam (ship units, at midship). */
const DECK_HALF_BEAM = .42;

/** Whether `point` (world) lies on the deck of the anchored ship: a horse held there, not one left ashore. */
export const isOnDeck = (ship: AnchoredShip, seaLevel: number, point: SettlementPoint) => {
  const local = shipLocalPoint(deckShip(ship, seaLevel), point);
  return local.z >= SHIP_DECK.minZ && local.z <= SHIP_DECK.maxZ && Math.abs(local.x) <= DECK_HALF_BEAM;
};

/**
 * The landing deck of a ship whose passengers already stand aboard (troop ships, 2026-11-17): everyone keeps the
 * place and heading he had for the voyage, and a horse on deck stays where it stood, so nobody shifts or turns when
 * the landing begins. Keyed by actor uid.
 */
export const adoptLandingDeck = (ship: AnchoredShip, seaLevel: number, poses: ReadonlyMap<number, AboardPose>) => {
  const deck = deckShip(ship, seaLevel);
  const rects = new Map([...poses].flatMap(([uid, pose]) =>
    pose.horse ? [[uid, heldRect(deck, pose.horse, pose)] as const] : []));
  const obstacles = [...rects.values()];
  const places = new Map<number, DeckPlace>();
  for (const [uid, pose] of poses) {
    const { horse } = pose, from = horse ?? pose, rect = rects.get(uid);
    places.set(uid, { horse: horse && rect && { ...horse, rect }, way: wayLength(from,
      wayToGangway(ship, seaLevel, from, obstacles)), x: pose.x, y: pose.y, yaw: pose.yaw, z: pose.z });
  }
  return places;
};
