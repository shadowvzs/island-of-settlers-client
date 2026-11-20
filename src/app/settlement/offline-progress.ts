import { OFFLINE_CATCH_UP_CAP_SECONDS } from "../../shared/balance/offline";
import {
  advanceAroundCampaignRun, campaignHomeGame, isHomelessRun, withCampaignRunOnScreen
} from "../../shared/campaign/campaign-run-game";
import { type Archipelago, deferOreShips, expireColony, expiredColonies } from "../../shared/settlement/archipelago";
import { applyReturnedColonyRelief, pendingColonyRelief } from "../../shared/settlement/archipelago-relief";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import {
  type DetachedIslands, detachSkippedIslands, fileSkippedOnScreen, onScreenSkipsCatchUp, rebaseSaveClock,
  rejoinSkippedIslands, returnSkippedOnScreen
} from "./catch-up-skip";
import type { OfflineCatchUpMode, OfflineChronology } from "./offline-catch-up";
import { advanceOfflineEconomyGame, type OfflineEconomyMetrics } from "./offline-economy";
import {
  advanceIsland, createOfflineIslandSession, OFFLINE_STEP, type OfflineIslandMetrics,
  type OfflineProductionObserver, type OfflineProductionWaitObserver
} from "./offline-island-replay";
import { shouldUseOfflineEconomy } from "./offline-replay-policy";

export interface OfflineProgress { completedSeconds: number; totalSeconds: number }

/**
 * The serializable replay switches of the offline catch-up. Server catch-up and the browser worker
 * transport this shape between processes, so it must stay free of callbacks; the server bundle and
 * the api mirror it (island-of-settlers-api/src/catch-up-replay.ts).
 */
export interface OfflineReplayFlags {
  /** Diagnostic override only; normal startup uses fast economy for every positive gap. */
  economy?: boolean;
  /** Diagnostic native prefix; default zero. Explicit120 retains the older comparison setup. */
  economyCalibrationSeconds?: number;
  /**
   * Multi-island replay order. Omitted: an exact-family lane (the default exact lane, `exact`,
   * `eventCore`, executor flags or the quiet/movement skip prototypes) defaults to coordinated
   * chronological slices when a save has an archipelago; the explicit measured and analytic lanes
   * stay on the legacy sequential home-first order. `false` forces sequential for every lane. `true`
   * requests coordination; the coordinator runs exact ticks, so a measured/analytic request falls
   * back to exact and reports `chronology-exact`.
   */
  chronological?: boolean;
  /**
   * Slice length for the chronological coordinator; smaller withholds less home production from
   * consumers, larger is faster. The no-future-goods order holds at any slice length.
   */
  chronologySliceSeconds?: number;
  /** Opt-in corridor gate and quiet-corridor movement executor for offline experiments. */
  corridorReservations?: boolean;
  /**
   * Phase A: field/tree/population/stone/hunter-wait timers are event-owned. `"auto"` runs only when
   * the coverage audit proves every active masked timer is owned, and falls back to exact otherwise.
   */
  eventCore?: boolean | "auto";
  /** Run event core on the exact lane only where the coverage audit proves it. Defaults on for exact. */
  eventCoreAuto?: boolean;
  /** Opt-in movement executor (with `corridorReservations`); forces the exact replay lane. */
  eventMovement?: boolean;
  /** Replay every fixed tick (reference and comparison runs); slow for long absences. */
  exact?: boolean;
  /**
   * Opt-in measured steady-skip replay. This lane is experimental and not exact: its guard can stop
   * later skips after divergence, but it cannot repair a skip already applied. Default false; exact
   * fixed ticks handle short production gaps and explicit reference requests.
   */
  measured?: boolean;
  /**
   * Opt-in movement prototype: skip whole fixed ticks for one guarded straight-corridor walker
   * (forces the exact replay lane). Default false; save format unchanged.
   */
  movementSkip?: boolean;
  /**
   * Experimental guard selector for `movementSkip` only: absent/`prototype` keeps the original
   * whole-route per-tick guard; `segmented` is the D6 cheaper bounded guard. No effect unless
   * `movementSkip` is true.
   */
  movementSkipGuard?: "prototype" | "segmented";
  /** Opt-in Phase A2: skip provably quiet fixed ticks exactly (forces the exact replay lane). */
  quietSkip?: boolean;
}

