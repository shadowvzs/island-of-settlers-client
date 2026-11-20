import { SHIP_DECK_HORSE_WORLD } from "../../render-common/ships/ship-deck-layout";
import { wayLength } from "../../render-common/ships/ship-deck-way";
import { DMath } from "../math/deterministic-math";
import {
  type AboardPose, adoptLandingDeck, type AnchoredShip, deckHeight, type DeckHorse, type DeckPlace, planLandingDeck,
  wayToGangway
} from "./settlement-landing-deck-plan";
import {
  ADVENTURE_ABOARD, ADVENTURE_BEACH, ADVENTURE_GANGWAY, ADVENTURE_SHIP_PHASES
} from "./settlement-landing-phases";
import { createLandingRiders } from "./settlement-landing-riders";
import { type ShipWorkpoint, walkShipDeck } from "./settlement-ship-workpoint";
import type { SettlementActor, SettlementContext, SettlementPoint } from "./settlement-types";

export * from "./settlement-landing-phases";
/** Soldiers leave the deck two at a time (owner, 2026-10-15): a pair walks in file this far apart (tiles). */
const PAIR_SPACING = .55;
/** The next pair keeps this far behind the one in front (tiles). */
const PAIR_GAP = .75;
/** A rider rides off over the deck and the gangway at a horse's walk (tiles per second). */
export const RIDING_PACE = 1.8;
/** Half a horse's length (tiles): a rider in the file needs this much more room before and behind. */
const HORSE_HALF_LENGTH = SHIP_DECK_HORSE_WORLD.depth / 2;

export type { AboardPose, AnchoredShip, DeckPlace } from "./settlement-landing-deck-plan";

/** Whether `actor` has set off for the shore (walking the deck or on the gangway). */
export const hasSetOff = (actor: SettlementActor) =>
  actor.phase === ADVENTURE_GANGWAY || actor.pathIndex < actor.path.length;

/** Tiles `actor` still walks to the foot of the gangway; one waiting below deck comes up at its head. */
const remainingWay = (ship: AnchoredShip, actor: SettlementActor, place?: DeckPlace) => {
  const { point, shore } = ship.gangway;
  if (actor.phase === ADVENTURE_GANGWAY) return DMath.hypot(actor.x - shore.x, actor.z - shore.z);
  const gangway = DMath.hypot(point.x - shore.x, point.z - shore.z);
  if (actor.pathIndex < actor.path.length) return wayLength(actor, actor.path.slice(actor.pathIndex)) + gangway;
  return (place?.way ?? 0) + gangway;
};

/**
 * Someone ahead in the file: where he is, his way left to the gangway foot (negative once past it),
 * whether a horse goes with him, and whether he is already ashore.
 */
export interface FileBody extends SettlementPoint {
  ashore: boolean;
  horse: boolean;
  remaining: number;
}
/** Who is walking off the anchored ship, and the room each needs in the file. */
interface LandingFile {
  /** Everyone else who has set off: on deck, on the gangway, or just off its foot. */
  bodies: (ship: AnchoredShip, actor: SettlementActor) => FileBody[];
  places: ReadonlyMap<number, DeckPlace>;
  /** Whether the soldier rides off (a rider with his horse). */
  rides: (actor: SettlementActor) => boolean;
}

/**
 * Two at a time, in file: whether `actor` may walk on this tick. Along the way it keeps a pair's spacing
 * behind its partner, or the gap behind the pair in front (half a horse more for each rider of the
 * two), and never comes closer than that in a straight line (where the deck walk turns onto the gangway).
 */
const keepsFile = (ship: AnchoredShip, actor: SettlementActor, file: LandingFile) => {
  const mine = remainingWay(ship, actor, file.places.get(actor.uid)), setOff = hasSetOff(actor);
  const own = file.rides(actor) ? HORSE_HALF_LENGTH : 0;
  let ahead = 0, nearest = -Infinity, room = 0;
  for (const body of file.bodies(ship, actor)) {
    // Whoever has set off is ahead of the next to go (one below deck comes up at the gangway head).
    if (setOff && body.remaining > mine) continue;
    const clearance = PAIR_SPACING + own + (body.horse ? HORSE_HALF_LENGTH : 0);
    if (DMath.hypot(body.x - actor.x, body.z - actor.z) < clearance) return false;
    if (!body.ashore) ahead++;
    if (body.remaining > nearest) { nearest = body.remaining; room = clearance - PAIR_SPACING; }
  }
  return mine >= nearest + room + ((ship.ashore + ahead) % 2 ? PAIR_SPACING : PAIR_GAP);
};

