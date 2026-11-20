import { DOCK_PORTER_SPEED } from "./ship-cargo-handling";

/**
 * Harbour lighters (owner, 2026-10-20, NAV-03): rowing barges that load and unload a ship lying at its waiting
 * spot off a busy harbour, so more ships are worked at once while the berth ship uses the pier. A lighter rows
 * between the ship's side and a landing beside the pier's foot; there it hands its boxes to the harbour's
 * carriers, who carry them along the porters' route (on their own outer lanes) to the harbour door, and the
 * reverse when loading. The whole job follows from this plan and the seconds since it began (like the pier
 * porters' plan in ship-cargo-handling.ts), so a save only needs the plan and the ship's timer.
 */
export interface LighterPlan {
  /** Boxes the job moves (the ship's visible boxes). */
  boxes: number;
  /** Lighters working the ship (1 or 2). */
  lighters: number;
  /** Seconds one lighter rows between the landing and the ship's side, one way. */
  row: number;
  /** Seconds a carrier walks between the harbour door and the landing, one way. */
  walk: number;
  /** Carrier speed factor of the harbour (porter upgrades and talents); absent = 1. */
  speed?: number;
  /** Passengers ferried, a barge's seats full per trip and never with boxes (owner, 2026-10-21); absent = none. */
  passengers?: number;
  /** Seconds the whole job takes: the last box delivered and every lighter back and gone. */
  seconds: number;
}
/** Where one lighter is: `share` of the way from the landing (0) to the ship (1), its boxes and its fade. */
export interface LighterPlace {
  boxes: number; opacity: number; rowing: boolean; share: number;
  /** Passengers in the barge: seated (`climb` 0) or on the ship's ladder (`climb` up to 1 at the deck). */
  riders: { climb: number; passenger: number; seat: number }[];
}
/**
 * Where a ferried passenger is: in the harbour (`waiting` before it walks out, `ashore` after it walked in),
 * walking between the door (`share` 0) and the landing (1), standing at the landing, in the boat, or aboard.
 */
export interface PassengerPlace {
  /** The lighter (and so the landing and walking route) that ferries the passenger. */
  lighter: number;
  share: number;
  stage: "aboard" | "ashore" | "boat" | "landing" | "waiting" | "walk";
}
/** Where one carrier is: `share` of the way from the door (0) to the landing (1), and whether it carries. */
export interface CarrierPlace { carrying: boolean; outward: boolean; share: number }

/** Lighters a harbour can man at most (one per stored `boat` ware and landing place, owner 2026-10-20). */
export const MAX_HARBOUR_LIGHTERS = 4;
/** Lighter slots of a harbour (owner, 2026-10-20): each slot is manned only with a stored `boat` ware. */
const HARBOUR_LIGHTER_SLOTS = 2;
/** Lighters a harbour storing `boats` boats can man; none without boats (the pier porters work alone). */
export const harbourLighterCount = (boats: number) =>
  Math.max(0, Math.min(MAX_HARBOUR_LIGHTERS, HARBOUR_LIGHTER_SLOTS, boats));
/** Boxes a lighter carries per trip. */
export const LIGHTER_BOXES = 4;
/** Rowing speed (tiles per second). */
const LIGHTER_SPEED = 1.2;
/** Carriers at the landing per lighter. */
export const CARRIERS_PER_LIGHTER = 2;
/** Seconds a boatman lifts a box into the lighter or sets one down. */
const BOAT_HANDLE_SECONDS = .5;
/** Seconds a carrier lifts or sets down a box. */
const CARRIER_HANDLE_SECONDS = .35;
/** Seconds a lighter takes to appear (fade in) at the landing, and to disappear after its last trip. */
const LIGHTER_FADE_SECONDS = 1;
/** The second lighter sets off this much later, so the two never leave the landing side by side. */
const LIGHTER_STAGGER = 2;

interface Trip {
  boxes: number; lighter: number; depart: number; atShip: number; leaveShip: number; back: number;
  /** The passengers this trip ferries (then no boxes), by seat. */
  passengers?: number[];
}
/** A ferried passenger: its trip and seat, its climb at the ship's side and its walk door ↔ landing. */
interface Ferry { climbFrom: number; passenger: number; seat: number; trip: Trip; walkFrom: number; walkTo: number }
interface CarrierRound { box: number; carrier: number; start: number }
interface Timeline {
  /** Per box: when it is set down on (loading) or lifted off (unloading) the ship's deck. */
  shipTimes: number[];
  trips: Trip[];
  rounds: CarrierRound[];
  /** Per lighter: when its last trip is over and it fades away. */
  done: number[];
  ferries: Ferry[];
  seconds: number;
}

