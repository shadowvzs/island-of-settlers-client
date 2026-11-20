import type { Goods } from "../../../../island-of-settlers-shared/src/goods";
import type { WellWorkFrame } from "../../render-common/buildings/well-work-cycle";
import type { SettlementTrade } from "../trade/settlement-trade";
import type { WorldData } from "../world/world-data";
import type { AuthoredScenarioProgress } from "./authored-scenario-progress";
import type { DifficultyLevel } from "./difficulty";
import type { EventCourtyard } from "./event-courtyard";
import type { DiscoveryCalendar } from "./island-discovery-policy";
import type { MilitaryDirectControl } from "./military-direct-control";
import type { CommanderSystem } from "./settlement-commander-state";
import type { SettlementFieldCycles } from "./settlement-field-cycles";
import type { createSettlementHorses } from "./settlement-horses";
import type { NavigationRecoveryState } from "./settlement-navigation-recovery";
import type { ReliefCollections, ReliefShipPort } from "./settlement-relief-collections";
import type { AuditedRandom, RandomAudit } from "./simulation-random";

export interface SettlementPoint { x: number; z: number }
export interface SettlementStockContact {
  presentation?: "hanging"; stock: SettlementPoint & {y:number}; approach: SettlementPoint & {y:number}; slot:number; ware:string; yaw?:number; scale?:number; scale3?:{x:number;y:number;z:number};
}
interface SettlementWareTransfer {
  presentation?: "hanging"; pour?: boolean; direction:"pickup"|"putdown"; ware:string; progress:number; target:SettlementPoint & {y:number}; yaw?:number; scale?:number; scale3?:{x:number;y:number;z:number};
}
export type { Goods };
export interface SettlementRoads {
  readonly revision?: number;
  replaceSegments?(segments: readonly import("./road-types").RoadSegment[]): boolean;
  raiseTiersWhere?(allowed: (segment: Readonly<import("./road-types").RoadSegment>) => boolean): number;
  route(from: SettlementPoint, to: SettlementPoint): {
    points: SettlementPoint[]; cost: number; length: number
  } | null;
  /** A04d: walked-length lower bounds towards `to`, finite exactly where `route(start, to)` exists. */
  lengthField?(to: SettlementPoint): import("./road-length-field").RoadLengthField | null;
  /** Length and cost only: storage selection sorts by these without copying route points. */
  routeMetrics?(from: SettlementPoint, to: SettlementPoint): import("./road-types").RoadRouteMetrics;
  /** Like route, but tells a proven dead end apart from an exhausted search budget. */
  searchRoute?(from: SettlementPoint, to: SettlementPoint): import("./road-types").RoadRouteSearch;
  routeStats?(): import("./road-types").RoadRouteStats;
  /** Binds the occupancy revision that `isBlocked` follows, enabling the route cache. */
  trackOccupancy?(revision: () => number, changes?: import("./road-types").OccupancyChanges): void;
  addRoad(start: SettlementPoint, end: SettlementPoint): unknown;
  /** `addRoad` of a dirt plan already made by `planRoad` (the economy AI reuses its checked plan). */
  addPlannedRoad?(plan: Pick<import("./road-types").RoadPlan, "points">): boolean;
  planRoad?(start: SettlementPoint, end: SettlementPoint): import("./road-types").RoadPlan | null;
  planUpgrade?(start: SettlementPoint, end: SettlementPoint, targetTier?: import("./road-types").RoadUpgradeTier,
    buildingFlags?: readonly SettlementPoint[]): import("./road-types").RoadPlan | null;
  inheritBuildingFlagTiers?(buildingFlags: readonly SettlementPoint[]): boolean;
  /** Existing public edges on the shortest road path between two road nodes (verge planting). */
  planStretch?(start: SettlementPoint, end: SettlementPoint): import("./road-types").RoadSegment[] | null;
  removeRoad?(start: SettlementPoint, end: SettlementPoint): boolean;
  upgradeRoad(start: SettlementPoint, end: SettlementPoint, pay: import("./road-types").RoadUpgradePayment,
    targetTier?: import("./road-types").RoadUpgradeTier, buildingFlags?: readonly SettlementPoint[]): unknown;
  segments?(): import("./road-types").RoadSegment[];
  speedAt?(point: SettlementPoint): number;
  /** Route over committed stone edges only (hand carts). */
  stoneRoute?(from: SettlementPoint, to: SettlementPoint): {
    points: SettlementPoint[]; cost: number; length: number
  } | null;
}
/** One cart load; the counters keep every item in exactly one place. */
export interface SettlementHandcartTrip {
  source: number;
  /** Undefined once the destination is lost: the cargo is salvaged into any storage. */
  destination?: number;
  ware: string;
  /** Items promised to the destination (its `incoming`) for this trip. */
  planned: number;
  /** Items already taken from the source onto the cart. */
  loaded: number;
  /** Items already handed to the destination or a salvage storage. */
  delivered: number;
  /** Storage-source items debited at dispatch that are not on the bed yet. */
  prepaid: number;
  /** Cart slots selected at dispatch (the ware/ talent capacity, not the partial load). */
  capacity?: number;
  /** Deterministic destination-claim lease, refreshed only by real trip progress. */
  leaseStartedTick?: number;
  leaseDeadlineTick?: number;
}
/** One delivery claim: source stock becomes hands at grip; the destination claim is incoming capacity. */
export interface SettlementDelivery {
  source: number;
  destination: number;
  ware: string;
  reserved?: boolean;
  sourceInput?: true;
  upgrade?: true;
  /** Deterministic destination-claim lease, refreshed only by real delivery progress. */
  leaseStartedTick?: number;
  leaseDeadlineTick?: number;
}
/**
 * A cart's reservation of one static lay-by. The bay id is the served flag/building uid; the point
 * identifies the physical bay so two flags that resolve to the same shoulder cannot double-book.
 */