export interface OfflineReplayOptions extends OfflineReplayFlags {
  /**
   * Opt-in analytic chain jumps (part 2), limited to absences up to one hour; longer absences use
   * measured skips because the model still drifts (see docs/plans/offline-catch-up-strategy-2026-10-22.md).
   */
  analytic?: boolean;
  /**
   * Old rule: any hostile soldier on an island, even in an idle enemy camp, keeps it in real ticks.
   * Default false: only fights (soldier count or health changing) do, so an attack that starts inside
   * an analytic jump is not simulated.
   */
  enemyCampsBlockJumps?: boolean;
  /**
   * Real ticked game seconds a measured catch-up aims to spend, shared by its islands. Steady stretches
   * beyond it are skipped in larger measured multiples; elapsed time is never dropped.
   */
  exactBudgetSeconds?: number;
  /** Diagnostics: game seconds each analytic jump covered. */
  onSkip?: (seconds: number) => void;
  /** Diagnostics: per-island simulation wall time and fixed/event work. */
  onIslandMetrics?: (metrics: OfflineIslandMetrics) => void;
  /** Read-only gross-production instrumentation; never transported as a server replay flag. */
  onProductionCycle?: OfflineProductionObserver;
  onProductionWait?: OfflineProductionWaitObserver;
  /** The ordinary onProduced bookkeeping event, counted without replacing its callback. */
  onProduced?: (islandId: number | null, ware: string, tick: number) => void;
  onEconomyMetrics?: (metrics: OfflineEconomyMetrics) => void;
}

/** Never award negative time when a clock moves back. A save is the single replay cursor. */
export const offlineSeconds = (savedAt: number, now: number) =>
  Number.isFinite(savedAt) && Number.isFinite(now) ? Math.max(0, (now - savedAt) / 1000) : 0;

/**
 * One island's catch-up window, from its own filed save time (review R3, C2a): the island just left is
 * filed at the switch, so it must not replay the time it was played live again. Capped like every replay.
 */
export const islandCatchUpSeconds = (savedAt: number, now: number, cap = OFFLINE_CATCH_UP_CAP_SECONDS) =>
  Math.min(offlineSeconds(savedAt, now), cap);

/** What a discarded catch-up changed: the committed clock and the calendar deadlines it crossed. */
export interface OfflineSkipResult {
  /** Real seconds between the last committed save and the new clock (0: nothing to discard). */
  awaySeconds: number;
  /** Colonies that ended on the new clock; their normal expiry effects are already applied. */
  endedColonies: string[];
  save: GameSaveV1;
}

/** Filed islands keep their state, but their replay cursor moves with the skipped interval. */
const rebaseArchipelagoClocks = (group: Archipelago, now: number): Archipelago => ({
  ...group,
  ...(group.home ? { home: rebaseSaveClock(group.home, now) } : {}),
  colonies: group.colonies.map(colony => colony.save
    ? { ...colony, save: rebaseSaveClock(colony.save, now) } : colony),
  ...(group.adventures ? { adventures: group.adventures.map(adventure => adventure.save
    ? { ...adventure, save: rebaseSaveClock(adventure.save, now) } : adventure) } : {})
});

/**
 * D15 "Skip waiting and discard offline progress": commit a new state at real `now` without replaying
 * production. Simulation state is untouched; the replay cursors of the current and every filed island
 * move to `now`, so the same interval cannot be caught up again. Calendar deadlines still age:
 * colonies that ended are released with their normal expiry effects, and missed colony ore-ship hours
 * are deferred. Trade offers, evacuations and daily quests use absolute times, so their normal
 * cleanup runs from the first tick at `now`.
 */