const carrierHandle = (plan: Pick<LighterPlan, "speed">) => CARRIER_HANDLE_SECONDS / (plan.speed ?? 1);
const carrierRound = (plan: Pick<LighterPlan, "speed" | "walk">) => 2 * plan.walk + 2 * carrierHandle(plan);
/** Trips of `boxes` boxes in turns between the lighters, four boxes each. */
const tripSizes = (boxes: number) => Array.from({ length: Math.ceil(boxes / LIGHTER_BOXES) },
  (_, trip) => Math.min(LIGHTER_BOXES, boxes - trip * LIGHTER_BOXES));
/** The one free soonest (index order on ties): the next lighter for a trip, the next carrier for a box. */
const soonest = (free: readonly number[], from = 0, count = free.length) => {
  let best = from;
  for (let index = from + 1; index < from + count; index++) if (free[index]! < free[best]!) best = index;
  return best;
};
/**
 * Passenger seats of a barge (owner, 2026-10-21), in barge tiles (bow +z): two side by side on the middle thwart,
 * between the oarsmen and clear of their oars' sweep; drawn on High and Minimal alike.
 */
export const LIGHTER_PASSENGER_SEATS: readonly { x: number; z: number }[] = [{ x: .2, z: .06 }, { x: -.2, z: .06 }];
/** Seconds a passenger climbs the ship's ladder, up or down. */
const CLIMB_SECONDS = 2.5;
/** Ferried passengers leave the harbour door this far apart. */
const PASSENGER_STAGGER = 1.5;
/** Passenger groups of one barge load each, in order. */
const ferryGroups = (plan: Omit<LighterPlan, "seconds">) => Array.from(
  { length: Math.ceil((plan.passengers ?? 0) / LIGHTER_PASSENGER_SEATS.length) }, (_, group) =>
    Array.from({ length: Math.min(LIGHTER_PASSENGER_SEATS.length,
      (plan.passengers ?? 0) - group * LIGHTER_PASSENGER_SEATS.length) },
    (_, seat) => group * LIGHTER_PASSENGER_SEATS.length + seat));
/** Loading: the passengers walk to the landing, a barge load at a time is rowed out and climbs aboard. */
const ferryOut = (plan: Omit<LighterPlan, "seconds">, lighterFree: number[]) => ferryGroups(plan).flatMap(group => {
  const lighter = soonest(lighterFree), walkTo = (passenger: number) => passenger * PASSENGER_STAGGER + plan.walk;
  const depart = Math.max(lighterFree[lighter]!, walkTo(group.at(-1)!)) + group.length * BOAT_HANDLE_SECONDS;
  const atShip = depart + plan.row, leaveShip = atShip + group.length * CLIMB_SECONDS, back = leaveShip + plan.row;
  const trip = { atShip, back, boxes: 0, depart, leaveShip, lighter, passengers: group };
  lighterFree[lighter] = back;
  return group.map((passenger, seat): Ferry => ({ climbFrom: atShip + seat * CLIMB_SECONDS, passenger, seat, trip,
    walkFrom: passenger * PASSENGER_STAGGER, walkTo: walkTo(passenger) }));
});
/** Unloading: after the boxes a barge load climbs down, is rowed in and walks to the door. */
const ferryIn = (plan: Omit<LighterPlan, "seconds">, lighterFree: number[]) => ferryGroups(plan).flatMap(group => {
  const lighter = soonest(lighterFree), depart = lighterFree[lighter]!, atShip = depart + plan.row;
  const leaveShip = atShip + group.length * CLIMB_SECONDS, back = leaveShip + plan.row;
  const trip = { atShip, back, boxes: 0, depart, leaveShip, lighter, passengers: group };
  lighterFree[lighter] = back + group.length * BOAT_HANDLE_SECONDS;
  return group.map((passenger, seat): Ferry => {
    const walkFrom = back + (seat + 1) * BOAT_HANDLE_SECONDS;
    return { climbFrom: atShip + seat * CLIMB_SECONDS, passenger, seat, trip, walkFrom, walkTo: walkFrom + plan.walk };
  });
});
/** A boat's second carrier sets off this much later (a tile in file), so the two never walk side by side. */
const CARRIER_STAGGER = .8;
const carrierStart = (carrier: number) => (carrier % CARRIERS_PER_LIGHTER) * CARRIER_STAGGER;
const carrierStarts = (plan: Pick<LighterPlan, "lighters">) =>
  Array.from({ length: plan.lighters * CARRIERS_PER_LIGHTER }, (_, carrier) => carrierStart(carrier));