export interface SettlementLayByClaim {
  /** Static bay identity: uid of the building whose lay-by search produced this bay. */
  bay: number;
  /** Bay centre and planned walk, saved with the reservation. */
  x: number;
  z: number;
  walk: number;
  /** Carrier actor that owns this reservation; no two active claims may share a bay. */
  actor: number;
  /** Deterministic bay lease, refreshed only by real trip progress. */
  leaseStartedTick?: number;
  leaseDeadlineTick?: number;
}
export interface SettlementHandcartBays {
  /** Bay beside the source flag, released when the loaded cart departs. */
  source?: SettlementLayByClaim;
  /** Bay beside the destination flag, reserved before arrival and released on completion. */
  destination?: SettlementLayByClaim;
}
/** A next-job preference only: no source stock or future cargo is paid before handover. */
export interface SettlementNextDelivery {
  source: number;
  destination: number;
  ware: string;
  units: number;
  mode: "carrier" | "handcart";
  capacity?: number;
  upgrade?: true;
  sourceInput?: true;
  transferId?: number;
  leaseStartedTick: number;
  leaseDeadlineTick: number;
}
/** Where a Fishery's skiff is while it is not in the yard (trip phases, FISHER-BOAT §3). */
export interface FisherBoatCustody {
  place: "afloat" | "carried" | "dropped" | "slot";
  /** Index into the Fishery's `boatSite.slots`. */
  slot: number;
  x: number;
  yaw: number;
  z: number;
}
export interface SettlementTransferOrder {
  id?: number;
  source: number;
  destination: number;
  ware: string;
  count: number;
}
export interface SettlementHandcart {
  /** Storage that owns the cart; it returns there. */
  owner: number;
  /** stored: still in the owner's cart shed; hitched: pulled; parked: standing on the ground. */
  state: "stored" | "hitched" | "parked";
  cargo: number;
  trip?: SettlementHandcartTrip;
  /** Saved lay-by occupancy of the active trip (also retained while the cart is parked). */
  bays?: SettlementHandcartBays;
  parked?: SettlementPoint & { yaw: number };
  /** Building a recovering carrier is walking one salvaged item to. */
  shuttleTarget?: number;
  /** Road revision (counted from the last load) the remaining route was last verified against. */
  roadRevision?: number;
}
/**
 * A cart whose crew was killed or fled (MIL-CREWS): it stands where it stopped until a free carrier of
 * a storage with room fetches it. `id` is the lost puller's uid (unique), so the drawn cart keeps its frame.
 */
export interface AbandonedHandcart extends SettlementPoint {
  id: number;
  /** Storage that owns the cart (it counts toward that storage's cart limit). */
  owner: number;
  yaw: number;
  /** Items left on the bed (absent when it was empty). */
  cargo?: number;
  ware?: string;
}
export interface SettlementBuilding {
  enemyCatapultVariant?: import("../world/scenario-catapult").HostileCatapultVariant;
  catapultSupply?: import("./military-catapult-resupply").CatapultSupply;
  /** Ammunition kind requested for new deliveries; absent = plain stone. */
  catapultAmmo?: import("./catapult-ammo-kinds").CatapultAmmoKind;
  /** Oldest-first rack kinds (reserved unit excluded); absent while all are plain stone. */
  catapultRackKinds?: import("./catapult-ammo-kinds").CatapultAmmoKind[];
  catapultCycle?: import("./catapult-cycle").CatapultCycle;
  catapultReload?: number;
  catapultAim?: number;
  /** First friendly occupation permanently claims this building's territory until destruction. */
  territoryClaimed?: boolean;
  uid: number; typeId: number; x: number; z: number; y: number; rotation: number;
  width: number; depth: number; access: SettlementPoint;
  workerApproach: SettlementPoint; doorThreshold: SettlementPoint; hasDoor: boolean;
  clearedProps?: Array<{index:number;type:number}>;
  militaryFaction?: number;
  /** Independent version-one neutral compound layout; absent on historical military buildings. */
  enemyCampEnclosure?: "building";
  eventCourtyard?: EventCourtyard;
  /**
   * A bandit site: its `bandit:` catalog code and layout. `typeId` is then the catalog-derived military building
   * whose garrison and wall rules the site borrows; absent on every other building.
   */
  bandit?: import("../../render-common/buildings/bandit-camp-plan").BanditSiteRef;
  construction: number; working: boolean; door: number; status: string;
  workTime?: number;
  idleSettlers?: number;
  /** Hand carts kept by a storage, or finished in a Sawmill yard and waiting for a carrier. */
  handcarts?: number;
  /** Sawmill: builds hand carts instead of planks. */
  handcartMode?: boolean;
  /** Fishery (FISHER-BOAT): fishes from a skiff with a net instead of the shore rod; absent = rod. */
  fisherMode?: "boat";
  /** Fishery: boat launch validation stored when boat mode was chosen; re-validated on a new work radius. */
  boatSite?: import("./boat-fishing-site").BoatFishingSite;
  /** Fishery: custody of its own skiff once it left the yard (`input.boat`), never both at once. */
  fisherBoat?: FisherBoatCustody;
  /** Residence (POP-02): seconds toward its next settler. */
  settlerGrowthTime?: number;
  foundedByExpedition?: boolean;
  /** The first founded harbour on a landmass where this player had no previous buildings: never demolishable. */
  foundingAnchor?: boolean;
  /** A colony's pre-built harbour: its home, like the headquarters on the home island. */
  colonyHome?: boolean;
  productionPaused?: boolean;
  /** Demand ranking: the tick since which this consumer has waited for each ware (owner 2026-11-09). */
  demandWaitSince?: Record<string, number>;
  /** Optional workshop shelves; construction and production remain independent. */
  workshopUpgrade?: { level: 0 | 1 | 2 | 3 | 4; requested?: true; cancelling?: true; progress?: number;
    builder?: number; reserved?: Goods; incoming?: Goods };
  pigFeedPhase?: "grain" | "water" | "breeding" | "idle";
  exports?: Record<string, boolean>;
  wellBucketTaken?: boolean;
  nurserySeedlingTaken?: boolean;
  foundationProgress?: number;
  foundationTileIndex?: number;
  foundationTileWork?: number;
  /** Hidden builder site holding one planned bridge group until its road tiles may be committed. */
  bridgeSite?: import("./bridge-construction").BridgeConstructionSite;
  /** Hidden builder site of one player-ordered roadside verge stretch. */
  vergeSite?: import("./road-verge-planting").RoadVergeSite;
  constructionConsumed?: Goods;
  /**
   * A harbour's wares of own transport orders still in its storage, reserved so carriers cannot take them:
   * each box leaves it as it is carried aboard (owner, 2026-10-20).
   */
  shipReserve?: Goods;
  /** Stable identity of the shared stock pool for this completed access point. */
  storagePoolId?: number;
  input: Goods; output: Goods; inventory: Goods; incoming: Goods; required: Goods;
  productionOrders?: import("./armory-orders").ProductionOrders;
  worker?: number; selectedOutput?: string; accepts: Record<string, boolean>; selected: boolean; cycle: number;
}
/** Hidden road work shell (bridge span, upgrade or verge stretch): never an ordinary building. */
export const isRoadWorkShell = (building: Pick<SettlementBuilding, "bridgeSite" | "vergeSite">) =>
  building.bridgeSite !== undefined || building.vergeSite !== undefined;
