import { COLONY_LIFETIME_MS } from "@shared/catalog/balance";

import { isBuildingCourtyardPointWalkable } from "../../render-common/buildings/building-courtyard";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { isAdventureIsland } from "../../shared/settlement/adventure-rules";
import {
  addAdventureRecord, addColonyRecord, type Archipelago, findColony, updateAdventureStatus, updateColonyStatus
} from "../../shared/settlement/archipelago";
import { addToHome } from "../../shared/settlement/colony-economy";
import { tickSeconds, ticksForSeconds } from "../../shared/settlement/game-clock";
import { createGameSave, type GameSaveV1 } from "../../shared/settlement/game-save";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { isHomeBuilding } from "../../shared/settlement/settlement-home";
import {
  snapshotMovementSkipWork
} from "../../shared/settlement/settlement-movement-skip";
import { createSettlementSimulation, type SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { snapshotTrafficWork } from "../../shared/settlement/settlement-traffic-counters";
import type { Goods, SettlementBuilding } from "../../shared/settlement/settlement-types";
import { savedStorageBuildings } from "../../shared/settlement/shared-storage";
import { colonySettlementOptions } from "./colony-boot";
import { createColonyEconomy } from "./colony-economy-session";
import { createEventCorePlan } from "./event-core-replay";
import { stageGameSession } from "./game-session";
import { createIslandStockContacts } from "./island-stock-contacts";
import {
  ANALYTIC_MAX_SECONDS, createOfflineCatchUp, type MeasuredMetrics, type OfflineCatchUp,
  type OfflineCatchUpMode, type OfflineChronology
} from "./offline-catch-up";
import { createOfflineIslandRuntime } from "./offline-island-runtime";
import { createPlayerSession, type PlayerProgressStore } from "./player-session";

/** The live fixed tick: exact replay and the measured windows of a fast one run the same steps. */
export const OFFLINE_STEP = .05;
/** How often (wall milliseconds) a replay reports progress and yields to the event loop. */
const REPORT_MS = 100;
/** Quiet-skip revalidation chunk: the guard is cheap, so never skip an unbounded stretch at once. */
const QUIET_SKIP_CHUNK_SECONDS = 300;
/** Movement-skip revalidation chunk: same bounded stretch, re-checked before every chunk. */
const MOVEMENT_SKIP_CHUNK_SECONDS = 300;

export interface OfflineIslandReplay {
  archipelago: Archipelago | undefined;
  /** Old rule for a fast replay: idle hostile camps keep the island in real ticks. */
  enemyCampsBlockJumps: boolean;
  /**
   * Phase A: the event plan owns field/tree growth and the population/stone scheduler phases.
   * `"auto"` runs it only when the coverage audit proves every active masked timer is owned, and
   * falls back to plain exact ticks with a reported reason otherwise.
   */
  eventCore?: boolean | "auto";
  /** Live home buildings supplied by the home island session for colony supply/ore logic. */
  liveHomeBuildings?: () => SettlementBuilding[] | undefined;
  /** Live home settlement supplied by the home island session for troop/evacuation logic. */
  liveHomeSettlement?: () => import("../../shared/settlement/settlement-save-state").SettlementSaveV1 | undefined;
  /** Opt-in movement executor and corridor gate for offline tests/experiments. */
  corridorReservations?: boolean;
  eventMovement?: boolean;
  /** Opt-in Phase A2: skip fixed ticks only while the island is provably quiet; falls back otherwise. */
  quietSkip?: boolean;
  /** Opt-in movement prototype: skip whole fixed ticks for one guarded straight-corridor walker. */
  movementSkip?: boolean;
  /** Experimental guard selector for the movement prototype; absent keeps the original prototype. */
  movementSkipGuard?: "prototype" | "segmented";
  /** Shared canonical player progress for coordinated multi-island sessions. */
  playerStore?: PlayerProgressStore;
  /** Actual multi-island policy; direct single-island calls default to sequential. */
  chronology?: OfflineChronology;
  /** Common game-time slice of a coordinated replay; absent for the sequential order. */
  chronologySliceSeconds?: number;
  /** The lane the caller requested; differs from `mode` when chronology falls back to exact. */
  requestedMode?: OfflineCatchUpMode;
  /** Real ticked game seconds a measured replay aims to spend on this island. */
  exactBudgetSeconds: number;
  islandId: number | null;
  mode: OfflineCatchUpMode;
  /** Optional measurement hook; does not affect replay state. */
  onMetrics?: (metrics: OfflineIslandMetrics) => void;
  /** Read-only diagnostics of gross completed cycles, before downstream consumers use the goods. */
  onProductionCycle?: OfflineProductionObserver;
  onProductionWait?: OfflineProductionWaitObserver;
  onProduced?: (islandId: number | null, ware: string, tick: number) => void;
  /** Real time the result is saved at: the game clock jumps to it after the (capped) replay. */
  now: number;
  /** Diagnostics: game seconds each skip or jump covered. */
  onSkip?: (seconds: number) => void;
  report: (completed: number) => void;
  /** Game seconds to replay from `start` (at most the catch-up cap). */
  seconds: number;
  /** Game time the replay starts at: the time the game was saved. */
  start: number;
}

export type OfflineProductionObserver = (
  islandId: number | null, building: SettlementBuilding, consumed: Readonly<Goods>,
  output: string | undefined, tick: number
) => void;
export type OfflineProductionWaitObserver = (
  islandId: number | null, building: SettlementBuilding, seconds: number, tick: number, reason: "inputs" | "output"
) => void;

export interface OfflineIslandMetrics {
  eventCore: { events: number; fields: number; queue: number; scheduledFields?: number } | undefined;
  /** Preflight/post-run audit of what the event core owned versus left on the fixed tick. */
  eventCoreCoverage?: import("../../shared/settlement/event-core/coverage").EventCoreCoverage;
  eventCoreCoverageInitial?: import("../../shared/settlement/event-core/coverage").EventCoreCoverage;
  /**
   * `event-core-uncovered`: audit fallback; `chronology-exact`: coordinated fallback;
   * `measured-divergence`: measured lane fell back to exact after a failed post-jump check.
   */
  fallbackReason?: "analytic-horizon-cap" | "event-core-uncovered" | "chronology-exact" | "measured-divergence";
  /** Actual multi-island policy that replayed this island. */
  chronology: OfflineChronology;
  /** Common slice length of a coordinated replay; absent for the sequential order. */
  chronologySliceSeconds?: number;
  fixedTicks: number;
  gameSeconds: number;
  islandId: number | null;
  /** Measured post-jump verification counters; absent outside the measured lane. */
  measured?: MeasuredMetrics;
  /** Actual mode: `exact` once a measured skip failed verification. */
  mode: OfflineCatchUpMode;
  /** Provably quiet fixed ticks skipped by the opt-in Phase A2 path (0 otherwise). */
  quietSkips: number;
  quietTicks: number;
  /** Opt-in movement-prototype skips: chunks and whole fixed ticks skipped for the corridor walker. */
  movementSkips: number;
  movementTicks: number;
  /** Fast-forward segments and per-actor movement ticks inside those skipped fixed ticks. */
  movementActorTicks: number;
  movementSegments: number;
  /** Guard/segmentation counters and diagnostic timers for the opt-in movement prototype. */
  movementWork: Record<string, number>;
  requestedMode: OfflineCatchUpMode;
  skippedSeconds: number;
  traffic: Record<string, number>;
  wallMs: number;
  work: Record<string, number>;
}

type Player = ReturnType<typeof createPlayerSession>;

/** A released colony, returning troops and rewards waiting at home reach the replayed home island. */
const receiveHomeArrivals = (simulation: SettlementSimulation, group: Archipelago) => {
  const pending = (group.released ?? []).filter(id => !simulation.releaseColony(id));
  if (group.returning?.length) simulation.receiveTroops(group.returning);
  if (group.rewards && simulation.sendVisitorShip(group.rewards, [], "reward") === null)
    addToHome(simulation.buildings(), group.rewards);
  group.released = pending.length ? pending : undefined;
  group.returning = undefined; group.rewards = undefined;
};

/** Files colony/adventure status changes into the archipelago and the player's progress. */
const createStatusTracker = (simulation: SettlementSimulation, player: Player, replay: OfflineIslandReplay) => {
  const { archipelago: group, islandId } = replay;
  let colonyStatus = simulation.colony()?.status, adventureStatus = simulation.adventure()?.status;
  let colonyExpiresAt = Infinity;
  const fileColony = () => {
    const colony = simulation.colony();
    if (group && colony && islandId !== null) Object.assign(group, updateColonyStatus(group, islandId,
      colony.status, colony.conqueredAt, simulation.talentModifiers().colonyShipIntervalReduction));
  };
  const fileAdventure = () => {
    const adventure = simulation.adventure();
    if (group && adventure && islandId !== null)
      Object.assign(group, updateAdventureStatus(group, islandId, adventure.status));
  };
  const checkColony = () => {
    const colony = simulation.colony();
    if (colony?.status !== colonyStatus) {
      if (colony?.status === "conquered" && colonyStatus === "contested")
        player.colonyConquered(colony.island.difficulty);
      fileColony();
      colonyStatus = colony?.status;
    }
    if (colony?.status === "conquered" && colony.conqueredAt !== undefined)
      colonyExpiresAt = colony.conqueredAt + COLONY_LIFETIME_MS;
  };
  const checkAdventure = () => {
    const adventure = simulation.adventure();
    if (adventure?.status === adventureStatus) return;
    if (adventure?.status === "won" && adventureStatus === "contested") player.adventureWon(adventure.island);
    fileAdventure();
    adventureStatus = adventure?.status;
  };
  const check = () => { checkColony(); checkAdventure(); };
  return { check, colonyExpiresAt: () => colonyExpiresAt, file: () => { fileColony(); fileAdventure(); } };
};

/** Arrived expeditions become archived colony or adventure records. */
const fileExpeditions = (simulation: SettlementSimulation, group: Archipelago) => {
  for (const expedition of simulation.colonyExpeditions()) {
    if (group.released?.includes(expedition.id)) continue;
    const landing = expedition.status === "arrived" ? simulation.colonyLanding(expedition.id) : undefined;
    if (!landing) continue;
    Object.assign(group, isAdventureIsland(expedition.island)
      ? addAdventureRecord(group, expedition.id, expedition.island, landing)
      : addColonyRecord(group, expedition.id, expedition.island, landing));
  }
};

type Loaded = Awaited<ReturnType<typeof stageGameSession>>;
type Runtime = ReturnType<typeof createOfflineIslandRuntime>;

/** The island's simulation with the offline resource managers and the archipelago's callbacks. */
const createReplaySimulation = (
  loaded: Loaded, runtime: Runtime, player: Player, group: Archipelago | undefined, clockStart: number,
  catchUp: () => OfflineCatchUp | undefined, eventCore: boolean, eventCoreEnabled: () => boolean,
  onSchedulerPhase: (phase: "population" | "stone", dt: number) => void,
  onEventCoreOwns: (actor: { uid: number; phase: string }, lane: import("../../shared/settlement/settlement-types").EventCoreActorLane) => boolean,
  liveHomeBuildings?: () => SettlementBuilding[] | undefined,
  onWorkerPhase?: (actor: { uid: number; phase: string; timer: number }) => void,
  corridorReservations?: boolean,
  eventMovement?: boolean,
  movementSkipGuard?: "prototype" | "segmented",
  observeCycle?: (building: SettlementBuilding, consumed: Readonly<Goods>, output: string | undefined, tick: number) => void,
  observeProduced?: (ware: string, tick: number) => void,
  observeWait?: (building: SettlementBuilding, seconds: number, tick: number, reason: "inputs" | "output") => void
) => {
  const { world } = loaded.map;
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, ...runtime.hooks,
    restoredHome: loaded.settlement.buildings.find(isHomeBuilding),
    ...colonySettlementOptions(loaded, null), clockStart,
    onSchedulerPhase,
    onWorkerPhase,
    eventCoreOwns: onEventCoreOwns,
    corridorReservations,
    eventMovement,
    movementSkipGuard,
    tickMask: {
      animationTime: true,
      doorActivity: true,
      ...(eventCore ? {
        builderContacts: eventCoreEnabled, fieldGrowth: eventCoreEnabled, fishing: eventCoreEnabled,
        foresterPlant: eventCoreEnabled, huntAim: eventCoreEnabled, huntFlight: eventCoreEnabled,
        huntWait: eventCoreEnabled, populationGrowth: eventCoreEnabled, productionWork: eventCoreEnabled,
        stoneRespawns: eventCoreEnabled, treeGrowth: eventCoreEnabled
      } : {})
    },
    stockContact: createIslandStockContacts(world, (x, z) => simulation?.isOccupied(x, z) ?? false,
      building => simulation?.buildingNation(building)),
    canWorkerEnterPlot: (building, point) => building.construction < 1 || isBuildingCourtyardPointWalkable(
      building.typeId, building.x, building.z, building.rotation, point, building.output, building.input,
      stockStyleFor(simulation?.buildingNation(building), building)),
    onVisitorLoaded: goods => {
      const home = liveHomeBuildings?.() ?? (group?.home && savedStorageBuildings(group.home.settlement));
      if (home) addToHome(home, goods);
    },
    onTroopsReturned: troops => { if (group) group.returning = [...group.returning ?? [], ...troops]; },
    onProduced: ware => {
      player.produced(ware); catchUp()?.produced(ware);
      observeProduced?.(ware, simulation!.gameTick());
    },
    onProductionCycle: (building, consumed, output) => {
      catchUp()?.cycle(building, consumed, output);
      observeCycle?.(building, consumed, output, simulation!.gameTick());
    },
    onProductionWait: observeWait && ((building, seconds, reason) =>
      observeWait(building, seconds, simulation!.gameTick(), reason)),
    onBuildingCompleted: building => player.buildingCompleted(building),
    onBuildingDemolished: building => {
      runtime.hooks.onBuildingDemolished?.(building);
      player.buildingRemoved();
    },
    onTutorialEvent: (key, amount) => player.tutorialEvent(key, amount) });
  const result = simulation.loadState(loaded.settlement);
  if (!result.ok) throw new Error(result.reason);
  // Offline catch-up (client guest and server bundle alike): no script events, frozen script clock (design §7.4),
  // frozen economy AI decisions (enemy economy AI plan §5.3 v1; one decision pass on the first live tick).
  simulation.setScriptMode("catchUp");
  simulation.setFactionAiFrozen(true);
  player.bind(simulation);
  return simulation;
};

