import {
  advanceLandingSoldier, ADVENTURE_ABOARD, ADVENTURE_BEACH, ADVENTURE_GANGWAY, ADVENTURE_LANDING_PHASES,
  ADVENTURE_SHIP_PHASES, type AdventureLanding, cavalryLastLandingOrder, createLandingQueue, gangwayTurn
} from "./settlement-adventure-landing";
import { NO_BUILDING } from "./settlement-home";
import { type AboardPose, createLandingDeck } from "./settlement-landing-deck";
import { adoptLandingDeck, isOnDeck } from "./settlement-landing-deck-plan";
import type { NavalShip } from "./settlement-naval-fleet";
import type { SettlementActor, SettlementContext } from "./settlement-types";
import { settleDeckHorse, troopShipDeckPose } from "./ship-troop-horse";

/** One anchored ship's landing file: its deck places and its gangway turns (rebuilt after a load). */
interface LandingParty {
  deck: ReturnType<typeof createLandingDeck>;
  queue: ReturnType<typeof createLandingQueue>;
}

const isCavalry = (context: SettlementContext, uid: number) => context.military?.troopType?.(uid) === "cavalry";

/** Riders' horses by rider (the hidden horse actors). */
const mountsOf = (context: SettlementContext, actors: readonly SettlementActor[]) => new Map(actors.flatMap(actor => {
  const mount = context.military?.soldierOf?.(actor.uid)?.combat?.mount;
  return mount === undefined ? [] : [[actor.uid, mount] as const];
}));

const poseOf = ({ x, y, yaw, z }: SettlementActor) => ({ x, y, yaw, z });

/**
 * Where the soldiers aboard stand, each with his horse when it stands on deck (a horse left ashore is not his
 * deck's). Soldiers standing aboard keep these places as the landing deck's, so the hand-over shifts nobody; the
 * places live in the saved actors, so a reload rebuilds the same deck.
 */
const aboardPoses = (context: SettlementContext, anchor: AdventureLanding, actors: readonly SettlementActor[],
  mounts: ReadonlyMap<number, number>) => {
  const { seaLevel } = context.options.world, poses = new Map<number, AboardPose>();
  for (const actor of actors) {
    if (!isOnDeck(anchor, seaLevel, actor)) continue;
    const horse = context.actors.find(entry => entry.uid === mounts.get(actor.uid));
    const held = horse && isOnDeck(anchor, seaLevel, horse) ? poseOf(horse) : undefined;
    poses.set(actor.uid, { ...poseOf(actor), horse: held });
  }
  return poses;
};

/**
 * The passengers stand exactly at their voyage places on the anchored hull (the drawn deck places), and the landing
 * order goes nearest the gangway first, foot soldiers before riders (uid breaks ties).
 */
const landingOrder = (context: SettlementContext, ship: NavalShip, anchor: AdventureLanding) => {
  settleDeckHorse(context, ship);
  const aboard = (ship.passengers ?? []).flatMap(uid => context.actors.find(actor => actor.uid === uid) ?? []);
  for (const actor of aboard) {
    const pose = troopShipDeckPose(context, ship, actor.uid);
    if (pose) Object.assign(actor, pose);
  }
  const places = adoptLandingDeck(anchor, context.options.world.seaLevel,
    aboardPoses(context, anchor, aboard, mountsOf(context, aboard)));
  const wayOf = (actor: SettlementActor) => places.get(actor.uid)?.way ?? Number.MAX_VALUE;
  const nearestFirst = [...aboard].sort((a, b) => wayOf(a) - wayOf(b) || a.uid - b.uid);
  return cavalryLastLandingOrder(nearestFirst, actor => context.military?.troopType?.(actor.uid));
};

/**
 * A passenger standing on deck becomes a battlefield soldier waiting for its gangway turn. A horse that stood on
 * deck for the voyage (the commander's) is the landing deck's to draw from now on, as for colony landings.
 */
const takeOffDeck = (context: SettlementContext, actor: SettlementActor, index: number, mount?: number) => {
  const horse = mount === undefined ? undefined : context.actors.find(entry => entry.uid === mount);
  if (horse) Object.assign(horse, { action: "idle", visible: false });
  context.military?.landFromShip?.(actor.uid);
  Object.assign(actor, { action: "idle", building: NO_BUILDING, home: NO_BUILDING, mounted: false,
    navalOrder: undefined,
    path: [], pathIndex: 0, phase: ADVENTURE_ABOARD, timer: gangwayTurn(index), visible: true });
};

/**
 * Troop ships landing at a coast (MIL-SHIPS-SIM): the anchored ship's soldiers cross the deck and walk down the
 * gangway two at a time and gather inland, with the adventure landing's deck, file and gathering rules.
 * Only the ships' saved missions hold state; each ship's deck file is rebuilt from them after a load.
 */
