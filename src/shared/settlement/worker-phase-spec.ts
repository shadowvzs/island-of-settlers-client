import { WARE_TRANSFER_SECONDS, WORKER_REST_SECONDS } from "../balance/economy";
import { FISHING_WORK_TIMING, FORESTER_PLANT_SECONDS } from "./outdoor-work-timing";
import { getBuildingProductionRule } from "./production-rules";
import { HUNT_DRAW_SECONDS } from "./settlement-hunting";
import { buildingNation } from "./settlement-nation";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { WHEAT_SOW_SECONDS } from "./settlement-wheat-planning";
import { isInPlaceWorkPhase, workerCycleRateDetail } from "./workshop-upgrades";

/**
 * Read-only classification of the current fixed-tick worker handler. It describes the existing
 * phases; it does not drive them. UI/telemetry owners use it to show why a worker is working,
 * walking, handling, resting or waiting without inventing a second simulation clock.
 */
export type WorkerPhaseClock = "work" | "rest" | "handling" | "travel" | "wait" | "growth" |
  "construction" | "inactive" | "other";

export interface WorkerPhaseSpec {
  phase: string;
  clock: WorkerPhaseClock;
  /** Current simulation-time rate and its exact shares (see `workerCycleRateDetail`). */
  rate: number;
  rateApplies: boolean;
  levelShare: number;
  talentShare: number;
  materialScale: number;
  /** Authored phase length when the handler has a fixed clock; travel has no fixed length. */
  authoredSeconds?: number;
  /** Remaining seconds on the current fixed clock. */
  remainingSeconds?: number;
  /** 0..1 completed share of the current fixed clock. */
  progress?: number;
  /** What the worker holds or has reserved during this phase. */
  ownership: "none" | "carrying" | "input-reserved" | "output-held" | "target-claim" |
    "construction-supplies";
  /** The logical boundary that can end this phase. */
  wake: "timer" | "transfer" | "arrival" | "retry" | "resource" | "growth" | "construction" | "none";
}

const REST_PHASES = new Set(["rest"]);
const HANDLING_PHASES = new Set(["inputPickup", "outputPutdown", "pickupTransfer", "deliveryTransfer",
  "cartLoading", "cartUnloading", "boatInputPickup", "loading", "unloading"]);
const TRAVEL_PHASES = new Set(["assigned", "enterAssigned", "enterRest", "outbound", "returnWork",
  "outputWalk", "inputApproach", "inputReturn", "outputFullReturn", "returning", "builderWork",
  "retire", "enterRetire", "levelApproach", "levelExit", "foundingReturn"]);
const WAIT_PHASES = new Set(["inside", "workSearchWait", "workerRestWait", "inputFetchBlocked",
  "inputReturnBlocked", "returnBlocked", "builderReturnBlocked", "sowingBlocked", "weaverWorkBlocked", "drinkWorkBlocked",
  "outputFullReturn", "pigFeedBlocked", "foresterPickupBlocked", "foresterPlantBlocked",
  "foresterReturnBlocked", "wellBucketBlocked", "wellOutputBlocked", "boatHomeBlocked",
  "boatReturnBlocked", "boatWorkshopBlocked", "shipInputBlocked", "shipReturnBlocked",
  "upgradeAccessBlocked", "upgradeConstruct", "waiting", "idle", "deliveryBlocked",
  "carrierPickupBlocked", "carrierDeliveryBlocked", "carrierLoadedBlocked", "cartRecover",
  "stranded", "blocked"]);
const INACTIVE_PHASES = new Set(["retired", "militaryDead", "navalAboard", "navalWaiting", "aboard",
  "away", "garrison", "militaryReserve", "militaryField", "militaryLeaving", "militarySiege",
  "sailing"]);
const GROWTH_PHASES = new Set(["waitTreeFall"]);

const findBuilding = (context: SettlementContext, actor: SettlementActor) =>
  context.buildings.find(building => building.uid === actor.building);