const skipOfflineIslands = (source: GameSaveV1, now: number): OfflineSkipResult => {
  const away = offlineSeconds(source.savedAt, now);
  if (away < OFFLINE_STEP) return { awaySeconds: 0, endedColonies: [], save: source };
  if (!source.archipelago)
    return { awaySeconds: away, endedColonies: [], save: rebaseSaveClock(source, now) };
  const group = structuredClone(source.archipelago);
  const endedColonies = expiredColonies(group, now).map(colony => colony.island.name);
  const rebased = rebaseArchipelagoClocks(deferOreShips(group, Math.round(away * 1000)), now);
  const active = rebased.active ?? null;
  const { current, group: expired, returnedRelief } = expireColonies(rebased, source, active, now);
  return {
    awaySeconds: away,
    endedColonies,
    save: { ...current, archipelago: expired, player: applyReturnedColonyRelief(source.player, returnedRelief), savedAt: now }
  };
};

/** A campaign session discards only home's and the colonies' time away; the run keeps its own clock (C2). */
export const skipOfflineProgress = (source: GameSaveV1, now: number): OfflineSkipResult => {
  if (!source.campaignRun) return skipOfflineIslands(source, now);
  if (isHomelessRun(source)) return { awaySeconds: 0, endedColonies: [], save: source };
  const home = campaignHomeGame(source), skipped = skipOfflineIslands(home, now);
  return { ...skipped, save: skipped.save === home ? source : withCampaignRunOnScreen(skipped.save, source) };
};

/** About half a minute of real ticks on a developed island (Node, 2026-10-21 measurement). */
const OFFLINE_EXACT_BUDGET_SECONDS = 1800;

/**
 * Native replay handles explicit diagnostic requests only. Measured skips are an experimental opt-in
 * (`measured: true`), analytic jumps stay explicit, and any explicit exact-family switch wins over
 * measured. Measured is provisional and not exact; exact is the reference/accuracy lane.
 */
const catchUpMode = (options: OfflineReplayOptions, eventCore: boolean | "auto" | undefined): OfflineCatchUpMode => {
  if (options.exact || eventCore || options.quietSkip || options.movementSkip ||
    options.corridorReservations || options.eventMovement) return "exact";
  if (options.analytic) return "analytic";
  return options.measured === true ? "measured" : "exact";
};

/**
 * The exact lane defaults to event core only where the audit can prove coverage; an explicit
 * `eventCore: false` opts out. Executor, chronological, quiet-skip and measured/analytic lanes are
 * never auto-upgraded to event core.
 */
const requestedEventCore = (options: OfflineReplayOptions): boolean | "auto" | undefined => {
  const conflicting = options.quietSkip || options.movementSkip || options.corridorReservations ||
    options.eventMovement || options.chronological || options.analytic;
  if (options.eventCore === "auto" && conflicting) return undefined;
  // An explicit event-core request (including "auto") keeps the exact lane even when `measured` is
  // also present; only an omitted request lets the explicit measured opt-in win.
  if (options.eventCore !== undefined) return options.eventCore;
  if (options.eventCoreAuto !== false && !conflicting && options.measured !== true &&
    catchUpMode(options, undefined) === "exact") return "auto";
  return undefined;
};

/** The lanes whose simulation is already exact; the executor prototypes are exact-only by contract. */
const exactFamily = (options: OfflineReplayOptions) => {
  const eventCore = requestedEventCore(options);
  return catchUpMode(options, eventCore) === "exact" ||
    options.corridorReservations === true || options.eventMovement === true;
};

/**
 * The exact-family lanes (including the default exact lane with no mode flag) are safe to coordinate
 * because the coordinator advances resumable sessions with exact fixed ticks; only the inter-island
 * order changes. Explicit measured/analytic windows stay sequential by default: their per-island skip
 * decisions are local and may leap past a common slice, so they cannot yet share live home stock
 * without one island consuming goods produced later.
 */