interface WorkerHandlingPlan {
  direction: "pickup" | "putdown";
  expectedEndTick: number;
  phase: string;
  startedTick: number;
  status: "active" | "released";
  ware: string;
}

/** Delivery-backed trip: the real stock source, destination and cargo the plan moves. */
export interface WorkerMovementManifest {
  source: number;
  destination: number;
  ware: string;
  units: number;
  /** Fleet chosen by the departure decision that created this trip. */
  fleet?: "handcart" | "cartless";
  /** Selected fleet capacity (cart slots or the cartless single unit). */
  capacity?: number;
}

/**
 * Which ends of a delivery the carrier has actually committed: the source after pickup/grip, the
 * destination when the delivery assigned its incoming capacity.
 */
export interface WorkerMovementClaims {
  source: boolean;
  destination: boolean;
  /** Snapshot of the destination incoming-claim lease, when one is active. */
  leaseStartedTick?: number;
  leaseDeadlineTick?: number;
}

export interface WorkerMovementPlan {
  phase: string;
  pathLength: number;
  revision: string;
  startedTick: number;
  expectedArriveTick: number;
  lastSafePoint: SettlementPoint;
  target: SettlementPoint;
  status: "planned" | "moving" | "blocked" | "arrived" | "invalidated";
  /** Cargo ownership captured when the plan was made. */
  ware?: string | null;
  wareUnits?: number;
  /** Present only for a plan made while the actor has an active delivery. */
  manifest?: WorkerMovementManifest;
  claims?: WorkerMovementClaims;
}