const authoredSeconds = (context: SettlementContext, actor: SettlementActor,
  building: SettlementBuilding | undefined) => {
  if (actor.phase === "rest") return WORKER_REST_SECONDS;
  if (HANDLING_PHASES.has(actor.phase)) return WARE_TRANSFER_SECONDS;
  if (actor.phase === "foresterPlant") return FORESTER_PLANT_SECONDS;
  if (actor.phase === "fishCast") return FISHING_WORK_TIMING.cast;
  if (actor.phase === "fishWait") return FISHING_WORK_TIMING.wait;
  if (actor.phase === "fishReel") return FISHING_WORK_TIMING.reel;
  if (actor.phase === "huntAim") return HUNT_DRAW_SECONDS;
  if (actor.phase === "huntFlight") return actor.huntArrow?.duration;
  if (actor.phase === "work") {
    if (actor.fieldWork === "sow") return WHEAT_SOW_SECONDS;
    if (actor.productionSeconds !== undefined) return actor.productionSeconds;
    if (building) return getBuildingProductionRule(building, buildingNation(context, building))?.seconds;
  }
  return undefined;
};

const ownershipFor = (actor: SettlementActor, clock: WorkerPhaseClock): WorkerPhaseSpec["ownership"] => {
  if (clock === "construction") return "construction-supplies";
  if (actor.ware) return actor.ware === "boat" ? "output-held" : "carrying";
  if (actor.productionInputs?.length || actor.consumed) return "input-reserved";
  if (actor.target && ["work", "growth"].includes(clock)) return "target-claim";
  return "none";
};

const wakeFor = (clock: WorkerPhaseClock): WorkerPhaseSpec["wake"] => {
  switch (clock) {
    case "handling": return "transfer";
    case "travel": return "arrival";
    case "wait": return "retry";
    case "growth": return "growth";
    case "construction": return "construction";
    case "inactive": return "none";
    default: return "timer";
  }
};

/** Read-only clock of the current handler phase; shared by the worker inspector and diagnostics. */
export const workerPhaseClock = (actor: Pick<SettlementActor, "action" | "phase">): WorkerPhaseClock => {
  if (INACTIVE_PHASES.has(actor.phase)) return "inactive";
  if (REST_PHASES.has(actor.phase)) return "rest";
  if (actor.phase === "construct" || (actor.phase === "builderWork" && actor.action === "work"))
    return "construction";
  if (HANDLING_PHASES.has(actor.phase)) return "handling";
  if (TRAVEL_PHASES.has(actor.phase)) return "travel";
  if (WAIT_PHASES.has(actor.phase)) return "wait";
  if (GROWTH_PHASES.has(actor.phase)) return "growth";
  if (isInPlaceWorkPhase(actor.phase)) return "work";
  return "other";
};

/** Classify the current phase and read the authoritative rate/timer without advancing anything. */
export const workerPhaseSpec = (context: SettlementContext, actor: SettlementActor): WorkerPhaseSpec => {
  const building = findBuilding(context, actor);
  const clock = workerPhaseClock(actor);
  const detail = workerCycleRateDetail(context, actor);
  // `waitTreeFall` is in the rate set only because the actor animation clock is scaled; the
  // handler itself waits for the external felling stage, not for a work timer.
  const rateApplies = detail.applies && clock !== "growth";
  const authored = authoredSeconds(context, actor, building);
  const remaining = authored === undefined ? undefined : Math.max(0, actor.timer);
  const progress = authored && remaining !== undefined
    ? Math.max(0, Math.min(1, 1 - remaining / authored)) : undefined;
  return {
    phase: actor.phase,
    clock,
    rate: detail.rate,
    rateApplies,
    levelShare: detail.levelShare,
    talentShare: detail.talentShare,
    materialScale: detail.materialScale,
    ...(authored === undefined ? {} : { authoredSeconds: authored }),
    ...(remaining === undefined ? {} : { remainingSeconds: remaining }),
    ...(progress === undefined ? {} : { progress }),
    ownership: ownershipFor(actor, clock),
    wake: wakeFor(clock)
  };
};