export const chronologyPolicy = (
  source: GameSaveV1, options: OfflineReplayOptions = {}
): OfflineChronology => {
  if (!source.archipelago) return "sequential";
  if (options.chronological === false) return "sequential";
  if (options.chronological === true) return "coordinated";
  return exactFamily(options) ? "coordinated" : "sequential";
};

type Advance = (save: GameSaveV1, islandId: number | null) => Promise<GameSaveV1>;

/** Saved colonies and adventures other than the island on screen: they are replayed as well. */
const archivedIslands = (group: Archipelago | undefined, active: number | null) => ({
  adventures: group?.adventures?.filter(adventure => adventure.save && adventure.expeditionId !== active) ?? [],
  colonies: group?.colonies.filter(colony => colony.save && colony.expeditionId !== active) ?? []
});

/** Every save a catch-up replays: the island on screen, the filed home and the archived islands. */
const catchUpSaves = (
  source: GameSaveV1, group: Archipelago | undefined, archived: ReturnType<typeof archivedIslands>
) => [
  source,
  ...(group?.active !== null && group?.home ? [group.home] : []),
  ...archived.colonies.map(colony => colony.save!),
  ...archived.adventures.map(adventure => adventure.save!)
];
const totalCatchUpSeconds = (saves: readonly GameSaveV1[], now: number) =>
  saves.reduce((sum, save) => sum + islandCatchUpSeconds(save.savedAt, now), 0);

/** The archived home first (colony supply ships consume its real replayed stock), then the others. */
const advanceArchived = async (
  group: Archipelago, current: GameSaveV1 | undefined, archived: ReturnType<typeof archivedIslands>, advance: Advance
) => {
  if (current) group.home = current;
  else if (group.home) group.home = await advance(group.home, null);
  for (const colony of archived.colonies) {
    const next = await advance(colony.save!, colony.expeditionId);
    group.colonies.find(entry => entry.expeditionId === colony.expeditionId)!.save = next;
  }
  for (const adventure of archived.adventures) {
    const next = await advance(adventure.save!, adventure.expeditionId);
    group.adventures!.find(entry => entry.expeditionId === adventure.expeditionId)!.save = next;
  }
};

/** Expired colonies are freed; when the one on screen expired, the player is back home. */
export const expireColonies = (group: Archipelago, current: GameSaveV1, active: number | null, now: number) => {
  const returnedRelief: ReturnType<typeof pendingColonyRelief> = [];
  for (const colony of expiredColonies(group, now)) {
    if (colony.expeditionId === active) colony.save = current;
    returnedRelief.push(...pendingColonyRelief(colony.save));
    group = expireColony(group, colony, now);
    if (colony.expeditionId === active && group.home) {
      current = group.home; group.active = null; group.home = undefined;
    }
  }
  // A home island on screen must not also survive as an archived duplicate.
  if (active === null && group.home) { current = group.home; group.home = undefined; }
  return { current, group, returnedRelief };
};

/**
 * Replays every saved island with maintained fast economy for every positive gap by default.
 * Native/exact remains an explicit isolated diagnostic reference, never a startup duration branch.
 * `measured` (explicit experimental opt-in) repeats real-tick steady flows over whole skipped
 * multiples until an event needs real ticks again. `analytic` (opt-in) measures each production chain
 * once and integrates the rest between events; docs/archive/dated/offline-progress-algorithm-2026-10-22.md compares
 * the approaches.
 */
export const advanceOfflineGame = (
  source: GameSaveV1, now: number, report: (progress: OfflineProgress) => void = () => {},
  options: OfflineReplayOptions = {}
): Promise<GameSaveV1> =>
  // A campaign run on screen never catches up (C2): only home and the filed islands replay their time away.
  advanceAroundCampaignRun(source, home =>
    advanceAroundSkippedIslands(home, now, game => advanceOfflineIslands(game, now, report, options)));

/**
 * The skipped islands back after the replay; their calendar ages as in the whole-save skip: a colony past its
 * lifetime ends with its normal expiry effects (relief and troops go home).
 */