export const stepOnGangway = (actor: SettlementActor, gangway: ShipWorkpoint) => {
  Object.assign(actor, { phase: ADVENTURE_GANGWAY, visible: true, x: gangway.point.x, y: gangway.y,
    z: gangway.point.z });
};

const isAt = (actor: SettlementActor, point: SettlementPoint) =>
  DMath.hypot(actor.x - point.x, actor.z - point.z) < 1e-3;

/** Soldiers just off the gangway foot count in the file until this far from it (tiles). */
const BEACH_RANGE = 1.5;
/** ...riders (a horse is long) until this far. */
const RIDERS_BEACH_RANGE = 2.5;
const OFF_SHIP_PHASES = [ADVENTURE_BEACH, "militaryField", "militaryLeaving"];

/** Soldiers still to land by kind, and how many of each are already ashore. */
export interface LandingParty {
  /** Passengers already standing aboard keep these places (troop ships); otherwise the deck is planned. */
  aboard?: ReadonlyMap<number, AboardPose>;
  footAshore: number;
  /** Soldiers already ashore (those still near the gangway foot count in the file). */
  ashore: readonly SettlementActor[];
  /** Each rider's horse (its actor uid). */
  mounts: ReadonlyMap<number, number>;
  ordered: readonly SettlementActor[];
  ridersAshore: number;
}

/**
 * The soldiers aboard an anchored landing ship (owner, 2026-10-15): they stand at deck places, nearest
 * the gangway first in landing order, and walk ashore two at a time in file. Riders' horses stand on
 * deck where room allows, the rider at its head; at his turn he mounts and rides off. Other riders
 * (horse below deck) and soldiers beyond the deck's places come up at the gangway head.
 */