export interface SettlementActor extends SettlementPoint {
  mounted?: boolean;
  navigationRecovery?: NavigationRecoveryState;
  /**
   * A removed bridge cut this road journey: the actor stands where it is (cargo, delivery and
   * phase kept) until a road route to `destination` exists again, then resumes.
   */
  bridgeWait?: { destination: SettlementPoint };
  navigationReturnCargo?: boolean;
  workerMovementPlan?: WorkerMovementPlan;
  workerHandlingPlan?: WorkerHandlingPlan;
  uid: number; y: number; yaw: number; visible: boolean; job: string;
  catapultOperator?: { phase: import("./catapult-cycle").CatapultPhase; progress: number; stoneDiameter: number; carryPoint?: {x:number;y:number;z:number}; handWeight?: number; reverseWalk?: boolean; walking?: boolean; hands?: readonly [readonly [number, number, number], readonly [number, number, number]] };
  action: "idle" | "walk" | "carry" | "work" | "chop" | "plant" | "fish_cast" | "fish_wait" | "fish_reel";
  /** Actual simulation movement speed; render frames must not divide fixed steps by render delta. */
  locomotionSpeed?: number;
  /** A carrier pulling (or recovering) a hand cart owns it until the cart is stored again. */
  handcart?: SettlementHandcart;
  ware: string | null; tool?: string; phase: string; building: number; home: number;
  /** One physical Catapult stone remains the same visible cargo through evacuation to storage. */
  catapultStoneCargo?: true;
  /** Authored hostile civilian ownership survives the loss of its workplace. */
  hostileCivilianFaction?: number;
  catapultEvacuation?: import("./catapult-worker-evacuation").CatapultWorkerEvacuation;
  demolitionReturning?: boolean;
  demolitionCargo?: Goods;
  /** The ruin uid this person clears (BD2 clearing job: out to it, clearing, salvage home); absent otherwise. */
  ruinClearing?: number;
  /** EAI2d: the walls this person of a computer economy repairs (out with the paid load, working, home). */
  wallRepair?: import("./settlement-wall-repair").WallRepairJob;
  treeFellingStarted?: boolean;
  navalOrder?: number;
  boatWork?: number;
  /** Fishery boat trip (FISHER-BOAT L4): the launch slot and net point it rows to. */
  boatTrip?: { net: number; slot: number; yard?: boolean };
  fieldWork?: "sow" | "harvest";
  sowingBatch?: ResourceTarget[];
  wellWork?: WellWorkFrame;
  foresterSeedling?: { target: SettlementPoint & { y: number }; scale: number; progress?: number; planting?: number };
  wareTransfer?: SettlementWareTransfer;
  stockContact?: SettlementStockContact;
  stockBuilding?: number;
  storageArrivalOrder?: number;
  storageArrivalBuilding?: number;
  wareScale?: {x:number;y:number;z:number};
  /** Units of `ware` in the box a carrier walks with (trade wares move as boxes, owner 2026-10-21); absent = 1. */
  wareUnits?: number;
  /** Forward body tilt (radians) of a garrison stand-in leaning out of a window; render only. */
  lean?: number;
  /** Sill top above the feet (world units) of a window soldier resting his forearms on it; render only. */
  windowSillRise?: number;
  /** Seconds a hunter's chase follows its route before re-planning (saved, so a reload re-plans alike). */
  huntReplan?: number;
  /** Current hunting arrow, persisted so reload cannot duplicate a hit. */
  huntArrow?: { origin: SettlementPoint & { y: number }; target: SettlementPoint & { y: number }; duration: number };
  productionOutput?: string;
  productionSeconds?: number;
  productionInputs?: string[];
  preparedTarget?: ResourceTarget;
  productionPath?: SettlementPoint[];
  afterInputPhase?: string;
  queueTarget?: SettlementPoint; queueWait?: number;
  /** Why the unit walks to its queueTarget; absent means a reactive yield (pauses on arrival). */
  queueKind?: TrafficQueueKind;
  /**
   * SIM-CADENCE: game-clock tick before which a failed proactive shoulder search is not repeated
   * (saved, so a reload retries on the same tick).
   */
  shoulderRetryTick?: number;
  path: SettlementPoint[]; pathIndex: number; timer: number; target?: ResourceTarget;
  delivery?: SettlementDelivery;
  /** Separate from the current delivery/cart cargo; committed only after its unload completes. */
  nextDelivery?: SettlementNextDelivery;
  animationTime: number; consumed?: Goods;
}
/**
 * proactive: anticipated sidestep; stationary: pushed off a road; anchor-return: walking back after it;
 * doorstep: stepping off a door lane for a hidden unit (no return); court-slot: walking to a stock
 * court waiting slot.
 */
export type TrafficQueueKind = "anchor-return" | "court-slot" | "doorstep" | "proactive" | "stationary";
export interface ResourceTarget extends SettlementPoint {
  y?: number;
  /** Hardwood nurseries plant a known broadleaf species, including while replaying offline. */
  treeSpecies?: "broadleafTree" | "hardwoodTree" | "cedarTree" | "walnutTree" | "mahoganyTree";
  approach?: SettlementPoint & { shoreEntry?: SettlementPoint; waterY?: number };
  id: number; kind: "tree" | "stone" | "fish" | "wildlife" | "carcass" | "field" | "plant";
}
/** Actor timers the event core can advance without taking over movement or handling. */
export type EventCoreActorLane =
  | "builderContact" | "fishing" | "foresterPlant" | "huntAim" | "huntFlight" | "huntWait" | "work";

/** Phase A ownership split: true means the event core advances that timer, the fixed tick skips it. */
interface TickSystemMask {
  /** Door openness animation is presentation-only and may be skipped in headless/offline replay. */
  doorActivity?: boolean;
  /** Non-builder animation clocks are presentation-only; builder contact clocks remain live. */
  animationTime?: boolean;
  /** Fisher cast/wait/reel timers are advanced by the event plan. */
  fishing?: boolean | (() => boolean);
  /** Generic production `work` timers are advanced by the event plan. */
  productionWork?: boolean | (() => boolean);
  /** Forester planting timer is advanced by the event plan. */
  foresterPlant?: boolean | (() => boolean);
  /** Hunter arrow-flight timer is advanced by the event plan. */
  huntFlight?: boolean | (() => boolean);
  /** Hunter aim-release timer is advanced by the event plan; chase remains fixed-tick. */
  huntAim?: boolean | (() => boolean);
  /** Hunter approach wait timer is advanced by the event plan; chase/collect movement stays fixed-tick. */
  huntWait?: boolean | (() => boolean);
  /** Builder hammer-contact cadence is advanced by the event plan; movement/sides stay fixed-tick. */
  builderContacts?: boolean | (() => boolean);
  /** Field growth (`fieldCycles.update`) is advanced by the event plan. */
  fieldGrowth?: boolean | (() => boolean);
  /** Population growth at each scheduler fire is advanced by the event plan. */
  populationGrowth?: boolean | (() => boolean);
  /** Stone respawn at each scheduler fire is advanced by the event plan. */
  stoneRespawns?: boolean | (() => boolean);
  /** Tree growth (`onTickStart`) is advanced by the event plan. */
  treeGrowth?: boolean | (() => boolean);
}

/** Resolve an event-core mask; a function lets an `auto` replay disable it after the audit. */
export const tickSystemMasked = (value: boolean | (() => boolean) | undefined) =>
  typeof value === "function" ? value() : value === true;