const firstTrips = (plan: Omit<LighterPlan, "seconds">) =>
  Array.from({ length: plan.lighters }, (_, index) => LIGHTER_FADE_SECONDS + index * LIGHTER_STAGGER);
/** A box carried by one of the lighter's own two carriers, the one free soonest, starting no earlier than `from`. */
const carry = (plan: Omit<LighterPlan, "seconds">, free: number[], lighter: number, box: number, from: number) => {
  const carrier = soonest(free, lighter * CARRIERS_PER_LIGHTER, CARRIERS_PER_LIGHTER);
  const start = Math.max(free[carrier]!, from);
  free[carrier] = start + carrierRound(plan);
  return { box, carrier, start };
};

/** Unloading: lighters lift boxes at the ship, row them in and set them down; carriers take them to the door. */
const unloadingTimeline = (plan: Omit<LighterPlan, "seconds">): Timeline => {
  const lighterFree = firstTrips(plan);
  const free = carrierStarts(plan).map(start => start + plan.walk);
  const shipTimes: number[] = [], trips: Trip[] = [], rounds: CarrierRound[] = [];
  let box = 0;
  for (const size of tripSizes(plan.boxes)) {
    const lighter = soonest(lighterFree), depart = lighterFree[lighter]!, atShip = depart + plan.row;
    const leaveShip = atShip + size * BOAT_HANDLE_SECONDS, back = leaveShip + plan.row;
    trips.push({ atShip, back, boxes: size, depart, leaveShip, lighter });
    // Set down on the landing one after another; the boat's carrier free soonest carries each in.
    for (let load = 0; load < size; load++, box++) {
      shipTimes.push(atShip + (load + 1) * BOAT_HANDLE_SECONDS);
      rounds.push(carry(plan, free, lighter, box, back + (load + 1) * BOAT_HANDLE_SECONDS));
    }
    lighterFree[lighter] = back + size * BOAT_HANDLE_SECONDS;
  }
  const ferries = ferryIn(plan, lighterFree);
  trips.push(...ferries.map(ferry => ferry.trip));
  // A carrier's round from the landing: lift, walk in, set down at the door (the box is delivered), walk back.
  const delivered = rounds.map(round => round.start + 2 * carrierHandle(plan) + plan.walk);
  const seconds = Math.max(...lighterFree.map(time => time + LIGHTER_FADE_SECONDS), ...delivered,
    ...ferries.map(ferry => ferry.walkTo), 0);
  return { done: lighterFree, ferries, rounds, seconds, shipTimes, trips };
};

/** Loading: carriers bring boxes from the door to the landing; lighters row them out and set them on deck. */
const loadingTimeline = (plan: Omit<LighterPlan, "seconds">): Timeline => {
  const lighterFree = firstTrips(plan), free = carrierStarts(plan), ferries = ferryOut(plan, lighterFree);
  const shipTimes: number[] = [], trips: Trip[] = ferries.map(ferry => ferry.trip), rounds: CarrierRound[] = [];
  let box = 0;
  for (const size of tripSizes(plan.boxes)) {
    const lighter = soonest(lighterFree);
    let ready = lighterFree[lighter]!;
    for (let load = 0; load < size; load++) {
      const round = carry(plan, free, lighter, box + load, 0);
      rounds.push(round);
      ready = Math.max(ready, round.start + 2 * carrierHandle(plan) + plan.walk);
    }
    const depart = ready + size * BOAT_HANDLE_SECONDS, atShip = depart + plan.row;
    const leaveShip = atShip + size * BOAT_HANDLE_SECONDS, back = leaveShip + plan.row;
    trips.push({ atShip, back, boxes: size, depart, leaveShip, lighter });
    for (let load = 0; load < size; load++, box++) shipTimes.push(atShip + (load + 1) * BOAT_HANDLE_SECONDS);
    lighterFree[lighter] = back;
  }
  const seconds = Math.max(...lighterFree.map(time => time + LIGHTER_FADE_SECONDS), 0);
  return { done: lighterFree, ferries, rounds, seconds, shipTimes, trips };
};

const timelines = new WeakMap<LighterPlan, Timeline>();
/** The job's timeline, computed once per plan (at most a few dozen boxes). */
const timelineOf = (plan: LighterPlan, unloading: boolean) => {
  const known = timelines.get(plan);
  if (known) return known;
  const timeline = unloading ? unloadingTimeline(plan) : loadingTimeline(plan);
  timelines.set(plan, timeline);
  return timeline;
};

