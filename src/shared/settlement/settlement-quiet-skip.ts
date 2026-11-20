import { TICK_SECONDS } from "../../../../island-of-settlers-shared/src/time/constants";
import { saveStoneRespawns } from "./boulder-respawn";
import { getBuildingProductionRule, STORAGE_IDS } from "./production-rules";
import {
  type SettlementActorTickSystems,
  updateSettlementActorTick
} from "./settlement-actor-tick";
import { updateDoorActivity } from "./settlement-door-activity";
import { beginStorageTrafficTick } from "./settlement-door-traffic";
import { findHomeBuilding } from "./settlement-home";
import { buildingNation } from "./settlement-nation";
import { beginPersonTrafficTick } from "./settlement-person-index";
import { islandPeople, populationLimit } from "./settlement-population";
import { beginNavigationRepairTick } from "./settlement-repair-budget";
import { reservationWatchCount, updateReservationWatchdogs } from "./settlement-reservation-watchdog";
import { dispatchRuinClearing, ruinsQuiet } from "./settlement-ruin-dispatch";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { updateSettlementVision } from "./settlement-vision";

interface QuietClock {
  advance(ticks: number): void;
  tick(): number;
}

interface QuietTrade {
  snapshot(): { deliveries: unknown[]; escrow: unknown[]; npcTraders: boolean; offers: unknown[] };
  update(dt: number): void;
}

/** The actor pipeline and the systems whose schedules the quiet tick still proves no-ops. */
export interface QuietSkipSystems extends SettlementActorTickSystems {
  trade: QuietTrade;
}

export interface QuietSkipOptions {
  clock: QuietClock;
  systems: QuietSkipSystems;
}

const noGoods = (goods: Record<string, number> | undefined) => !Object.keys(goods ?? {}).length;

/**
 * Completed production types whose worker has a dedicated pre-pause update that cannot be ruled out
 * from the building alone: the well windlass and shipyard work. A stationary inside worker still
 * reaches those branches first, so they stay on the fixed tick.
 */
const PRIVATE_PRE_PAUSE_UPDATES = new Set([35, 36]);

/** A completed storage has no worker slot, production rule, shelves, upgrade or construction timer. */
const quietStorageBuilding = (building: SettlementBuilding) =>
  building.construction === 1 && STORAGE_IDS.has(building.typeId) &&
  building.worker === undefined && !building.working && building.workshopUpgrade === undefined &&
  noGoods(building.input) && noGoods(building.output) &&
  noGoods(building.incoming) && noGoods(building.required);

/**
 * A completed, paused production building with no output, receipt, pending input, upgrade, order or
 * in-progress handling. Its stationary worker reaches `beginProduction` every fixed tick and returns
 * at the pause check before consuming, producing, fetching, planting, mining, felling, hunting,
 * feeding or changing its status (`Production stopped`).
 *
 * Outdoor and animal jobs have dedicated pre-pause updates (`updateForester`, `updatePigBreeder`,
 * `updateHunter`, `recoverResourceApproach`); each returns without touching state when the actor is
 * inside and idle with no target or job phase. Stored input is allowed only
 * while it is one of that building's own recipe inputs; anything else could be swept by an
 * input-return rule outside the quiet clock.
 */
const quietPausedInput = (building: SettlementBuilding, rule: { inputs: readonly string[] }) =>
  Object.entries(building.input).every(([ware]) => rule.inputs.includes(ware));

const quietPausedBuilding = (context: SettlementContext, building: SettlementBuilding) => {
  if (building.construction !== 1 || building.productionPaused !== true || building.worker === undefined ||
    building.working || building.workshopUpgrade !== undefined ||
    building.status !== "Production stopped") return false;
  const rule = getBuildingProductionRule(building, buildingNation(context, building));
  // Services return at `beginProduction`'s service branch before the pause check (military, tavern
  // and survey systems drive them); every other rule has a proven paused no-op below.
  if (!rule || rule.service || PRIVATE_PRE_PAUSE_UPDATES.has(building.typeId)) return false;
  if (!quietPausedInput(building, rule)) return false;
  if (!noGoods(building.output) || !noGoods(building.incoming) || !noGoods(building.required)) return false;
  if (building.productionOrders !== undefined || building.selectedOutput !== undefined ||
    building.handcarts !== undefined || building.handcartMode !== undefined ||
    building.fisherMode !== undefined || building.fisherBoat !== undefined ||
    building.shipReserve !== undefined || building.pigFeedPhase !== undefined ||
    building.wellBucketTaken !== undefined || building.nurserySeedlingTaken !== undefined ||
    (building.workTime ?? 0) !== 0) return false;
  return true;
};