export interface SettlementOptions {
  /** Private personal-item authority: provided by guest progress or the verified server wallet transaction. */
  roadDecorationCustody?: import("./settlement-road-decorations").RoadDecorationCustodyPort;
  /** MIL-SHIPS-SIM boarding, exposed to the Shift queue without making the military module own naval state. */
  embarkMilitary?: (ids: readonly number[], shipId: number) => import("./ship-troop-missions").TroopShipResult;
  /** Prototype only: masks the pure timers the event core owns. Absent keeps every system fixed-tick. */
  tickMask?: TickSystemMask;
  /** Opt-in: serialize worker corridors through explicit reservations (offline/tests). */
  corridorReservations?: boolean;
  /** Opt-in experimental: skip quiet corridor ticks through the movement executor. */
  eventMovement?: boolean;
  /**
   * Experimental selector for the opt-in movement-skip guard (`movementSkip` must also be set).
   * Absent/`prototype` keeps the original whole-route/per-tick guard; `segmented` selects the D6
   * cheaper bounded revalidation/per-actor segmentation candidate. Never changes the save.
   */
  movementSkipGuard?: "prototype" | "segmented";
  /** Notified when a masked worker phase starts, so the event plan can schedule its boundary. */
  onWorkerPhase?: (actor: import("./settlement-types").SettlementActor) => void;
  /**
   * Whether the event plan owns an actor's masked timer right now. The fixed tick refuses to skip a
   * masked phase unless this returns true, so a missed notification can only fall back to exact
   * fixed ticks; it can never freeze an actor.
   */
  eventCoreOwns?: (actor: import("./settlement-types").SettlementActor, lane: EventCoreActorLane) => boolean;
  /** The masked scheduler phase, called at the exact fixed-tick position the normal update would run. */
  onSchedulerPhase?: (phase: "population" | "stone", dt: number) => void;
  /** Invalid authored maps can be opened for repair without instantiating their entities. */
  scenarioDraft?: boolean;
  onScenarioOutcome?: (status: "won" | "expired", coins: number) => void;
  /** Campaign maps (C9a): the map was won or lost (once, at the deciding tick; never on a restore). */
  onCampaignOutcome?: (outcome: Readonly<import("../campaign/campaign-map-outcome").CampaignOutcomeRecord>) => void;
  /** Campaign maps (C9b): the map's built-in victory rule, resolved by `campaignStartOptions`; fresh starts only. */
  campaignVictory?: import("../campaign/campaign-victory").CampaignVictoryCheck;
  playerNation?: import("../../render-common/workers/worker-unit").WorkerNation;
  /** Development tools and state-changing debug actions (owner 2026-10-15: false for online non-admins). */
  developmentAllowed?: boolean;
  /** Player-wide single-commander ownership marker (the live soldier stays in its island save). */
  commanderOwner?: {
    get(): { id: string; homeIslandSeed: number } | undefined;
    claim(id: string, homeIslandSeed: number): boolean;
    release?(id: string): void;
  };
  /** Read once when committing new colony offers; saved discoveries never reroll. */
  playerLevel?: () => number;
  /**
   * The game rules a fresh island starts pinned to (GS2, sim-rules.ts); a restored island takes its save's copy.
   * Absent = legacy (today's game). Changed later only by the recorded `adoptGameRules`.
   */
  rules?: import("../../../../island-of-settlers-shared/src/game-settings/sim-rules").SimRules;
  /**
   * Campaign maps: the account's status of this map, fixed for the attempt (replays pay one third of quest home
   * rewards, trigger design §9.5). Absent elsewhere and until the campaign runtime supplies it.
   */
  campaignMapStatus?: () =>
    import("../../../../island-of-settlers-shared/src/script/engine/home-rewards").CampaignMapStatus;
  /** Every building is placeable whatever the player's level (?unlockall=1: tools and E2E). */
  unlockAllBuildings?: boolean;
  /** The player's talents changed (setTalentRanks): world services outside the simulation follow. */
  onTalentsChanged?: (talents: Readonly<import("@shared/catalog").TalentModifiers>) => void;
  /**
   * Rule/fixture tests only: scripted computer factions keep their own orders; the commander does
   * not lead them. Movement stays on the shipped flow fields. Never saved or exposed in the UI.
   */
  withoutMilitaryCommander?: boolean;
  /**
   * Benches and fixtures only: receives the strategic director's port once (A14-4a), to launch forces as a
   * colony permit or a scripted wave would. The simulation's own callers read `context.militaryDirector`.
   */
  onMilitaryDirector?: (director: import("./commander/director-types").MilitaryDirectorPort) => void;
  onNavigationFailure?: (event: { actorId: number; job: string; building: number;
    point: SettlementPoint; reason: string; cargo: string | null }) => void;
  /** Saved gameplay exploration mode; presentation-only fog overrides never change it. */
  explorationMode?: "fog" | "revealed";
  /**
   * Computer-side difficulty multiplier (difficulty.ts), default Normal. Not selectable yet; the
   * campaign ignores it and the player's own numbers never change.
   */
  difficulty?: DifficultyLevel;
  world: WorldData; roads: SettlementRoads; initialStock?: Goods; initialSettlers?: number;
  findWorkerPath?: (from: SettlementPoint, to: SettlementPoint) => SettlementPoint[] | null;
  canWorkerEnterPlot?: (building:SettlementBuilding, point:SettlementPoint) => boolean;
  stockContact?: (building:SettlementBuilding, kind:"input"|"output", ware:string, slot:number) => SettlementStockContact | null;
  /** `rate` > 1: an upgraded woodcutter's chop (and the tree's fall) plays that much faster. */
  onFellTree?: (index: number, rate?: number) => boolean | void;
  onPlantTree?: (point: SettlementPoint & { treeSpecies?: "broadleafTree" | "hardwoodTree" | "cedarTree" | "walnutTree" | "mahoganyTree" }) => boolean | void;
  canHarvestTree?: (index: number) => boolean;
  /** UI observation only: never advances felling or participates in simulation decisions. */
  getFelledTreeProgress?: (index: number) =>
    import("../../render-common/felling/tree-felling").FellingWorkProgress | undefined;
  getFelledTreePhase?: (index: number) => "standing" | "chopping" | "falling" | "fallen" | "stump" | "removed";
  resourceTargets?: (kind: ResourceTarget["kind"], near: SettlementPoint, range: number) => ResourceTarget[] | undefined;
  /** UI observation only: huntable animals on the island (dormant ones included), changing nothing. */
  countHuntableAnimals?: () => number;
  consumeResource?: (target: ResourceTarget) => boolean | undefined;
  /** Live island formations/seams and their shared saved respawn scheduler. */
  stoneSources?: {
    canConsume: (target: ResourceTarget, includeDepleted?: boolean) => boolean;
    remaining: (target: ResourceTarget) => number;
    freshAmount: (target: ResourceTarget) => number;
    exhausted: () => readonly number[];
    spot: (id: number) => SettlementPoint | null;
    canRestore: (id: number) => boolean;
    refill: (id: number) => void;
  };
  /** A used up quarry boulder (prop index) came back: the island draws it again and refills it. */
  onBoulderRespawned?: (prop: number) => void;
  /**
   * Runs first in every fixed tick with the island's saved tick count: wildlife, tree growth and felling step
   * here on the game clock, never on the render clock.
   */
  onTickStart?: (dt: number, tick: number) => void;
  /** The island runtime's seeded streams (wildlife, felling): the simulation's audit records their draws. */
  randomStreams?: readonly AuditedRandom[];
  /** The nature managers stepped in `onTickStart`, as the island's map script reads them (TRG3b). */
  scriptNature?: import("../script-world/nature/nature-source").ScriptNatureSource;
  getHuntTarget?: (id: number) => (SettlementPoint & { fleeing: boolean; dead: boolean; collectible: boolean }) | null;
  hitHuntTarget?: (id: number, from: SettlementPoint) => boolean;
  onSurveyDeposit?: (zoneId: number) => void;
  onOreChanged?: (cell: number) => void;
  onAnimalProduced?: (building: SettlementBuilding) => boolean | void;
  onBuildingDemolished?: (building: SettlementBuilding) => void;
  onFoundationLeveled?: (building: SettlementBuilding, region: { minX: number; minZ: number; maxX: number; maxZ: number }) => void;
  onRoadGroundLeveled?: (region: { minX: number; minZ: number; maxX: number; maxZ: number }) => void;
  onBuildingPlanned?: (building: SettlementBuilding, removedProps: readonly number[]) => void;
  /** After every load or snapshot reload: the island's buildings now (their plots, as planned ones have). */
  onBuildingsRestored?: (buildings: readonly SettlementBuilding[]) => void;
  /**
   * 39 starts a colony from a pre-built harbour instead of the headquarters; null starts an
   * adventure island without any building (troops land from an anchored ship).
   */
  homeBuilding?: 0 | 39 | null;
  /** Validated saved home used only as an identity placeholder before loadState; never grades the decoded map. */
  restoredHome?: SettlementBuilding;
  /**
   * Game time at the loaded (or new) state, UTC ms: the session's anchor (game-clock.ts). The live session
   * injects it (server UTC or device time); without it the clock starts at the deterministic epoch 0, so the
   * simulation never reads the wall clock itself.
   */
  clockStart?: number;
  /** Replaces the game clock's reading (tests, scene replays recorded before it); the simulation sets it. */
  now?: () => number;
  /** Read only when committing a discovery batch; injectable for calendar/debug testing. */
  discoveryCalendar?: () => DiscoveryCalendar;
  /** Voyage length for a commander's evacuation/return ship from the current island. */
  commanderVoyageSeconds?: () => number;
  onVisitorLoaded?: (goods: Goods) => void;
  onTroopsReturned?: (troops: readonly import("./settlement-military").EmigratedTroop[]) => void;
  /** A worker finished one ware (counted once, whether it lands in output or storage). */
  onProduced?: (ware: string) => void;
  /** A production cycle finished: its paid inputs and its product (offline catch-up measures chains). */
  onProductionCycle?: (building: SettlementBuilding, consumed: Readonly<Goods>, output: string | undefined) => void;
  /** Read-only offline profiling; a ready worker could not start because stock or shelf space was unavailable. */
  onProductionWait?: (building: SettlementBuilding, seconds: number, reason: "inputs" | "output") => void;
  /** Successful home-island services recorded by the account tutorial, never on load. */
  onTutorialEvent?: (key: string, amount?: number) => void;
  /** Construction finished during play (never on load). */
  onBuildingCompleted?: (building: SettlementBuilding) => void;
  /** A bridge construction site committed its span to the road graph. */
  onBridgeCompleted?: (site: import("./bridge-construction").BridgeConstructionSite) => void;
  onColonyArrived?: (expedition: import("./settlement-colony-expeditions").ColonyExpedition) => void;
}
export interface ProductionRule {
  job: string; tool?: string; inputs: string[]; outputs: string[];
  alternativeFood?: boolean; outdoor?: ResourceTarget["kind"]; seconds: number;
  service?: boolean; animal?: boolean;
}
export interface SettlementContext {
  /** The player's home-island building rules (saved; set only by `setHomeBuildingRules`); absent = the map's. */
  homeBuildingRules?: import("./building-availability-rules").HomeBuildingRules;
  /** The pinned game rules (saved as `gameRules`); undefined = legacy. Read through `rulesOf` (sim-rules.ts). */
  gameRules?: import("../../../../island-of-settlers-shared/src/game-settings/sim-rules").SimRules;
  roadDecorations?: import("./settlement-road-decorations").SettlementRoadDecorations;
  /** Home-island shore shell collecting: saved respawn moves and the collected count. */
  shoreShells?: import("./shore-shell-collection").ShoreShellLedger;
  restoringRoadDecorations?: boolean;
  storagePools?: import("./shared-storage").StoragePoolState;
  /** Bridges closing or being dismantled after a Remove order (saved). */
  bridgeRemovals?: import("./bridge-dismantling").BridgeRemoval[];
  /** Carts standing without a crew, waiting for a carrier (saved; absent when none). */
  abandonedHandcarts?: AbandonedHandcart[];
  /** Ruins of fallen buildings waiting for the clearing job (BD2; saved; absent when none). */
  ruins?: import("./settlement-ruins").SettlementRuin[];
  /** Synchronous unload-boundary handover; owned by the existing logistics dispatcher, never saved. */
  tryReuseTransport?: (actor: SettlementActor, source: SettlementBuilding) => boolean;
  authoredScenario?: AuthoredScenarioProgress;
  /** Campaign maps only (C9a): the landing harbour (key building) and the map's outcome; saved. */
  campaignMap?: import("../campaign/campaign-map-outcome").CampaignMapProgress;
  /** The map script this island runs, copied at map start (TRG1; saved; absent when the map has none). */
  scriptSnapshot?: import("../../../../island-of-settlers-shared/src/script/snapshot").MapScriptSnapshot;
  /**
   * The running map script (TRG3a): engine, world port and emission gate. Absent on maps without a script, so every
   * emission site costs one optional-chain read there and non-script saves and replays stay unchanged.
   */
  script?: import("../script-world/settlement-script").SettlementScript;
  expeditionCombat?: {
    death: (type: import("./military-combat-rules").MilitaryTroopType, faction: number) => void;
    arrivals: (troops: readonly import("./settlement-military").EmigratedTroop[]) => void;
  };
  colony?: { save: () => import("./settlement-colony").SettlementColonySave | undefined;
    restore: (saved?: import("./settlement-colony").SettlementColonySave) => void;
    /** A soldier of a colony counterattack party (it presses its raid; the smart commander leaves it). */
    isRaider?: (uid: number) => boolean };
  adventure?: { campFrames?: () => readonly import("../../render-common/adventure/adventure-camp").AdventureCampFrame[];
    /** Planned camp sites (camp layouts follow the whole world, so the change journal treats them globally). */
    campCount?: () => number;
    campRevision?: () => number; save: () => import("./settlement-adventure").SettlementAdventureSave | undefined;
    restore: (saved?: import("./settlement-adventure").SettlementAdventureSave) => void };
  playerNation?: import("../../render-common/workers/worker-unit").WorkerNation;
  /** Live computer-side difficulty; restored from the save, Normal when it omits the field. */
  difficulty?: DifficultyLevel;
  naval?: { expeditionDemand: (uid: number) => Readonly<Goods>;
    /** Every live ship record (no copy); the vision pass picks the exploration ships under way. */
    explorerShips?: () => readonly import("./settlement-naval-fleet").NavalShip[];
    /** A voyage helper or shipwright lost on land: every voyage list and ship site forgets them. */
    forgetPerson?: (uid: number) => void;
    /** Shipyard input demand for the selected mode: sea ships add cloth beyond the boat recipe. */
    shipyardDemand?: (uid: number) => Readonly<Goods>;
    /** Durable destination supply demand: outstanding, covered and blocked reasons (ISLAND-06). */
    localBoatClaims?: (uid: number) => number;
    /** A building is gone (a fall too): voyages, reserves and ship sites of it are released, as on demolition. */
    removeBuilding?: (uid: number) => void;
    shippingDemands?: () => readonly import("./settlement-shipping-demand").ShippingDemandSnapshot[];
    /** A construction/stock/topology change: the demand network rechecks on the next tick. */
    shippingDemandChanged?: (uid?: number) => void;
    /** A reward ship is still bound for this harbour: it cannot be demolished yet (C12, plan item 35). */
    rewardShipBound?: (uid: number) => boolean;
    /** Settlers rowing the harbours' lighters (on duty, not actors: added to the people count on a load). */
    rowers?: () => number;
    /** The neutral trade ship (TRADE-01 phase 2, settlement-naval-trade.ts). */
    tradeShips?: import("../trade/trade-types").TradeShipPort;
    reliefShips?: ReliefShipPort };
  /** Wares carriers still have to bring to a Tavern for its current recruit. */
  tavern?: { demand: (uid: number) => Readonly<Goods>;
    /** A fallen Academy: its batch and queue are cancelled; its delivered wares go with the stock. */
    destroyBuilding?: (uid: number) => void;
    /** A computer economy's AI orders recruits at its own Academy (EAI4a); the player's command omits `owner`. */
    orderRecruits?: (uid: number, type: unknown, count: number, owner?: number) => { ok: boolean };
    /** Recruits queued at the Academies of `owner` (EAI4a). */
    queuedRecruits?: (owner: number) => number };
  /** The island's trade office (TRADE-01): saved with the island, journalled commands. */
  trade?: SettlementTrade;
  relief?: ReliefCollections;
  military?: { buildingStanding?: (uid: number) => boolean; prioritizeRecallGarrisons?: (ids: readonly number[]) => number[];
    returnToStorage?: (ids: readonly number[], storageUid?: number) => boolean;
    /** Troop ships (MIL-SHIPS-SIM): field soldier to naval passenger at a gangway foot, and back ashore. */
    leaveFieldForShip?: (id: number) => boolean;
    landFromShip?: (id: number) => boolean;
    /** The player's field order issued by the simulation (soldiers a full troop ship left ashore). */
    commandSoldiers?: (ids: readonly number[], point: SettlementPoint,
      mode: import("./military-targeting").MilitaryOrder) => boolean;
    removeBuilding?: (uid: number) => void;
    /** Coins and the nation's drink that carriers must still bring for promotion. */
    supplyDemand: (uid: number) => {
      coins: number; drink: number; drinkWare: string; stone?: number; stoneWare?: string;
    };
    movementSpeed?: (actor: SettlementActor) => number;
    troopType?: (uid: number) => import("./military-combat-rules").MilitaryTroopType | undefined;
    /** The live soldier record of an actor uid (read-only; the map script describes units with it). */
    soldierOf?: (uid: number) => import("./settlement-military").SettlementSoldier | undefined;
    /** The map script's soldier actions (TRG5a): spawn, kill, despawn, teleport, march, owner. */
    scriptUnits?: import("./settlement-combat-script").ScriptUnitControl;
    /** Every live soldier record (read-only; map script queries). */
    soldierRecords?: () => Iterable<import("./settlement-military").SettlementSoldier>;
    factionOf?: (uid: number) => number | undefined;
    /** Economy AI wall repair (EAI2d): a faction's own walls on building `uid` (read-only), if any. */
    factionWalls?: (uid: number, faction: number) => Readonly<import("./fort-assault-rules").MilitaryStructure> |
      undefined;
    /** Economy AI wall repair (EAI2d): standing walls regain up to `amount` HP; returns the HP gained. */
    repairWalls?: (uid: number, amount: number) => number;
    /**
     * Economy AI `maintain` (EAI2b): one stored soldier of a computer economy walks to its garrison building below
     * `target` soldiers (EAI4a: the AI's per-tower target; absent: the building's default).
     */
    garrisonFromReserve?: (uid: number, target?: number) => boolean;
    /**
     * The economy AI's reserve lever (EAI4-FOLLOWUP): up to `count` stored soldiers of computer economy `owner`
     * march out of its storages to muster in the field for the director's forces; returns how many left. One
     * stored soldier stays for each of its garrison buildings without any (`spareReserve` counts the rest).
     */
    releaseReserve?: (owner: number, count: number) => number;
    spareReserve?: (owner: number) => number;
    /** A computer economy's reserve waiting in its storage (EAI2b `aiPlace` start kit). */
    storeFactionReserves?: (troops: readonly import("./settlement-military").EmigratedTroop[],
      storage: SettlementBuilding) => SettlementActor[];
    emigrate?: (uid: number) => import("./settlement-military").EmigratedTroop | null;
    immigrate?: (troops: readonly import("./settlement-military").EmigratedTroop[], storage?: SettlementBuilding) => void };
  horses?: ReturnType<typeof createSettlementHorses>;
  /** The island's single player commander: lodge, roster, readiness, aura and recovery. */
  commander?: CommanderSystem;
  /** Authoritative commander-only input lease; presentation never owns another actor/HP copy. */
  commanderControl?: MilitaryDirectControl;
  /** A13 per-faction vision layer (computed every tick, never saved; drives the player's fog). */
  factionVision?: import("./faction-vision").FactionVision;
  /** A13 phase 3: what each faction knows of enemy soldiers (seen, hit alerts, last known; saved in combat). */
  factionKnowledge?: import("./faction-knowledge").FactionKnowledge;
  /** A14-5: the commander levels a map script gave computer factions (saved with the combat state). */
  commanderLevels?: import("./commander/commander-levels").CommanderLevels;
  /** EAI1d: computer economies' internal placement (the economy AI's builder entry; not a recorded command). */
  factionPlacement?: import("./settlement-faction-placement").FactionPlacement;
  /** EAI2a: the enemy economy AI of the map's AI factions (`MapScenario.factionAi`; saved as `factionAi`). */
  factionAi?: import("./economy-ai/faction-ai").FactionAi;
  /** A14-4a strategic director: colony counterattacks launch forces, the economy AI states intents (A14-4c). */
  militaryDirector?: import("./commander/director-types").MilitaryDirectorPort;
  /** A13 phase 2: the player's fog of war written in the tick (absent on expedition and fog-free worlds). */
  playerFog?: import("./player-fog").PlayerFog;
  /** Raider threat view for civilians (MIL-ASSAULT): stay inside, flee; installed by the combat layer. */
  civilianThreat?: import("./military-civilian-safety").CivilianThreat;
  fieldCycles?: SettlementFieldCycles;
  /** The player's talent modifiers (settlement-talents.ts); absent means neutral. */
  talents?: Readonly<import("@shared/catalog").TalentModifiers>;
  /** Computer factions' map handicaps as talent modifiers by faction (`faction-bonus.ts`); absent: none. */
  factionTalents?: readonly (Readonly<import("@shared/catalog").TalentModifiers> | undefined)[];
  options: SettlementOptions; buildings: SettlementBuilding[]; actors: SettlementActor[];
  /** Hot-path uid index; maintained by claim, demolition and load (see settlement-building-index). */
  buildingByUid?: Map<number, SettlementBuilding>;
  /** Bumped whenever occupancy or field reservations change; road route memo follows it. */
  navigationRevision?: number;
  occupied: Uint8Array; reservations: Set<string>; nextActor: number; nextBuilding: number;
  /** Idle settlers in storages (the sum of their `idleSettlers`). */
  settlers: number;
  /** On-duty people, growth timer and births (settlement-population.ts); absent in bare fixtures. */
  population?: import("./settlement-population").IslandPopulation;
  /** The island's game clock (saved tick counter); absent in bare fixtures. */
  clock?: import("./game-clock").GameClock;
  /** The island's seeded-stream audit (draw trail and stream states, not saved); absent in bare fixtures. */
  randomAudit?: RandomAudit;
  /** Key of the unsaved per-load state maps (settlement-transient-state.ts); a load replaces it. */
  transient?: object;
  resourceAmounts: Map<string, number>; accumulator: number; scheduling: number;
  nextTransferId?: number;
  transfers: SettlementTransferOrder[];
}