export interface OfflineIslandSession {
  advance: (seconds: number) => Promise<number>;
  save: (now: number) => Promise<GameSaveV1>;
  simulation: SettlementSimulation;
  player: Player;
  group: Archipelago | undefined;
}

/** Opens one island replay so a coordinator can advance it without staging the save again. */
export const createOfflineIslandSession = async (
  source: GameSaveV1, replay: OfflineIslandReplay
): Promise<OfflineIslandSession> => {
  const { archipelago: group, islandId, seconds: horizon, start } = replay;
  const loaded = await stageGameSession(source), { world } = loaded.map;
  const eventCoreRequested = replay.eventCore === true || replay.eventCore === "auto";
  let eventCoreActive = eventCoreRequested;
  let eventPlan: ReturnType<typeof createEventCorePlan> | undefined;
  const runtime = createOfflineIslandRuntime(loaded, { treeGrowthMasked: () => eventCoreActive });
  let elapsed = 0, fast: OfflineCatchUp | undefined;
  // The island's game clock runs from the save time; skipped stretches advance it in whole ticks.
  let gameNow = () => start;
  const player = createPlayerSession({ initial: source.player, nation: loaded.settlement.playerNation,
    now: () => gameNow(), seed: world.seed, store: replay.playerStore });
  let schedulerPhase: ((phase: "population" | "stone", dt: number) => void) | undefined;
  let workerPhase: ((actor: { uid: number; phase: string; timer: number }) => void) | undefined;
  const simulation = createReplaySimulation(loaded, runtime, player, group, start, () => fast,
    eventCoreRequested, () => eventCoreActive,
    (phase, dt) => schedulerPhase?.(phase, dt),
    (actor, lane) => eventCoreActive && eventPlan?.owns(actor, lane) === true,
    replay.liveHomeBuildings, actor => workerPhase?.(actor),
    replay.corridorReservations, replay.eventMovement, replay.movementSkipGuard,
    (building, consumed, output, tick) => replay.onProductionCycle?.(islandId, building, consumed, output, tick),
    (ware, tick) => replay.onProduced?.(islandId, ware, tick),
    replay.onProductionWait && ((building, seconds, tick, reason) =>
      replay.onProductionWait!(islandId, building, seconds, tick, reason)));
  eventPlan = eventCoreRequested ? createEventCorePlan(simulation, runtime) : undefined;
  const initialCoverage = eventPlan?.audit();
  // The event core never masks an island whose active timers the plan cannot prove it owns. This
  // applies to explicit `eventCore: true` as well as `"auto"`; the exact fixed lane is the fallback.
  if (eventPlan && (!initialCoverage || !initialCoverage.covered)) eventCoreActive = false;
  schedulerPhase = eventCoreActive ? eventPlan?.onScheduler : undefined;
  workerPhase = eventCoreActive ? eventPlan?.onWorkerPhase : undefined;
  const startedAt = performance.now();
  const startTraffic = snapshotTrafficWork();
  const startWork = { ...simulation.workCounters() };
  const startMovement = snapshotMovementSkipWork();
  let fixedTicks = 0, skippedSeconds = 0, quietSkips = 0, quietTicks = 0;
  let movementSkips = 0, movementTicks = 0;
  gameNow = simulation.gameNow;
  if (group && islandId === null) receiveHomeArrivals(simulation, group);
  const status = createStatusTracker(simulation, player, replay);
  // The home island itself is replayed, so its abstract hourly ore estimate must not run as well.
  const economy = group && islandId !== null ? createColonyEconomy({ simulation,
    group: () => ({ ...group, active: islandId }),
    homeBuildings: replay.liveHomeBuildings,
    homeSettlement: replay.liveHomeSettlement,
    setGroup: next => Object.assign(group, next, { active: group.active }),
    notify: () => {}, now: gameNow }) : undefined;
  const oreShipAt = () => (economy && group && findColony(group, islandId)?.nextOreShipAt) ?? Infinity;
  const mode = replay.mode === "analytic" && horizon > ANALYTIC_MAX_SECONDS ? "measured" : replay.mode;
  const requestedMode = replay.requestedMode ?? replay.mode;
  const eventCoreFallbackReason = eventCoreRequested && !eventCoreActive
    ? "event-core-uncovered" as const : undefined;
  const fallbackReason = (() => {
    if (eventCoreFallbackReason) return eventCoreFallbackReason;
    if (replay.mode === "analytic" && mode !== "analytic") return "analytic-horizon-cap" as const;
    if (replay.chronology === "coordinated" && requestedMode !== mode) return "chronology-exact" as const;
    return undefined;
  })();
  // Quiet skip never combines with the event core or a colony economy: those own their own timers.
  const quietMode = replay.quietSkip === true && mode === "exact" && !eventCoreRequested && !economy;
  // The prototype is proven on the plain exact lane only; executor/corridor options are not combined.
  const movementMode = replay.movementSkip === true && mode === "exact" && !eventCoreRequested && !economy &&
    !replay.corridorReservations && !replay.eventMovement;
  fast = createOfflineCatchUp(mode, {
    canHarvestTree: id => runtime.hooks.canHarvestTree?.(id) ?? false,
    enemyCampsBlockJumps: replay.enemyCampsBlockJumps, exactBudgetSeconds: replay.exactBudgetSeconds,
    fellTrees: runtime.fellTrees, livingAnimals: runtime.livingAnimals,
    homeBuildings: () => islandId === null ? undefined :
      (replay.liveHomeBuildings?.() ?? (group?.home && savedStorageBuildings(group.home.settlement))),
    horizon: () => (Math.min(status.colonyExpiresAt(), oreShipAt()) - gameNow()) / 1000,
    onOreChanged: runtime.hooks.onOreChanged, produced: player.produced, simulation, world });
  fast?.start();
  const windowSeconds = fast?.windowSeconds ?? Infinity;
  let nextReport = performance.now() + REPORT_MS, nextLeaseCheck = 0, nextWindow = windowSeconds;
  // Whole ticks bound the replay, so the island's clock ends exactly `horizon` after the start.
  const totalTicks = Math.floor(horizon / OFFLINE_STEP + 1e-6);
  let replayedTicks = 0;
  const closeWindow = () => {
    const skipped = fast?.windowEnd(elapsed, horizon - elapsed) ?? 0;
    if (skipped) {
      skippedSeconds += skipped;
      const ticks = ticksForSeconds(skipped);
      elapsed += skipped; replayedTicks += ticks; simulation.advanceClock(ticks);
      runtime.jumpTo(tickSeconds(simulation.gameTick())); replay.onSkip?.(skipped);
    }
    nextWindow = elapsed + windowSeconds;
  };
  /** One fixed tick of the island and its resource managers; returns the new elapsed time. */
  const tick = () => {
    const next = elapsed + OFFLINE_STEP;
    fixedTicks++;
    if (eventCoreActive) eventPlan?.beforeTick();
    simulation.update(OFFLINE_STEP);
    if (eventCoreActive) eventPlan?.afterTick();
    economy?.update(OFFLINE_STEP);
    fast?.ticked(next, OFFLINE_STEP);
    replayedTicks++;
    return next;
  };
  /**
   * Skips one bounded stretch only after a fixed tick has settled load-time road/ground work and the
   * simulation's guard proves every remaining fixed-tick effect is clock/runtime/timer residue.
   * Returns false to let the loop run an exact tick (the conservative fallback).
   */
  const quietAdvance = (target: number) => {
    if (!quietMode || fixedTicks === 0) return false;
    const targetTicks = Math.floor((target - elapsed) / OFFLINE_STEP + 1e-9);
    const ticks = Math.min(totalTicks - replayedTicks, targetTicks,
      Math.floor(QUIET_SKIP_CHUNK_SECONDS / OFFLINE_STEP + 1e-9));
    if (ticks <= 0) return false;
    if (!simulation.advanceQuietTicks(ticks)) return false;
    const seconds = ticks * OFFLINE_STEP;
    elapsed += seconds;
    replayedTicks += ticks;
    quietSkips++;
    quietTicks += ticks;
    skippedSeconds += seconds;
    replay.onSkip?.(seconds);
    return true;
  };
  /**
   * Skips whole fixed ticks for the guarded corridor walker. The simulation keeps the clock,
   * accumulator, scheduling, transient clocks, runtime lane and the exact actor pipeline; the
   * full tick's other systems are skipped only because the guard proves them no-ops. Returns
   * false to let the loop run a normal tick (the boundary or any failed guard).
   */
  const movementAdvance = (target: number) => {
    if (!movementMode || fixedTicks === 0) return false;
    const targetTicks = Math.floor((target - elapsed) / OFFLINE_STEP + 1e-9);
    const ticks = Math.min(totalTicks - replayedTicks, targetTicks,
      Math.floor(MOVEMENT_SKIP_CHUNK_SECONDS / OFFLINE_STEP + 1e-9));
    if (ticks <= 0) return false;
    const skipped = simulation.advanceMovementSkipTicks(ticks);
    if (!skipped) return false;
    const seconds = skipped * OFFLINE_STEP;
    elapsed += seconds;
    replayedTicks += skipped;
    movementSkips++;
    movementTicks += skipped;
    skippedSeconds += seconds;
    replay.onSkip?.(seconds);
    return true;
  };
  const advance = async (seconds: number) => {
    const target = Math.min(horizon, elapsed + Math.max(0, seconds));
    while (replayedTicks < totalTicks && elapsed < target) {
      if (elapsed >= nextLeaseCheck) { status.check(); nextLeaseCheck = elapsed + 1; }
      if (gameNow() >= status.colonyExpiresAt()) break;
      if (movementAdvance(target)) {
        if (performance.now() < nextReport) continue;
        replay.report(elapsed);
        await new Promise(resolve => setTimeout(resolve, 0));
        nextReport = performance.now() + REPORT_MS;
        continue;
      }
      if (quietAdvance(target)) {
        if (performance.now() < nextReport) continue;
        replay.report(elapsed);
        await new Promise(resolve => setTimeout(resolve, 0));
        nextReport = performance.now() + REPORT_MS;
        continue;
      }
      elapsed = tick();
      if (elapsed >= nextWindow) closeWindow();
      if (performance.now() < nextReport) continue;
      replay.report(elapsed);
      await new Promise(resolve => setTimeout(resolve, 0));
      nextReport = performance.now() + REPORT_MS;
    }
    return elapsed;
  };
  const save = async (now: number) => {
    if (group) { status.file(); fileExpeditions(simulation, group); }
    const eventCoreCoverage = eventPlan?.audit();
    if (eventCoreActive) eventPlan?.settle();
    const endTraffic = snapshotTrafficWork();
    const endWork = { ...simulation.workCounters() };
    const endMovement = snapshotMovementSkipWork();
    const delta = (start: Record<string, number>, end: Record<string, number>) =>
      Object.fromEntries(Object.entries(end).map(([key, value]) => [key, value - (start[key] ?? 0)]));
    const measured = fast?.measuredMetrics?.();
    const measuredFallback = fast?.fallbackReason?.();
    replay.onMetrics?.({
      eventCore: eventCoreActive ? eventPlan?.metrics() : undefined,
      eventCoreCoverage,
      eventCoreCoverageInitial: initialCoverage,
      fallbackReason: fallbackReason ?? measuredFallback,
      chronology: replay.chronology ?? "sequential",
      chronologySliceSeconds: replay.chronologySliceSeconds,
      fixedTicks,
      gameSeconds: elapsed,
      islandId: replay.islandId,
      measured,
      mode: measuredFallback ? "exact" : mode,
      movementSkips,
      movementTicks,
      movementActorTicks: endMovement.actorTicks - startMovement.actorTicks,
      movementSegments: endMovement.segments - startMovement.segments,
      movementWork: delta(startMovement, endMovement),
      quietSkips,
      quietTicks,
      requestedMode,
      skippedSeconds,
      traffic: delta(startTraffic, endTraffic),
      wallMs: performance.now() - startedAt,
      work: delta(startWork, endWork)
    });
    // The saved island resumes live; a session advanced again after a save stays in catch-up.
    simulation.endScriptCatchUp();
    const settlement = simulation.saveState();
    simulation.setScriptMode("catchUp");
    const saved = await createGameSave(world, settlement, { ...loaded.map.meta,
      animals: loaded.map.animals, terrain: loaded.map.terrain, savedAt: now }, runtime.save());
    return { ...saved, player: player.progress() };
  };
  return { advance, group, player, save, simulation };
};

/** Replays one saved island for `seconds` with the live rules: real ticks, or measured steady skips. */
export const advanceIsland = async (source: GameSaveV1, replay: OfflineIslandReplay) => {
  const session = await createOfflineIslandSession(source, replay);
  await session.advance(replay.seconds);
  return session.save(replay.now);
};