export const createLandingDeck = (context: SettlementContext, typeOf: (uid: number) => string | undefined) => {
  const places = new Map<number, DeckPlace>();
  const { seaLevel } = context.options.world;
  const riders = createLandingRiders(context);
  let landers: SettlementActor[] = [];
  /** Soldiers who have just left the gangway foot, still near it. */
  let beach: SettlementActor[] = [];
  const rides = (actor: SettlementActor) => typeOf(actor.uid) === "cavalry";
  const offShip = (ship: AnchoredShip, body: SettlementActor, horse: boolean): FileBody => ({ ashore: true, horse,
    remaining: -DMath.hypot(body.x - ship.gangway.shore.x, body.z - ship.gangway.shore.z), x: body.x, z: body.z });
  const bodies = (ship: AnchoredShip, actor: SettlementActor): FileBody[] => {
    const { shore } = ship.gangway, near = (body: SettlementActor, range: number) =>
      DMath.hypot(body.x - shore.x, body.z - shore.z) < range;
    beach = beach.filter(body => OFF_SHIP_PHASES.includes(body.phase) && near(body, body.mounted ? RIDERS_BEACH_RANGE : BEACH_RANGE));
    return [
      ...landers.filter(other => other !== actor && ADVENTURE_SHIP_PHASES.includes(other.phase) &&
        hasSetOff(other)).map(other => ({ ashore: false, horse: rides(other),
        remaining: remainingWay(ship, other, places.get(other.uid)), x: other.x, z: other.z })),
      ...beach.filter(body => body !== actor).map(body => offShip(ship, body, Boolean(body.mounted)))
    ];
  };
  const file: LandingFile = { bodies, places, rides };
  /** Places each soldier still landing; a plan for the whole party keeps restored places as they were. */
  const arrange = (ship: AnchoredShip, party: LandingParty) => {
    const { footAshore, ordered, ridersAshore } = party;
    landers = [...ordered];
    beach = [...party.ashore];
    places.clear();
    riders.arrange(ordered.filter(rides), party.mounts);
    if (party.aboard) {
      for (const [uid, place] of adoptLandingDeck(ship, seaLevel, party.aboard)) places.set(uid, place);
      return;
    }
    const foot = ordered.filter(actor => !rides(actor)), mounted = ordered.filter(rides);
    const plan = planLandingDeck(ship, seaLevel, footAshore + foot.length, ridersAshore + mounted.length);
    foot.forEach((actor, index) => {
      const place = plan.foot[footAshore + index];
      if (place) places.set(actor.uid, place);
    });
    mounted.forEach((actor, index) => {
      const place = plan.riders[ridersAshore + index];
      if (place) places.set(actor.uid, place);
    });
  };
  /** Standing at its place: a rider faces his horse's head (a kept place keeps its heading). */
  const standAt = (ship: AnchoredShip, actor: SettlementActor) => {
    const place = places.get(actor.uid);
    actor.action = "idle";
    if (!place) return;
    const facing = place.horse ? DMath.atan2(place.horse.x - place.x, place.horse.z - place.z) : ship.yaw;
    const yaw = place.yaw ?? facing;
    Object.assign(actor, { visible: true, x: place.x, y: place.y, yaw, z: place.z });
  };
  /**
   * The first soldier on deck sets off at once (his walk outlasts putting out the gangway); one below
   * deck waits its turn's seconds for the gangway; after the first nobody waits for it.
   */
  const gangwayReady = (ship: AnchoredShip, actor: SettlementActor, dt: number) => {
    if (places.has(actor.uid) || ship.ashore > 0 ||
      landers.some(other => ADVENTURE_SHIP_PHASES.includes(other.phase) && hasSetOff(other))) return true;
    actor.timer -= dt;
    return actor.timer <= 0;
  };
  /** Horses still standing at their deck places (their riders not mounted yet). */
  const standingHorses = () => landers.flatMap(actor => {
    const horse = places.get(actor.uid)?.horse;
    return horse && !actor.mounted && actor.phase === ADVENTURE_ABOARD ? [{ actor, horse }] : [];
  });
  const mount = (actor: SettlementActor, horse?: DeckHorse) => {
    actor.mounted = true;
    if (horse) Object.assign(actor, { x: horse.x, y: horse.y, yaw: horse.yaw, z: horse.z });
  };
  /** A rider gets on his horse (on deck, or below deck to ride up); the deck walk starts from there. */
  const setOff = (ship: AnchoredShip, actor: SettlementActor) => {
    const place = places.get(actor.uid);
    if (rides(actor)) mount(actor, place?.horse);
    if (!place || isAt(actor, ship.gangway.point)) return;
    const obstacles = standingHorses().map(({ horse }) => horse.rect);
    Object.assign(actor, { path: wayToGangway(ship, seaLevel, actor, obstacles), pathIndex: 0, visible: true });
  };
  /** One tick of a soldier aboard: `next` is its turn to set off; it steps onto the gangway at its head. */
  const update = (ship: AnchoredShip, actor: SettlementActor, next: boolean, dt: number) => {
    const started = hasSetOff(actor);
    if (!started && !(next && gangwayReady(ship, actor, dt))) return standAt(ship, actor);
    if (!keepsFile(ship, actor, file)) {
      if (started) actor.action = "idle";
      else standAt(ship, actor);
      return;
    }
    if (!started) setOff(ship, actor);
    const pace = actor.mounted ? RIDING_PACE : undefined;
    if (actor.pathIndex < actor.path.length && !walkShipDeck(actor, deckHeight(seaLevel), dt, pace)) return;
    Object.assign(actor, { path: [], pathIndex: 0 });
    stepOnGangway(actor, ship.gangway);
  };
  /** A soldier stepped off the gangway foot (a rider rides on). */
  const landed = (actor: SettlementActor) => { beach.push(actor); };
  return {
    arrange, carryHorse: riders.carry,
    /** Horses standing on deck. */
    horseFrames: () => riders.frames(standingHorses()),
    /** Whether a soldier on the gangway keeps his place in the file (a rider is faster than a man on foot). */
    keepsFile: (ship: AnchoredShip, actor: SettlementActor) => keepsFile(ship, actor, file),
    landed, stand: standAt, update
  };
};

