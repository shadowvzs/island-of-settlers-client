import { deckPeopleSlots, deckSlotPosition } from "../../render-common/ships/ship-deck-people";
import type { ShipSiteFrame } from "../../render-common/ships/ship-frame";
import { DMath } from "../math/deterministic-math";
import { createHarbourHelpers, harbourHelperSupply } from "./harbour-helper-supply";
import { isFreeOwnReserve, reserveReachesHarbour } from "./naval-passenger-eligibility";
import { canEnterDoor, entrancePath, exitPath } from "./settlement-entrance";
import type { NavalShip } from "./settlement-naval-fleet";
import { navalPassageRunSpeed } from "./settlement-naval-phases";
import { moveActor, setActorPath } from "./settlement-paths";
import { addIdleSettlers, retirePerson } from "./settlement-population";
import { advanceShipPier, walkShipDeck } from "./settlement-ship-workpoint";
import type {
  SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint
} from "./settlement-types";
import type { createTroopShipHorses } from "./ship-troop-horse";

interface PassengerBoarding {
  dockFor(ship: NavalShip): ShipSiteFrame | null;
  shipForActor(uid: number): NavalShip | undefined;
  /** A mounted commander boards through its own exterior route; ordinary harbour boarding skips it. */
  isCommander?: (uid: number) => boolean;
  /** A troop ship carrying the commander's horse: deck places, deck walks, the rider's file and his landing. */
  horses?: Pick<ReturnType<typeof createTroopShipHorses>, "deckPlace" | "deckWalk" | "landInField" | "leadsHorse">;
}
const BOARDING_PHASES = new Set(["navalToShip", "navalBoarding", "navalDeckWalk"]);
/** Landing at the destination harbour: down from the deck and the pier, then into the harbour. */
const LANDING_PHASES = new Set(["navalDisembark", "navalLanding", "navalLandingEnter"]);
/** Passengers the ship holds: boarding, aboard or going ashore. */
const SHIP_PHASES = new Set([...BOARDING_PHASES, "navalAboard", "navalFerry", ...LANDING_PHASES]);
/** People on the harbour → pier → deck passage at once, in file (owner, 2026-10-15). */
export const BOARDING_FILE = 2;
/** Tiles a follower keeps behind the one in front of it on the passage. */
const FOLLOWING_DISTANCE = 1.2;
/** Tiles a deck walker must be from the gangway head before the next one steps aboard. */
const DECK_CLEARANCE = .6;

const isClearOf = (people: readonly SettlementActor[], point: SettlementPoint, distance = FOLLOWING_DISTANCE) =>
  people.every(other => DMath.hypot(other.x - point.x, other.z - point.z) >= distance);