export const createShipTroopLanding = (context: SettlementContext) => {
  const parties = new Map<number, LandingParty>();
  const typeOf = (uid: number) => context.military?.troopType?.(uid);
  const actorOf = (uid: number) => context.actors.find(actor => actor.uid === uid);
  const party = (ship: NavalShip, anchor: AdventureLanding) => {
    const known = parties.get(ship.id);
    if (known) return known;
    const mission = ship.troopMission!;
    const landers = (mission.landers ?? []).flatMap(uid => actorOf(uid) ?? []);
    const ordered = landers.filter(actor => ADVENTURE_SHIP_PHASES.includes(actor.phase));
    const ashore = landers.filter(actor => !ADVENTURE_SHIP_PHASES.includes(actor.phase));
    const created: LandingParty = { deck: createLandingDeck(context, typeOf),
      queue: createLandingQueue(ordered, actor => typeOf(actor.uid)) };
    const mounts = mountsOf(context, ordered);
    created.deck.arrange(anchor, { aboard: aboardPoses(context, anchor, ordered, mounts), ashore,
      footAshore: mission.landedFoot ?? 0, mounts, ordered, ridersAshore: mission.landedRiders ?? 0 });
    parties.set(ship.id, created);
    return created;
  };
  /** The ship lies at its anchorage: every passenger aboard goes ashore over the gangway, foot soldiers first. */
  const start = (ship: NavalShip, anchor: AdventureLanding) => {
    const mission = ship.troopMission!;
    const ordered = landingOrder(context, ship, anchor);
    const mounts = mountsOf(context, ordered);
    ordered.forEach((actor, index) => takeOffDeck(context, actor, index, mounts.get(actor.uid)));
    ship.cargoCount -= ship.passengers?.length ?? 0;
    ship.passengers = [];
    mission.landers = ordered.map(actor => actor.uid);
    mission.landedFoot = 0;
    mission.landedRiders = 0;
    parties.delete(ship.id);
    const created = party(ship, anchor);
    for (const actor of ordered) created.deck.stand(anchor, actor);
  };
  /** The soldier stepped off the gangway foot: it gathers inland, the next one may follow. */
  const steppedOff = (ship: NavalShip, actor: SettlementActor, deck: LandingParty["deck"]) => {
    const mission = ship.troopMission!;
    deck.landed(actor);
    if (isCavalry(context, actor.uid)) mission.landedRiders = (mission.landedRiders ?? 0) + 1;
    else mission.landedFoot = (mission.landedFoot ?? 0) + 1;
  };
  /** One tick of a soldier landing from `ship`; false when it is not one of its landers. */
  const updateActor = (ship: NavalShip, actor: SettlementActor, dt: number) => {
    const anchor = ship.troopMission?.anchor;
    if (!anchor || !ADVENTURE_LANDING_PHASES.includes(actor.phase)) return false;
    const { deck, queue } = party(ship, anchor);
    deck.carryHorse(actor);
    if (actor.phase === ADVENTURE_ABOARD) {
      deck.update(anchor, actor, queue.next() === actor, dt);
      return true;
    }
    if (actor.phase === ADVENTURE_BEACH) {
      advanceLandingSoldier(context, anchor, actor, dt);
      return true;
    }
    if (!deck.keepsFile(anchor, actor)) {
      actor.action = "idle";
      return true;
    }
    const cavalryIndex = isCavalry(context, actor.uid) ? ship.troopMission!.landedRiders ?? 0 : undefined;
    advanceLandingSoldier(context, anchor, actor, dt, cavalryIndex);
    if (actor.phase !== ADVENTURE_GANGWAY) steppedOff(ship, actor, deck);
    return true;
  };
  /** Landers who are ashore and off the beach leave the mission; true once none is left. */
  const settle = (ship: NavalShip) => {
    const mission = ship.troopMission!;
    mission.landers = (mission.landers ?? []).filter(uid => {
      const actor = actorOf(uid);
      return Boolean(actor && ADVENTURE_LANDING_PHASES.includes(actor.phase));
    });
    if (mission.landers.length) return false;
    mission.landers = undefined;
    parties.delete(ship.id);
    return true;
  };
  /** Riders' horses standing on the anchored ships' decks. */
  const horseFrames = (ships: readonly NavalShip[]) => ships.flatMap(ship => {
    const anchor = ship.troopMission?.anchor;
    return anchor && ship.troopMission?.landers?.length ? party(ship, anchor).deck.horseFrames() : [];
  });
  return { clear: () => parties.clear(), horseFrames, settle, start, updateActor };
};