const rejoinAndExpire = (advanced: GameSaveV1, original: Archipelago, detached: DetachedIslands, now: number) => {
  const group = rejoinSkippedIslands(advanced.archipelago ?? detached.group, original, detached);
  const active = group.active ?? null;
  const { current, group: expired, returnedRelief } = expireColonies(group, advanced, active, now);
  return { ...current, archipelago: expired, player: applyReturnedColonyRelief(advanced.player, returnedRelief) };
};

/**
 * Per-island skip (plan §10, RULES1 scope; client and server bundle alike): non-home islands whose map (or pin)
 * skips leave the replay, gain nothing and their cursors move to `now`. A skipping island on screen is filed while
 * home and the other islands replay, then returns on screen; without a filed home nothing else replays, so it all
 * skips. Without a skipping island the replay runs on the unchanged save.
 */
const advanceAroundSkippedIslands = async (
  source: GameSaveV1, now: number, advance: (game: GameSaveV1) => Promise<GameSaveV1>
): Promise<GameSaveV1> => {
  if (!source.archipelago) return advance(source);
  const onScreen = await onScreenSkipsCatchUp(source, now);
  const game = onScreen ? fileSkippedOnScreen(source) : source;
  if (!game) return skipOfflineIslands(source, now).save;
  const group = game.archipelago!;
  const detached = await detachSkippedIslands(group, now, onScreen ? source.archipelago.active : null);
  if (!detached) return advance(game);
  const advanced = await advance({ ...game, archipelago: detached.group });
  const rejoined = rejoinAndExpire(advanced, group, detached, now);
  return onScreen ? returnSkippedOnScreen(rejoined, source) : rejoined;
};

const advanceOfflineIslands = async (
  source: GameSaveV1, now: number, report: (progress: OfflineProgress) => void, options: OfflineReplayOptions
): Promise<GameSaveV1> => {
  if (shouldUseOfflineEconomy(offlineSeconds(source.savedAt, now), options))
    return advanceOfflineEconomyGame(source, now, report, options);
  if (chronologyPolicy(source, options) === "coordinated")
    return advanceOfflineChronological(source, now, report, options);
  const away = offlineSeconds(source.savedAt, now);
  if (away < OFFLINE_STEP) return source;
  // Production replays at most the cap; colony lifetimes still age on the real time away.
  const seconds = Math.min(away, OFFLINE_CATCH_UP_CAP_SECONDS);
  const group = source.archipelago ? structuredClone(source.archipelago) : undefined;
  const active = group?.active ?? null, archived = archivedIslands(group, active);
  const eventCore = requestedEventCore(options);
  const mode = catchUpMode(options, eventCore);
  const saves = catchUpSaves(source, group, archived);
  const totalSeconds = totalCatchUpSeconds(saves, now);
  const exactBudgetSeconds = (options.exactBudgetSeconds ?? OFFLINE_EXACT_BUDGET_SECONDS) / saves.length;
  let completed = 0, player = source.player;
  const advance: Advance = async (save, islandId) => {
    const islandSeconds = islandCatchUpSeconds(save.savedAt, now);
    if (islandSeconds < OFFLINE_STEP) return save;
    const next = await advanceIsland({ ...save, player }, { archipelago: group,
      chronology: "sequential", enemyCampsBlockJumps: options.enemyCampsBlockJumps ?? false,
      eventCore, exactBudgetSeconds, islandId, mode, now,
      corridorReservations: options.corridorReservations, eventMovement: options.eventMovement,
      movementSkip: options.movementSkip, movementSkipGuard: options.movementSkipGuard,
      quietSkip: options.quietSkip,
      onMetrics: options.onIslandMetrics, onSkip: options.onSkip, onProductionCycle: options.onProductionCycle,
      onProductionWait: options.onProductionWait,
      onProduced: options.onProduced,
      report: elapsed => report({ completedSeconds: completed + elapsed, totalSeconds }),
      seconds: islandSeconds, start: save.savedAt });
    completed += islandSeconds; player = next.player; return next;
  };
  let current = active === null ? await advance(source, null) : undefined;
  if (group) await advanceArchived(group, current, archived, advance);
  current ??= await advance(source, active);
  const capped = group && away > seconds ? deferOreShips(group, Math.round((away - seconds) * 1000)) : group;
  const result = capped ? expireColonies(capped, current, active, now) : { current, group: capped };
  report({ completedSeconds: totalSeconds, totalSeconds });
  return { ...result.current, archipelago: result.group, player: applyReturnedColonyRelief(player, "returnedRelief" in result ? result.returnedRelief : []) };
};