/**
 * The only moving-state fields a quiet paused worker may carry. Its fixed tick still runs the
 * shared actor pipeline for the animation clock (when not masked), but every branch before
 * `beginProduction` and the pause check itself must be a no-op.
 */
const quietPausedWorker = (
  context: SettlementContext, actor: SettlementActor, pausedBuildings: ReadonlySet<number>
) => {
  if (actor.phase !== "inside" || actor.action !== "idle" || actor.visible) return false;
  if (!pausedBuildings.has(actor.building)) return false;
  if (actor.mounted || actor.navigationRecovery !== undefined || actor.workerMovementPlan !== undefined ||
    actor.workerHandlingPlan !== undefined || actor.handcart !== undefined || actor.navalOrder !== undefined ||
    actor.boatWork !== undefined || actor.fieldWork !== undefined || actor.sowingBatch !== undefined ||
    actor.wellWork !== undefined || actor.foresterSeedling !== undefined ||
    actor.wareTransfer !== undefined || actor.stockContact !== undefined ||
    actor.stockBuilding !== undefined || actor.storageArrivalBuilding !== undefined ||
    actor.storageArrivalOrder !== undefined || actor.ware !== null || actor.delivery !== undefined ||
    actor.demolitionReturning || Object.keys(actor.demolitionCargo ?? {}).length ||
    actor.treeFellingStarted || actor.queueTarget !== undefined || actor.queueKind !== undefined ||
    (actor.queueWait ?? 0) !== 0 || actor.target !== undefined || actor.preparedTarget !== undefined ||
    actor.productionOutput !== undefined || actor.productionSeconds !== undefined ||
    actor.productionInputs !== undefined || actor.productionPath !== undefined ||
    actor.afterInputPhase !== undefined || Object.keys(actor.consumed ?? {}).length ||
    actor.huntArrow !== undefined || actor.timer > 0) return false;
  const building = context.buildings.find(entry => entry.uid === actor.building);
  if (!building || building.worker !== actor.uid) return false;
  const rule = getBuildingProductionRule(building, buildingNation(context, building));
  if (!rule || actor.job !== rule.job) return false;
  // The drink-chain grower/maker takes a tool from home before the pause check; a mismatched tool
  // would either change its status or empty a home tool slot.
  if ([5, 6].includes(building.typeId) && rule.tool && actor.tool !== rule.tool) return false;
  return context.buildings.some(home => home.uid === actor.home &&
    home.construction === 1 && STORAGE_IDS.has(home.typeId));
};

/**
 * Fixed ticks a skip may cover before the economy AI acts (EAI5b, plan §5.3): its next due tick is the skip's
 * boundary event, which the exact fixed tick then runs. 0 when it acts this tick; Infinity while it is frozen
 * (offline catch-up) or the island has no AI faction.
 */
export const ticksBeforeFactionAi = (context: SettlementContext) =>
  (context.factionAi?.nextActionTick() ?? Infinity) - (context.clock?.tick() ?? 0);

/** Everything a skipped tick may not touch, independent of the actors/buildings shape. */
export const quietEnvironmentStatus = (context: SettlementContext, systems: QuietSkipSystems) => {
  const { adventure, colony, military, naval, tavern, trade } = systems;
  // A computer economy is quiet only while no AI decision is due (EAI1a F9, relaxed by EAI5b).
  if (ticksBeforeFactionAi(context) <= 0) return { quiet: false as const, reason: "economy-ai" };
  if (context.fieldCycles!.snapshot().length) return { quiet: false as const, reason: "fields" };
  if (context.reservations.size) return { quiet: false as const, reason: "reservations" };
  if (context.transfers.length) return { quiet: false as const, reason: "transfers" };
  if (context.abandonedHandcarts?.length) return { quiet: false as const, reason: "abandoned-carts" };
  // A live watchdog can shove an idle person or release a reservation after its elapsed clock.
  if (reservationWatchCount(context)) return { quiet: false as const, reason: "reservation-watch" };
  if (context.authoredScenario) return { quiet: false as const, reason: "scenario" };
  if (saveStoneRespawns(context).length) return { quiet: false as const, reason: "stone-timers" };
  // A completed colony/adventure still runs `fortifyForts`/`clearRuins` and hostile-building cleanup
  // on every scheduler fire; those loops are no-ops only when no hostile structure remains, and a
  // live raid ship/raider or contested expedition is stateful. The systems prove those conditions.
  const colonyState = colony.save();
  if (colonyState && !colony.quietSkip())
    return { quiet: false as const, reason: colonyState.status === "contested" ? "colony-contested" : "colony-cleanup" };
  const adventureState = adventure.save();
  if (adventureState && !adventure.quietSkip())
    return { quiet: false as const, reason: adventureState.status === "contested" ? "adventure-contested" : "adventure-cleanup" };
  if (!military.quietSkip()) return { quiet: false as const, reason: "military" };
  if (!naval.quietSkip()) return { quiet: false as const, reason: "naval" };
  const tavernState = tavern.saveState();
  if (tavernState.orders.length || tavernState.batches.length)
    return { quiet: false as const, reason: "tavern" };
  const tradeState = trade.snapshot();
  if (tradeState.escrow.length || tradeState.offers.length || tradeState.deliveries.length ||
    tradeState.npcTraders) return { quiet: false as const, reason: "trade" };
  if (context.options.roads.segments?.().length) return { quiet: false as const, reason: "roads" };
  if (!ruinsQuiet(context)) return { quiet: false as const, reason: "ruins" };
  return { quiet: true as const };
};