/** The lighter job for `boxes` boxes: `distance` tiles rowed and `route` tiles walked, one way. */
export const planLighters = (boxes: number, lighters: number, distance: number, route: number, unloading: boolean,
  speed = 1, passengers = 0): LighterPlan => {
  const faster = speed !== 1 ? { speed } : {}, ferried = passengers ? { passengers } : {};
  const base = { boxes, lighters, row: distance / LIGHTER_SPEED, walk: route / (DOCK_PORTER_SPEED * speed), ...faster,
    ...ferried };
  return { ...base, seconds: (unloading ? unloadingTimeline(base) : loadingTimeline(base)).seconds };
};

/** Boxes on the ship's deck `elapsed` seconds into the job. */
export const lighterDeckBoxes = (plan: LighterPlan, elapsed: number, unloading: boolean) => {
  const moved = timelineOf(plan, unloading).shipTimes.filter(time => time <= elapsed).length;
  return unloading ? plan.boxes - moved : moved;
};

/**
 * Boxes that have reached the harbour's storage (unloading: set down at the door by a carrier) or left it
 * (loading: lifted at the door) `elapsed` seconds into the job: the goods are credited or taken box by box.
 */
export const lighterStorageBoxes = (plan: LighterPlan, elapsed: number, unloading: boolean) => {
  const rounds = timelineOf(plan, unloading).rounds, delivery = unloading ? 2 * carrierHandle(plan) + plan.walk : 0;
  return rounds.filter(round => round.start + delivery <= elapsed).length;
};

/** Where lighter `lighter` is `elapsed` seconds into the job; null before it appears and after it is gone. */
export const lighterPlaceAt = (plan: LighterPlan, lighter: number, elapsed: number,
  unloading: boolean): LighterPlace | null => {
  const timeline = timelineOf(plan, unloading), appear = lighter * LIGHTER_STAGGER, gone = timeline.done[lighter]!;
  if (elapsed < appear || elapsed > gone + LIGHTER_FADE_SECONDS || gone <= appear + LIGHTER_FADE_SECONDS) return null;
  const opacity = Math.min(1, (elapsed - appear) / LIGHTER_FADE_SECONDS, (gone + LIGHTER_FADE_SECONDS - elapsed) /
    LIGHTER_FADE_SECONDS);
  const handled = (trip: Trip) => (trip.passengers?.length ?? trip.boxes) * BOAT_HANDLE_SECONDS;
  const trip = timeline.trips.find(each => each.lighter === lighter && elapsed < each.back +
    (unloading ? handled(each) : 0));
  if (!trip) return { boxes: 0, opacity, riders: [], rowing: false, share: 0 };
  const laden = unloading ? elapsed >= trip.leaveShip : elapsed < trip.leaveShip;
  const boxes = laden ? trip.boxes : 0, riders = ridersAt(timeline, trip, elapsed, unloading);
  if (elapsed < trip.depart) return { boxes: unloading ? 0 : trip.boxes, opacity, riders, rowing: false, share: 0 };
  if (elapsed < trip.atShip)
    return { boxes, opacity, riders, rowing: true, share: (elapsed - trip.depart) / plan.row };
  if (elapsed < trip.leaveShip) return { boxes, opacity, riders, rowing: false, share: 1 };
  if (elapsed < trip.back)
    return { boxes, opacity, riders, rowing: true, share: 1 - (elapsed - trip.leaveShip) / plan.row };
  return { boxes, opacity, riders, rowing: false, share: 0 };
};

/** Climb share (0 seated … 1 at the deck) of a ferried passenger, or null while it is not in the barge. */
const climbAt = (ferry: Ferry, elapsed: number, unloading: boolean) => {
  const share = Math.min(1, Math.max(0, (elapsed - ferry.climbFrom) / CLIMB_SECONDS));
  if (unloading) return elapsed < ferry.climbFrom || elapsed >= ferry.walkFrom ? null : 1 - share;
  // Loading: each steps in at the landing in turn before the barge sets off, and is aboard once up the ladder.
  const steppedIn = ferry.trip.depart - BOAT_HANDLE_SECONDS * (ferry.trip.passengers!.length - ferry.seat);
  return elapsed < steppedIn || share >= 1 ? null : share;
};
const ridersAt = (timeline: Timeline, trip: Trip, elapsed: number, unloading: boolean) => {
  if (!trip.passengers) return [];
  return timeline.ferries.filter(ferry => ferry.trip === trip).flatMap(ferry => {
    const climb = climbAt(ferry, elapsed, unloading);
    return climb === null ? [] : [{ climb, passenger: ferry.passenger, seat: ferry.seat }];
  });
};