/** Embarked actors stay in the finite population and cannot be recruited while a voyage owns them. */
export const createNavalPassengers = (context: SettlementContext, boarding?: PassengerBoarding) => {
  const deckSlot = (ship: NavalShip, uid: number) =>
    deckPeopleSlots((ship.passengers?.length ?? 0) + (ship.troops?.length ?? 0))[ship.passengers?.indexOf(uid) ?? -1];
  /** Where `uid` stands aboard: its people place, or its place beside the horse sharing the deck. */
  const deckTarget = (ship: NavalShip, uid: number) => {
    const shared = boarding?.horses?.deckPlace(ship, uid);
    if (shared) return shared;
    const slot = deckSlot(ship, uid);
    return slot && { ...deckSlotPosition(ship, slot), yaw: ship.yaw };
  };
  const deckWalk = (ship: NavalShip, uid: number, from: SettlementPoint, to: SettlementPoint, aboard: boolean) =>
    boarding?.horses?.deckWalk(ship, uid, from, to, aboard) ?? [from, to];
  const leadsHorse = (ship: NavalShip, uid: number) => boarding?.horses?.leadsHorse(ship, uid) ?? false;
  const load = (ship: NavalShip) => {
    const ids = ship.passengers ?? [];
    if (!ids.length) return true;
    const dock = boarding?.dockFor(ship);
    const source = context.buildings.find(building => building.uid === ship.sourceUid);
    if (!dock?.workPier || !dock.porterRoute || !source) return false;
    const actors = ids.map(uid => context.actors.find(actor => actor.uid === uid));
    if (actors.some(actor => !actor)) return false;
    if (actors.every(actor => actor && (actor.phase === "navalAboard" || boarding?.isCommander?.(actor.uid))))
      return true;
    const waiting = actors.filter((actor): actor is SettlementActor => actor?.phase === "navalWaiting")
      .sort((a, b) => Number(context.military?.troopType?.(a.uid) === "cavalry") -
        Number(context.military?.troopType?.(b.uid) === "cavalry"));
    const actor = waiting.find(candidate => !boarding?.isCommander?.(candidate.uid));
    if (!actor || !deckTarget(ship, actor.uid)) return false;
    // Two at a time walk the passage from this harbour to its deck, in file and never on each other; a rider
    // leading his horse walks it alone.
    const onPassage = context.actors.filter(other => other.building === source.uid && BOARDING_PHASES.has(other.phase));
    if (onPassage.length >= BOARDING_FILE || !isClearOf(onPassage, source.doorThreshold) ||
      onPassage.some(other => leadsHorse(ship, other.uid))) return false;
    // The harbour passage and gangway remain physical, shared lanes rather than instant embarkation.
    if (context.actors.some(other => other.visible &&
      DMath.hypot(other.x - source.doorThreshold.x, other.z - source.doorThreshold.z) < .6)) return false;
    if (context.military?.troopType?.(actor.uid) === "cavalry" &&
      actors.some(other => other && context.military?.troopType?.(other.uid) !== "cavalry" &&
        other.phase !== "navalAboard")) return false;
    actor.home = source.uid;
    actor.building = source.uid;
    // Wait inside the harbour, then let the ordinary door exit reveal the walker. Setting visible
    // here popped passengers into existence at the doorway, already outside the building.
    Object.assign(actor, source.doorThreshold, { y: source.y, mounted: false, visible: false });
    setActorPath(actor, [...exitPath(source), ...dock.porterRoute], "navalToShip");
    return false;
  };
  const updateBoarding = (actor: SettlementActor, ship: NavalShip, dt: number) => {
    const target = deckTarget(ship, actor.uid);
    if (!target) return true;
    if (actor.phase === "navalAboard") {
      Object.assign(actor, target, { action: "idle", visible: ship.phase !== "away" });
      return true;
    }
    if (!BOARDING_PHASES.has(actor.phase)) return false;
    const dock = boarding?.dockFor(ship);
    if (!dock?.workPier) return true;
    if (actor.phase === "navalToShip") {
      if (moveActor(context, actor, dt)) {
        actor.phase = "navalBoarding";
        actor.path = []; actor.pathIndex = 0;
      }
      return true;
    }
    if (actor.phase === "navalBoarding") {
      const onDeck = context.actors.filter(other => other !== actor && other.navalOrder === actor.navalOrder &&
        other.phase === "navalDeckWalk");
      if (!isClearOf(onDeck, dock.workPier.contact, DECK_CLEARANCE)) return true;
      if (advanceShipPier(context, actor, dock.workPier, false, dt, navalPassageRunSpeed(actor)))
        setActorPath(actor, deckWalk(ship, actor.uid, dock.workPier.contact, target, true), "navalDeckWalk");
      return true;
    }
    if (walkShipDeck(actor, target.y, dt, navalPassageRunSpeed(actor))) {
      Object.assign(actor, target, { action: "idle", phase: "navalAboard" });
      actor.path = []; actor.pathIndex = 0;
    }
    return true;
  };
  /**
   * The ship lies at its destination's pier: passengers go ashore two at a time over the gangway and
   * the pier and walk into the harbour; true once every one of them is inside.
   */
  const unload = (ship: NavalShip) => {
    const destination = context.buildings.find(building => building.uid === ship.destinationUid);
    const actors = (ship.passengers ?? []).flatMap(uid => context.actors.filter(actor => actor.uid === uid &&
      actor.navalOrder !== undefined));
    if (!actors.length) return true;
    // Passengers who never came aboard (a voyage cancelled before boarding) are already ashore.
    const ashore = actors.filter(actor => !SHIP_PHASES.has(actor.phase));
    if (ashore.length && destination) release(ashore.map(actor => actor.uid), destination);
    const dock = boarding?.dockFor(ship);
    // Two at a time on the gangway and pier, in file; horses go last, as they came aboard.
    if (!destination || !dock?.workPier) return false;
    const goingAshore = actors.filter(actor => actor.phase === "navalDisembark");
    const onDeck = goingAshore.some(actor => actor.pathIndex < actor.path.length);
    if (goingAshore.length >= BOARDING_FILE || onDeck || !isClearOf(goingAshore, dock.workPier.contact)) return false;
    const cavalry = (actor: SettlementActor) => Number(context.military?.troopType?.(actor.uid) === "cavalry");
    const next = actors.filter(actor => actor.phase === "navalAboard").sort((a, b) => cavalry(a) - cavalry(b))[0];
    if (!next || (leadsHorse(ship, next.uid) && goingAshore.length)) return false;
    next.building = destination.uid;
    setActorPath(next, deckWalk(ship, next.uid, next, dock.workPier.contact, false).slice(1), "navalDisembark");
    return false;
  };
  /** One tick of a passenger going ashore: deck to the gangway, down the pier, then into the harbour. */
  const updateLanding = (actor: SettlementActor, ship: NavalShip, dt: number) => {
    const dock = boarding?.dockFor(ship);
    const destination = context.buildings.find(building => building.uid === ship.destinationUid);
    if (!dock?.workPier || !dock.porterRoute || !destination) return true;
    if (actor.phase === "navalLandingEnter") {
      if (moveActor(context, actor, dt)) release([actor.uid], destination);
      return true;
    }
    if (actor.phase === "navalLanding") {
      // The commander leading his horse gets on it once it is off the pier and stays in the field.
      if (boarding?.horses?.landInField(ship, actor, dock.workPier.shore)) return true;
      // The harbour door is a shared lane: the passenger waits for it like anyone else going in.
      if (moveActor(context, actor, dt) && canEnterDoor(context, actor, destination))
        setActorPath(actor, entrancePath(destination), "navalLandingEnter");
      return true;
    }
    const speed = navalPassageRunSpeed(actor);
    if (!walkShipDeck(actor, actor.y, dt, speed)) return true;
    if (!advanceShipPier(context, actor, dock.workPier, true, dt, speed)) return true;
    setActorPath(actor, [...dock.porterRoute].reverse(), "navalLanding");
    return true;
  };
  const reachesSource = (actor: SettlementActor, source: SettlementBuilding) =>
    reserveReachesHarbour(context, actor, source);
  const isFreeReserve = (actor: SettlementActor) => isFreeOwnReserve(context, actor);
  /** Sends the chosen actors to the harbour door; actors already stored there wait inside. */
  const dispatch = (source: SettlementBuilding, helpers: number, reserves: SettlementActor[]) => {
    const actors = [...createHarbourHelpers(context, source, helpers), ...reserves];
    for (const actor of actors) {
      actor.navalOrder = 0;
      if (actor.home === source.uid && !actor.visible) {
        actor.phase = "navalWaiting";
        continue;
      }
      const home = context.buildings.find((building) => building.uid === actor.home)!;
      const road = context.options.roads.route(home.access, source.access)!;
      actor.building = source.uid;
      setActorPath(actor, [...exitPath(home), ...road.points], "navalToHarbour");
    }
    return actors.map((actor) => actor.uid);
  };
  const reserve = (source: SettlementBuilding, helpers: number, soldiers: number) => {
    if (
      ![helpers, soldiers].every((count) => Number.isSafeInteger(count) && count >= 0) ||
      helpers + soldiers < 1 ||
      helpers + soldiers > 40 ||
      helpers > harbourHelperSupply(context, source)
    )
      return null;
    const reserves = context.actors.filter(
      (actor) =>
        isFreeReserve(actor) &&
        context.military?.troopType?.(actor.uid) !== "cavalry" &&
        reachesSource(actor, source)
    );
    if (reserves.length < soldiers) return null;
    return dispatch(source, helpers, reserves.slice(0, soldiers));
  };
  /** Colony crews: new settler helpers plus exact stored soldiers, cavalry included; all or nothing. */
  const reserveChosen = (source: SettlementBuilding, helpers: number, soldierIds: readonly number[]) => {
    if (!Number.isSafeInteger(helpers) || helpers < 0 || helpers > harbourHelperSupply(context, source))
      return null;
    const reserves = [...new Set(soldierIds)].map(uid => context.actors.find(actor => actor.uid === uid));
    if (reserves.some(actor => !actor || !isFreeReserve(actor) || !reachesSource(actor, source))) return null;
    return dispatch(source, helpers, reserves as SettlementActor[]);
  };
  const release = (ids: readonly number[], destination: SettlementBuilding) => {
    for (const uid of ids) {
      const actor = context.actors.find(candidate => candidate.uid === uid);
      if (!actor || actor.navalOrder === undefined) continue;
      if (actor.visible && ["navalToHarbour", "navalEnterHarbour"].includes(actor.phase)) {
        actor.navalOrder = -1;
        continue; // Finish the already physical harbour approach before releasing a cancelled reservation.
      }
      actor.home = destination.uid;
      actor.building = destination.uid;
      actor.x = destination.doorThreshold.x;
      actor.z = destination.doorThreshold.z;
      actor.y = destination.y;
      actor.visible = false;
      actor.action = "idle";
      actor.path = [];
      actor.pathIndex = 0;
      actor.navalOrder = undefined;
      if (actor.job === "Soldier") actor.phase = "militaryReserve";
      else {
        if (actor.job === "Scout" && actor.tool === "spyglass") { destination.inventory.spyglass = (destination.inventory.spyglass ?? 0) + 1; actor.tool = undefined; }
        if (actor.job === "Builder") actor.job = "Settler";
        retirePerson(context, actor);
        addIdleSettlers(context, destination);
      }
    }
  };
  const updateActor = (actor: SettlementActor, dt: number) => {
    if (actor.navalOrder === undefined) return false;
    const ship = boarding?.shipForActor(actor.uid);
    if (ship && LANDING_PHASES.has(actor.phase)) return updateLanding(actor, ship, dt);
    if (ship && updateBoarding(actor, ship, dt)) return true;
    const source = context.buildings.find((building) => building.uid === actor.building);
    if (!source || ["navalWaiting", "navalAboard"].includes(actor.phase)) return true;
    if (actor.phase === "navalToHarbour" && moveActor(context, actor, dt)) {
      if (canEnterDoor(context, actor, source))
        setActorPath(actor, entrancePath(source), "navalEnterHarbour");
    } else if (actor.phase === "navalEnterHarbour" && moveActor(context, actor, dt)) {
      actor.visible = false;
      actor.phase = "navalWaiting";
      actor.action = "idle";
      if (actor.navalOrder === -1) release([actor.uid], source);
    }
    return true;
  };
  return {
    load,
    unload,
    reserve,
    reserveChosen,
    /** One scout and one spyglass; the founding crew's three settlers are reserved separately. */
    reserveScouts: (source: SettlementBuilding) => {
      if ((source.inventory.spyglass ?? 0) < 1 || harbourHelperSupply(context, source) < 1) return null;
      const ids = reserve(source, 1, 0); if (!ids) return null;
      source.inventory.spyglass! -= 1;
      for (const uid of ids) { const actor = context.actors.find(candidate => candidate.uid === uid)!;
        actor.job = "Scout"; actor.tool = "spyglass"; }
      return ids;
    },
    release,
    updateActor,
    ready: (ids: readonly number[]) =>
      ids.every((uid) => {
        const actor = context.actors.find((entry) => entry.uid === uid);
        if (boarding?.isCommander?.(uid))
          return Boolean(actor && ["commanderMuster", "commanderWaiting", "commanderBoarding",
            "navalDeckWalk", "navalAboard"].includes(actor.phase));
        return Boolean(actor && ["navalWaiting", "navalAboard"].includes(actor.phase));
      }),
    embark: (ids: readonly number[]) =>
      ids.forEach((uid) => {
        if (boarding?.isCommander?.(uid)) return;
        const actor = context.actors.find((candidate) => candidate.uid === uid)!;
        actor.phase = "navalAboard";
        actor.visible = Boolean(boarding);
      })
  };
};