/**
 * Quiet-island coarse skip (opt-in, offline replay): with no moving actors, fields, roads or active
 * systems, only completed storages, completed paused production buildings and completed expeditions
 * with no hostile structure left, a fixed tick changes only clocks and runtime/timer residue. The
 * quiet tick advances exactly the same clocks: the game/accumulator/scheduler, `onTickStart`,
 * storage-traffic, reservation-watchdog, navigation-repair, door openness, the actor pipeline (for
 * the saved animation clock), the trade clock and the military movement clock. The guard is
 * deliberately narrow; any unproved activity falls back to fixed ticks.
 */
export const createQuietSkip = (
  context: SettlementContext, { clock, systems }: QuietSkipOptions
) => {
  const { military, naval, trade } = systems;
  const quietSkipStatus = () => {
    if (context.accumulator !== 0) return { quiet: false as const, reason: "accumulator" };
    const pausedBuildings = new Set<number>();
    for (const building of context.buildings) {
      if (quietStorageBuilding(building)) continue;
      if (quietPausedBuilding(context, building)) { pausedBuildings.add(building.uid); continue; }
      return { quiet: false as const, reason: "buildings" };
    }
    // Exactly one stationary worker per paused building, and no retired shells, horses or carriers.
    if (context.actors.length !== pausedBuildings.size) return { quiet: false as const, reason: "actors" };
    for (const actor of context.actors)
      if (!quietPausedWorker(context, actor, pausedBuildings))
        return { quiet: false as const, reason: "actors" };
    const limit = populationLimit(context, findHomeBuilding(context));
    // Population growth is the only home-building timer; at the cap every scheduler fire returns.
    if (limit !== undefined && islandPeople(context) < limit)
      return { quiet: false as const, reason: "population-timer" };
    return quietEnvironmentStatus(context, systems);
  };
  /**
   * Advances `ticks` fixed ticks without running the fixed tick's no-op scans: every step keeps the
   * same clock, accumulator, scheduler, runtime-lane, transient-clock, trade-clock and
   * military-movement-clock arithmetic, and replays the shared actor pipeline. The caller must only
   * reach this through `quietSkipStatus`; anything else must tick normally. The skip stops before the economy AI's
   * next due tick, so the fixed tick runs every AI decision.
   */
  const advanceQuietTicks = (requested: number) => {
    if (!Number.isSafeInteger(requested)) return 0;
    const ticks = Math.min(requested, ticksBeforeFactionAi(context));
    if (ticks <= 0 || !quietSkipStatus().quiet) return 0;
    const dt = TICK_SECONDS;
    for (let index = 0; index < ticks; index++) {
      const gameTick = clock.tick();
      context.randomAudit?.setTick(gameTick);
      context.options.onTickStart?.(dt, gameTick);
      beginStorageTrafficTick(context, dt);
      updateReservationWatchdogs(context, dt);
      beginNavigationRepairTick(context, dt);
      naval.advanceQuiet(dt);
      military.advanceQuiet(dt);
      context.accumulator += dt;
      if (context.accumulator >= dt) context.accumulator -= dt;
      context.scheduling += dt;
      if (context.scheduling >= 0.5) {
        context.scheduling -= 0.5;
        // Waiting ruins retry on the same ticks as in exact play (their backoff state is saved).
        dispatchRuinClearing(context);
      }
      beginPersonTrafficTick(context);
      for (const actor of context.actors) updateSettlementActorTick(context, systems, actor, dt);
      trade.update(dt);
      if (!context.options.tickMask?.doorActivity) updateDoorActivity(context, dt);
      clock.advance(1);
    }
    // Nothing moves on a quiet island; one vision pass keeps the layer and the fog at the fixed ticks' result.
    updateSettlementVision(context);
    return ticks;
  };
  return { advanceQuietTicks, quietSkipStatus };
};
