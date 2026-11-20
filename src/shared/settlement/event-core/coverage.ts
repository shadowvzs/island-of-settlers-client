import type { EventCoreActorLane } from "../settlement-types";

export type { EventCoreActorLane } from "../settlement-types";

/** Actor timers the event core can own, mapped to the phase that makes them eligible. */
export const EVENT_CORE_LANE_PHASES: Readonly<Record<EventCoreActorLane, readonly string[]>> = {
  builderContact: ["construct"],
  fishing: ["fishCast", "fishWait", "fishReel"],
  foresterPlant: ["foresterPlant"],
  huntAim: ["huntAim"],
  huntFlight: ["huntFlight"],
  huntWait: ["huntWait"],
  work: ["work"]
};

/** Phases whose timer the event core does not own; all of them run on the fixed exact lane. */
const HANDLING_PHASES: ReadonlySet<string> = new Set([
  "boatInputPickup", "cartLoading", "cartUnloading", "inputPickup", "outputPutdown", "pickupTransfer",
  "pigFeedPutdown", "shipInputPickup", "wellBucketPickup"
]);

const CARRIER_PHASES: ReadonlySet<string> = new Set([
  "carrierLoadedBlocked", "carrierLoadedParking", "carrierPickupBlocked", "cartLoading", "cartRecover",
  "cartShuttleBack", "cartShuttleOut", "cartUnloading", "deliver", "deliveryStockWalk", "deliveryTransfer",
  "enterDelivery", "exitDelivery", "exitLoaded", "pickup", "pickupStockWalk", "returnBlockedCarrier"
]);

const COMBAT_PHASES: ReadonlySet<string> = new Set([
  "garrison", "hold", "march", "militaryDead", "militaryField", "militaryLeaving",
  "militaryMountedReturn", "militaryReserve", "militaryReturnBlocked", "militarySiege",
  "militaryTransferLeaving"
]);

const SHIP_PHASES: ReadonlySet<string> = new Set([
  "adventureAboard", "adventureBeach", "adventureGangway", "boatHomeBlocked", "boatInputPickup",
  "boatInputWalk", "boatReturnBlocked", "boatWork", "boatWorkshopBlocked", "boatWorkshopWalk",
  "navalAboard", "navalBoarding", "navalDeckWalk", "navalDisembark", "navalEnterHarbour",
  "navalLanding", "navalLandingEnter", "navalToHarbour", "navalToShip", "navalWaiting",
  "shipInputBlocked", "shipInputPickup", "shipInputWalk", "shipPierOut", "shipPierReturn",
  "shipReturnBlocked", "shipWork", "stranded"
]);

/**
 * Every phase the fixed actor chain currently recognizes. A new phase must be added here, or auto
 * event-core eligibility falls back (the conservative outcome), until its lane is reviewed.
 */
const KNOWN_ACTOR_PHASES: ReadonlySet<string> = new Set([
  ...HANDLING_PHASES, ...CARRIER_PHASES, ...COMBAT_PHASES, ...SHIP_PHASES,
  "arrived", "assigned", "away", "builderReturnBlocked", "builderWork", "construct", "deliver",
  "deliveryStockWalk", "deliveryTransfer", "demolitionBlocked", "deposit", "enterAssigned",
  "enterDelivery", "enterHome", "enterPickup", "enterRest", "enterRetire", "exitDelivery",
  "exitLoaded", "fishCast", "fishReel", "fishWait", "foresterPickup", "foresterPickupBlocked",
  "foresterPickupWalk", "foresterPlant", "foresterPlantBlocked", "foresterPlantWalk", "foresterReturn",
  "foresterReturnBlocked", "foresterReturnWalk", "home", "horseDead", "horseMounted",
  "huntAim", "huntChase", "huntCollect", "huntFlight", "huntWait", "idle", "inputApproach",
  "inputFetchBlocked", "inputPickup", "inputReturn", "inputReturnBlocked", "inside", "levelApproach",
  "levelExit", "levelTile", "levelWaiting", "loading", "march", "militaryDead", "militaryField",
  "militaryLeaving", "militaryMountedReturn", "militaryReserve", "militaryReturnBlocked",
  "militarySiege", "militaryTransferLeaving", "navalAboard", "navalBoarding", "navalDeckWalk",
  "navalDisembark", "navalEnterHarbour", "navalLanding", "navalLandingEnter", "navalToHarbour",
  "navalToShip", "navalWaiting", "outbound", "outputPutdown", "outputWalk", "pickup",
  "pickupStockWalk", "pickupTransfer", "pigFeedBlocked", "pigFeedPutdown", "pigFeedWalk", "rest",
  "retire", "retired", "returnBlocked", "returnBlockedCarrier", "returnWork", "settlerRelocate",
  "settlerRelocateEnter", "shipInputBlocked", "shipInputPickup", "shipInputWalk", "shipPierOut",
  "shipPierReturn", "shipReturnBlocked", "shipWork", "sowingBlocked",
  "stranded", "surveyReturnWait", "surveyWalk", "surveyWork",
  "upgradeAccessBlocked", "upgradeApproach", "upgradeAssigned", "upgradeConstruct",
  "waitTreeFall", "wellBucketBlocked", "wellBucketPickup", "wellBucketWalk", "wellOutputBlocked",
  "wellOutputWalk", "wellRestWalk", "wellWork", "wellWorkWalk", "work", "workerRestWait", "workSearchWait"
]);