/** Where ferried passenger `passenger` is `elapsed` seconds into the job. */
export const passengerPlaceAt = (plan: LighterPlan, passenger: number, elapsed: number,
  unloading: boolean): PassengerPlace => {
  const ferry = timelineOf(plan, unloading).ferries.find(each => each.passenger === passenger);
  if (!ferry) return { lighter: 0, share: 0, stage: unloading ? "aboard" : "waiting" };
  const { lighter } = ferry.trip;
  const walked = plan.walk ? Math.min(1, Math.max(0, (elapsed - ferry.walkFrom) / plan.walk)) : 1;
  if (unloading) {
    if (elapsed < ferry.climbFrom) return { lighter, share: 0, stage: "aboard" };
    if (elapsed < ferry.walkFrom) return { lighter, share: 1, stage: "boat" };
    if (elapsed < ferry.walkTo) return { lighter, share: 1 - walked, stage: "walk" };
    return { lighter, share: 0, stage: "ashore" };
  }
  if (elapsed < ferry.walkFrom) return { lighter, share: 0, stage: "waiting" };
  if (elapsed < ferry.walkTo) return { lighter, share: walked, stage: "walk" };
  if (climbAt(ferry, elapsed, false) !== null) return { lighter, share: 1, stage: "boat" };
  return { lighter, share: 1, stage: elapsed < ferry.trip.atShip ? "landing" : "aboard" };
};

/** Where carrier `carrier` is `elapsed` seconds into the job; null while it is not out of the harbour. */
export const carrierPlaceAt = (plan: LighterPlan, carrier: number, elapsed: number,
  unloading: boolean): CarrierPlace | null => {
  const rounds = timelineOf(plan, unloading).rounds.filter(round => round.carrier === carrier);
  const handle = carrierHandle(plan);
  const share = (walked: number) => plan.walk ? Math.min(1, Math.max(0, walked / plan.walk)) : 1;
  if (unloading) {
    // Out to the landing at the start, then each round from the landing: lift, walk in, set down, walk back.
    if (!rounds.length) return null;
    const out = carrierStart(carrier);
    if (elapsed < out) return null;
    if (elapsed < out + plan.walk) return { carrying: false, outward: true, share: share(elapsed - out) };
    const round = rounds.find(each => elapsed < each.start + 2 * handle + 2 * plan.walk);
    if (!round) return null;
    const into = elapsed - round.start;
    if (into < 0) return { carrying: false, outward: true, share: 1 };
    if (into < handle) return { carrying: true, outward: false, share: 1 };
    if (into < handle + plan.walk) return { carrying: true, outward: false, share: 1 - share(into - handle) };
    if (into < 2 * handle + plan.walk) return { carrying: true, outward: false, share: 0 };
    const last = round === rounds.at(-1);
    return last ? null : { carrying: false, outward: true, share: share(into - 2 * handle - plan.walk) };
  }
  const round = rounds.find(each => elapsed >= each.start && elapsed < each.start + carrierRound(plan));
  if (!round) return null;
  const into = elapsed - round.start;
  if (into < handle) return { carrying: true, outward: true, share: 0 };
  if (into < handle + plan.walk) return { carrying: true, outward: true, share: share(into - handle) };
  if (into < 2 * handle + plan.walk) return { carrying: true, outward: true, share: 1 };
  return { carrying: false, outward: false, share: 1 - share(into - 2 * handle - plan.walk) };
};

/** Exact existing cargo identity of a visible carrier round; never advances the job. */
export const lighterCarrierCargoIndex = (plan: LighterPlan, carrier: number, elapsed: number, unloading: boolean) => {
  const round = timelineOf(plan, unloading).rounds.find(each => each.carrier === carrier &&
    elapsed >= each.start && elapsed < each.start + carrierRound(plan));
  return round?.box;
};

/** Manifest slice currently on a lighter; passenger-only trips contain no cargo. */
export const lighterCargoIndices = (plan: LighterPlan, lighter: number, elapsed: number, unloading: boolean) => {
  const trips = timelineOf(plan, unloading).trips;
  const trip = trips.find(each => each.lighter === lighter && elapsed < each.back +
    (unloading ? (each.passengers?.length ?? each.boxes) * BOAT_HANDLE_SECONDS : 0));
  const place = lighterPlaceAt(plan, lighter, elapsed, unloading);
  if (!trip || !place?.boxes) return [];
  const first = trips.slice(0, trips.indexOf(trip)).reduce((sum, each) => sum + each.boxes, 0);
  return Array.from({ length: place.boxes }, (_, index) => first + index);
};