/**
 * One common slice of the coordinator. Islands that can read home stock (the island on screen when
 * it is a colony, archived colonies and adventures) advance first, against the home stock committed
 * by the previous slice. The home island advances last, so its production during this slice is
 * committed after every consumer has run and cannot be observed by a consumer in the same slice.
 * Debits still mutate the one live home stock, so goods are neither duplicated nor lost.
 */
const advanceChronologySlice = async (
  home: { advance: (seconds: number) => Promise<number> } | undefined,
  consumers: readonly { advance: (seconds: number) => Promise<number> }[],
  step: number
) => {
  for (const consumer of consumers) await consumer.advance(step);
  await home?.advance(step);
};

/**
 * The default common slice is short so the conservative order withholds at most one second of home
 * production from a consumer decision. The no-future-goods property holds for any slice length.
 */
const CHRONOLOGY_SLICE_SECONDS = 1;

/**
 * Chronological multi-island replay: live sessions advance together in short slices. Consumers run
 * before the home island, so a colony cannot read home stock produced later in the same slice. This
 * is the default for the exact-family lanes; measured/analytic lanes stay sequential because their
 * local skip windows are not yet coordinated.
 */
const advanceOfflineChronological = async (
  source: GameSaveV1, now: number, report: (progress: OfflineProgress) => void,
  options: OfflineReplayOptions
): Promise<GameSaveV1> => {
  const away = offlineSeconds(source.savedAt, now);
  if (away < OFFLINE_STEP) return source;
  const seconds = Math.min(away, OFFLINE_CATCH_UP_CAP_SECONDS);
  const group = structuredClone(source.archipelago!);
  const active = group.active ?? null;
  const archived = archivedIslands(group, active);
  const saves = catchUpSaves(source, group, archived), islandCount = saves.length;
  const totalSeconds = totalCatchUpSeconds(saves, now);
  // Each session replays its own window from its save time; the slices run until the longest ends.
  const horizon = Math.max(...saves.map(save => islandCatchUpSeconds(save.savedAt, now)));
  const exactBudgetSeconds = (options.exactBudgetSeconds ?? OFFLINE_EXACT_BUDGET_SECONDS) / islandCount;
  const sliceSeconds = Math.max(OFFLINE_STEP, options.chronologySliceSeconds ?? CHRONOLOGY_SLICE_SECONDS);
  const requestedMode = catchUpMode(options, requestedEventCore(options));
  // Auto event core is not applied over coordinated chronology; an explicit `eventCore: true` is
  // still audited and each island falls back independently if coverage is incomplete.
  const chronologicalEventCore = options.eventCore === true ? true : undefined;
  let playerProgress = source.player;
  const playerStore = {
    get: () => playerProgress,
    set: (progress: typeof playerProgress) => { playerProgress = progress; }
  };
  const replay = (save: GameSaveV1, islandId: number | null, liveHomeBuildings?: () => import("../../shared/settlement/settlement-types").SettlementBuilding[] | undefined,
    liveHomeSettlement?: () => import("../../shared/settlement/settlement-save-state").SettlementSaveV1 | undefined) => ({
    archipelago: group, enemyCampsBlockJumps: options.enemyCampsBlockJumps ?? false,
    chronology: "coordinated" as const, chronologySliceSeconds: sliceSeconds, requestedMode,
    eventCore: chronologicalEventCore, exactBudgetSeconds, islandId, liveHomeBuildings, liveHomeSettlement,
    corridorReservations: options.corridorReservations, eventMovement: options.eventMovement,
    movementSkip: options.movementSkip, movementSkipGuard: options.movementSkipGuard,
    quietSkip: options.quietSkip,
    mode: "exact" as const,
    now, onMetrics: options.onIslandMetrics, onSkip: options.onSkip,
    onProductionCycle: options.onProductionCycle, onProduced: options.onProduced, playerStore,
    onProductionWait: options.onProductionWait,
    report: () => {}, seconds: islandCatchUpSeconds(save.savedAt, now), start: save.savedAt
  });
  type Session = Awaited<ReturnType<typeof createOfflineIslandSession>>;
  const homeSource = active === null ? source : group.home;
  const homeSession: Session | undefined = homeSource ? await createOfflineIslandSession(homeSource, replay(homeSource, null)) : undefined;
  const liveHome = () => homeSession?.simulation.buildings();
  const liveHomeSettlement = () => homeSession?.simulation.saveState();
  const activeSession: Session | undefined = active === null ? undefined
    : await createOfflineIslandSession(source, replay(source, active, liveHome, liveHomeSettlement));
  const colonySessions = new Map<number, Session>();
  for (const colony of archived.colonies) {
    if (!colony.save) continue;
    colonySessions.set(colony.expeditionId, await createOfflineIslandSession(colony.save,
      replay(colony.save, colony.expeditionId, liveHome, liveHomeSettlement)));
  }
  const adventureSessions = new Map<number, Session>();
  for (const adventure of archived.adventures) {
    if (!adventure.save) continue;
    adventureSessions.set(adventure.expeditionId, await createOfflineIslandSession(adventure.save,
      replay(adventure.save, adventure.expeditionId, liveHome, liveHomeSettlement)));
  }
  // The home is the only island whose stock other islands read. Keep it last in every slice:
  // a consumer sees the previous slice's committed stock, never production from this slice.
  const consumers: Session[] = [...(activeSession ? [activeSession] : []),
    ...colonySessions.values(), ...adventureSessions.values()];
  let elapsed = 0;
  while (elapsed < horizon - 1e-9) {
    const step = Math.min(sliceSeconds, horizon - elapsed);
    await advanceChronologySlice(homeSession, consumers, step);
    elapsed += step;
    report({ completedSeconds: Math.min(totalSeconds, elapsed * islandCount), totalSeconds });
  }
  const homeSave = homeSession ? await homeSession.save(now) : undefined;
  const activeSave = activeSession ? await activeSession.save(now) : undefined;
  const colonySaves = new Map<number, GameSaveV1>();
  for (const [id, session] of colonySessions) colonySaves.set(id, await session.save(now));
  const adventureSaves = new Map<number, GameSaveV1>();
  for (const [id, session] of adventureSessions) adventureSaves.set(id, await session.save(now));
  group.colonies = group.colonies.map(colony => colonySaves.has(colony.expeditionId)
    ? { ...colony, save: colonySaves.get(colony.expeditionId) } : colony);
  if (group.adventures) group.adventures = group.adventures.map(adventure => adventureSaves.has(adventure.expeditionId)
    ? { ...adventure, save: adventureSaves.get(adventure.expeditionId) } : adventure);
  let current: GameSaveV1;
  if (active === null) {
    if (!homeSave) throw new Error("Chronological replay lost the home island session");
    current = homeSave;
    group.home = undefined;
  } else {
    if (!activeSave) throw new Error("Chronological replay lost the active island session");
    current = activeSave;
    group.home = homeSave;
  }
  const capped = away > seconds ? deferOreShips(group, Math.round((away - seconds) * 1000)) : group;
  const result = capped ? expireColonies(capped, current, active, now) : { current, group: capped };
  return { ...result.current, archipelago: result.group, player: applyReturnedColonyRelief(playerProgress, "returnedRelief" in result ? result.returnedRelief : []) };
};