interface CoverageActor {
  action?: string;
  delivery?: unknown;
  handcart?: unknown;
  job: string;
  path?: readonly unknown[];
  pathIndex?: number;
  phase: string;
  timer?: number;
  uid: number;
  wareTransfer?: unknown;
  workerHandlingPlan?: { status?: string };
}

interface CoverageField {
  id: number;
  state: string;
}

export interface CoverageSystems {
  adventure?: boolean;
  arrows?: number;
  authoredScenario?: boolean;
  colony?: boolean;
  militaryBuildings?: number;
  navalOrders?: number;
  npcTraders?: boolean;
  ships?: number;
  soldiers?: number;
  tavernBatches?: number;
  tradeDeliveries?: number;
  tradeEscrow?: number;
  tradeOffers?: number;
}

interface EventCoreOwnership {
  fields: ReadonlySet<number>;
  lanes: Partial<Record<EventCoreActorLane, ReadonlySet<number>>>;
  population: boolean;
  stone: boolean;
  tree: boolean;
}

export interface EventCoreCoverageInput {
  actors: readonly CoverageActor[];
  fields: readonly CoverageField[];
  /** The timer lanes currently masked by the fixed tick. */
  maskedLanes: ReadonlySet<EventCoreActorLane>;
  /** Actors the fixed tick is allowed to mask (base-rate workers; accelerated workers stay fixed). */
  eligible?: Partial<Record<EventCoreActorLane, ReadonlySet<number>>>;
  owned: EventCoreOwnership;
  systems?: CoverageSystems;
}

interface EventCoreFixedLane {
  actors: number;
  carriers: number;
  combat: number;
  handling: number;
  movingActors: number;
  ships: number;
  soldiers: number;
  timers: Record<string, number>;
  unsupportedPhases: string[];
  systems: CoverageSystems;
}

export interface EventCoreCoverage {
  covered: boolean;
  fixedLane: EventCoreFixedLane;
  owned: { fields: number; lanes: Partial<Record<EventCoreActorLane, number>>; population: boolean;
    stone: boolean; tree: boolean };
  reasons: string[];
}

const MATURING_FIELD_STATES: ReadonlySet<string> = new Set(["burning", "fruiting", "growing"]);

const laneOfPhase = (phase: string): EventCoreActorLane | undefined =>
  (Object.entries(EVENT_CORE_LANE_PHASES) as [EventCoreActorLane, readonly string[]][])
    .find(([, phases]) => phases.includes(phase))?.[0];

export const eventCoreLaneOfPhase = laneOfPhase;

/**
 * Preflight/user-visible coverage audit for the event core. It fails (auto falls back) only when a
 * fixed-tick mask would skip state the plan does not own, or when an actor is in a phase the fixed
 * chain does not recognize. Carriers, handling, ships, combat and expeditions are reported as
 * `fixedLane` because they remain exact on the fixed tick; they are not silently claimed.
 */
export const auditEventCoreCoverage = (input: EventCoreCoverageInput): EventCoreCoverage => {
  const reasons = new Set<string>();
  const timers: Record<string, number> = {};
  let carriers = 0, combat = 0, handling = 0, movingActors = 0;
  const unsupportedPhases = new Set<string>();
  for (const actor of input.actors) {
    if (actor.phase === "retired") continue;
    if (!KNOWN_ACTOR_PHASES.has(actor.phase)) unsupportedPhases.add(actor.phase);
    if (CARRIER_PHASES.has(actor.phase) || actor.job === "Carrier" || actor.delivery || actor.handcart) carriers++;
    if (COMBAT_PHASES.has(actor.phase) || actor.job === "Soldier") combat++;
    if (HANDLING_PHASES.has(actor.phase) || actor.wareTransfer ||
      actor.workerHandlingPlan?.status === "active") handling++;
    if ((actor.path?.length ?? 0) > (actor.pathIndex ?? 0)) movingActors++;
    if ((actor.timer ?? 0) > 0) timers[actor.phase] = (timers[actor.phase] ?? 0) + 1;
    const lane = laneOfPhase(actor.phase);
    if (lane && input.maskedLanes.has(lane) && input.eligible?.[lane]?.has(actor.uid) &&
      !input.owned.lanes[lane]?.has(actor.uid))
      reasons.add(`masked-phase-without-event:${lane}`);
  }
  for (const field of input.fields) {
    if (MATURING_FIELD_STATES.has(field.state) && !input.owned.fields.has(field.id))
      reasons.add("masked-field-without-event");
  }
  if (!input.owned.population) reasons.add("population-timer-without-owner");
  if (!input.owned.stone) reasons.add("stone-timer-without-owner");
  if (!input.owned.tree) reasons.add("tree-growth-without-owner");
  for (const phase of unsupportedPhases) reasons.add(`unknown-phase:${phase}`);
  const systems = input.systems ?? {};
  const lanes: Partial<Record<EventCoreActorLane, number>> = {};
  for (const [lane, uids] of Object.entries(input.owned.lanes) as [EventCoreActorLane, ReadonlySet<number>][])
    lanes[lane] = uids.size;
  const fixedLane: EventCoreFixedLane = {
    actors: input.actors.filter(actor => actor.phase !== "retired").length,
    carriers,
    combat,
    handling,
    movingActors,
    ships: systems.ships ?? 0,
    soldiers: systems.soldiers ?? 0,
    systems,
    timers,
    unsupportedPhases: [...unsupportedPhases].sort()
  };
  return {
    covered: reasons.size === 0,
    fixedLane,
    owned: {
      fields: input.owned.fields.size,
      lanes,
      population: input.owned.population,
      stone: input.owned.stone,
      tree: input.owned.tree
    },
    reasons: [...reasons].sort()
  };
};
