import { type BugReplayReport, replaySettlementCommands } from "../../shared/settlement/bug-replay";
import { createGameSave, type GameSaveV1, readGameSave } from "../../shared/settlement/game-save";
import { createReplaySceneAdapter } from "../../shared/settlement/replay-scene";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { isHomeBuilding, isOwnBuilding } from "../../shared/settlement/settlement-home";
import { saveIntegrityProblem } from "../../shared/settlement/settlement-save-integrity";
import type { SettlementSaveV1 } from "../../shared/settlement/settlement-save-state";
import { createSettlementSimulation, type SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { hashSettlementState } from "../../shared/settlement/settlement-state-hash";
import type { SettlementBuilding, SettlementOptions } from "../../shared/settlement/settlement-types";
import type { WorldData } from "../../shared/world/world-data";
import { archivedOwnedIslands } from "./archived-island-access";
import { campaignRunOptions } from "./campaign-run-end";
import { colonySettlementOptions } from "./colony-boot";
import { stageGameSession } from "./game-session";
import { canWorkerEnterBuildingPlot } from "./island-simulation-hooks";
import { createIslandStockContacts } from "./island-stock-contacts";
import { createOfflineIslandRuntime } from "./offline-island-runtime";
import { createPlayerSession } from "./player-session";

/**
 * `runtime`: the island's own tree growth, felling and wildlife run headless (what a server runs).
 * `scene`: the recording's observed world responses are fed back instead (bug-report replay).
 */
export type HeadlessReplayMode = "runtime" | "scene";

export interface HeadlessReplayOptions {
  /** Also returns the whole game save at the end (runtime mode): a snapshot to resume from. */
  captureSave?: boolean;
  /** Match the normal loading-screen geometry warmup before measuring native steps. */
  prewarm?: boolean;
  /** Diagnostic timings around native work, excluding hashing and the observer itself. */
  onStep?: (milliseconds: number) => void;
  onCommand?: (name: string, milliseconds: number) => void;
  /** A state hash after the first update that reaches every multiple of this tick count; 0 = none. */
  hashEveryTicks: number;
  mode: HeadlessReplayMode;
  /** The island reloads its own snapshot in place after this tick (the client's upload reload, D3). */
  reloadAtTick?: number;
}

export interface ReplayHashCheckpoint { hash: string; tick: number }

export interface ReplayOutcomeDifference { actual: unknown; at: number; expected: unknown; name: string }

export interface HeadlessReplayResult {
  checkpoints: ReplayHashCheckpoint[];
  elapsed: number;
  finalHash: string;
  outcomeDifferences: ReplayOutcomeDifference[];
  save?: GameSaveV1;
  seed: number;
  settlement: SettlementSaveV1;
  ticks: number;
}

interface ReplayClock { elapsed: number }

interface HeadlessSession {
  afterCommand?: () => void;
  beforeFinalSnapshot?: () => void;
  beforeUpdate?: () => void;
  finish?: () => void;
  runtimeState: () => unknown;
  save?: () => Promise<GameSaveV1>;
  simulation: SettlementSimulation;
  world: WorldData;
}

const MAX_OUTCOME_DIFFERENCES = 32;

/** A simulation without a renderer over the island's real stock contacts and plot entry rule. */
export const createHeadlessSimulation = (
  world: WorldData, options: Omit<SettlementOptions, "roads" | "world">
) => {
  let simulation: SettlementSimulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const nationOfBuilding = (building: SettlementBuilding) => simulation?.buildingNation(building);
  simulation = createSettlementSimulation({ ...options, roads,
    stockContact: createIslandStockContacts(world, (x, z) => simulation?.isOccupied(x, z) ?? false, nationOfBuilding),
    canWorkerEnterPlot: (building, point) => canWorkerEnterBuildingPlot(building, point, nationOfBuilding(building)),
    world });
  return simulation;
};

const restoreSettlement = (simulation: SettlementSimulation, settlement: SettlementSaveV1) => {
  const corrupt = saveIntegrityProblem(settlement);
  if (corrupt) throw new Error(`Settlement baseline could not be restored: ${corrupt}`);
  const restored = simulation.loadState(settlement);
  if (!restored.ok) throw new Error(`Settlement baseline could not be restored: ${restored.reason}`);
};

const sceneHomeBuilding = (settlement: SettlementSaveV1) => {
  const home = settlement.buildings.find(isHomeBuilding);
  if (home?.typeId === 0 || home?.typeId === 39) return home.typeId;
  return null;
};

/** The recorded world responses replace wildlife/forest managers (needs the scene journal). */
const createSceneSession = async (report: BugReplayReport): Promise<HeadlessSession> => {
  const loaded = await readGameSave(report.baseline), { world } = loaded.map;
  const scene = report.scene ? createReplaySceneAdapter(world, report.scene, report.baseline.savedAt) : undefined;
  const build = () => createHeadlessSimulation(world, { clockStart: report.baseline.savedAt,
    homeBuilding: sceneHomeBuilding(loaded.settlement), ...scene?.hooks,
    restoredHome: loaded.settlement.buildings.find(isHomeBuilding),
    playerNation: loaded.settlement.playerNation });
  const simulation = scene ? scene.whileConstructing(build) : build();
  restoreSettlement(simulation, loaded.settlement);
  scene?.start();
  return { afterCommand: () => scene?.afterCommand(),
    beforeFinalSnapshot: () => scene?.stop(), beforeUpdate: () => scene?.beforeUpdate(),
    finish: () => scene?.finish(), runtimeState: () => undefined, simulation, world };
};

/** The recording session's development override: level-locked placements were allowed. */
const recordedUnlockAll = (report: BugReplayReport) => {
  const configuration = report.scene?.[0];
  return !!configuration && "unlockAllBuildings" in configuration && configuration.unlockAllBuildings;
};

/**
 * The server's view of one island: its own resource managers and player session on the game clock, restored from
 * `baseline` (headless replays and command log verification, D4.3).
 */
export interface HeadlessIslandContext {
  /** API-only private wallet port for an explicit verified road-decoration custody transaction. */
  roadDecorationCustody?: SettlementOptions["roadDecorationCustody"];
  /** Read-only acceptance/accounting observer; default gameplay and production callbacks stay unchanged. */
  onProductionCycle?: SettlementOptions["onProductionCycle"];
  /** Optional explicit receipt interception; default credits the simulated island's own home. */
  receiveLevelUpCoins?: (coins: number) => void;
  /** Zero-time archive operations use current global quest context without moving the island clock. */
  questClock?: () => number;
}
export const createHeadlessIsland = async (
  baseline: GameSaveV1, unlockAllBuildings = false, developmentAllowed = false, context: HeadlessIslandContext = {}
) => {
  const loaded = await stageGameSession(structuredClone(baseline)), { world } = loaded.map;
  const runtime = createOfflineIslandRuntime(loaded);
  // The island's game clock continues from the baseline's save time.
  let now = () => baseline.savedAt;
  const initialReliefArchives = baseline.archipelago ? archivedOwnedIslands(baseline.archipelago).map(island => island.save) : [];
  const player = createPlayerSession({ initial: baseline.player, nation: loaded.settlement.playerNation,
    receiveLevelUpCoins: context.receiveLevelUpCoins,
    initialReliefArchives, hasArchivedReliefHarbour: () => initialReliefArchives.some(save =>
      save.settlement.buildings.some(building => building.typeId === 39 && building.construction === 1 && isOwnBuilding(building))),
    now: () => context.questClock?.() ?? now(), seed: world.seed });
  // A campaign run replays with its attempt's map status, as on screen; the outcome hand-off has no listener here.
  const campaignRun = campaignRunOptions(baseline.campaignRun, () => undefined);
  const simulation = createHeadlessSimulation(world, { ...runtime.hooks, ...colonySettlementOptions(loaded, null),
    ...campaignRun,
    roadDecorationCustody: context.roadDecorationCustody ?? player.roadDecorationCustody,
    restoredHome: loaded.settlement.buildings.find(isHomeBuilding),
    clockStart: baseline.savedAt, developmentAllowed,
    commanderOwner: { claim: player.claimCommander, get: player.commanderOwner, release: player.releaseCommander },
    playerLevel: player.level, onBuildingCompleted: player.buildingCompleted, onProduced: player.produced,
    onProductionCycle: context.onProductionCycle,
    onTutorialEvent: player.tutorialEvent, unlockAllBuildings });
  restoreSettlement(simulation, loaded.settlement);
  now = simulation.gameNow;
  player.bind(simulation);
  const save = async () => ({ ...await createGameSave(world, simulation.saveState(), { ...loaded.map.meta,
    animals: loaded.map.animals, savedAt: now(), terrain: loaded.map.terrain }, runtime.save()),
  player: player.progress() });
  return {
    runtimeState: () => ({ player: player.progress(), world: runtime.save() }), save, simulation, world };
};

const createRuntimeSession = (report: BugReplayReport): Promise<HeadlessSession> =>
  createHeadlessIsland(report.baseline, recordedUnlockAll(report));

const hashSession = (session: HeadlessSession) => hashSettlementState({ runtime: session.runtimeState(),
  settlement: session.simulation.saveState(), world: session.world });

/** Hashes after the update that reaches each checkpoint tick (updates may run several ticks). */
const wrapUpdates = (session: HeadlessSession, clock: ReplayClock, hashEveryTicks: number, reloadAtTick = -1,
  onStep?: (milliseconds: number) => void) => {
  const checkpoints: ReplayHashCheckpoint[] = [];
  const { simulation } = session, update = simulation.update;
  let nextCheckpoint = hashEveryTicks;
  simulation.update = dt => {
    session.beforeUpdate?.();
    clock.elapsed += dt;
    const started = onStep ? performance.now() : 0;
    update(dt);
    onStep?.(performance.now() - started);
    const tick = simulation.tickCount();
    if (hashEveryTicks && tick >= nextCheckpoint) {
      checkpoints.push({ hash: hashSession(session), tick });
      nextCheckpoint = (Math.floor(tick / hashEveryTicks) + 1) * hashEveryTicks;
    }
    // After the hash: the snapshot is the state at this tick; the reload starts the next one.
    if (tick === reloadAtTick && !simulation.reloadSnapshot(simulation.saveState(), true).ok)
      throw new Error("The island could not reload its own snapshot");
  };
  return checkpoints;
};

/**
 * Replays a bug-replay recording without a browser, renderer or canvas: the same code runs in Node
 * (server) and in a page, so their hash sequences can be compared (BACKEND-03 determinism proof).
 */
export const runHeadlessReplay = async (
  report: BugReplayReport, options: HeadlessReplayOptions
): Promise<HeadlessReplayResult> => {
  const clock: ReplayClock = { elapsed: 0 };
  const session = options.mode === "scene" ? await createSceneSession(report)
    : await createRuntimeSession(report);
  if (options.prewarm) for (const _progress of session.simulation.prewarmCoastalGeometry()) { /* Derived caches only. */ }
  const checkpoints = wrapUpdates(session, clock, options.hashEveryTicks, options.reloadAtTick, options.onStep);
  if (options.onCommand) {
    const methods = session.simulation as unknown as Record<string, unknown>;
    for (const name of new Set(report.commands.map(command => command.name))) {
      const method = methods[name];
      if (typeof method !== "function") continue;
      methods[name] = (...args: unknown[]) => {
        const started = performance.now();
        try { return Reflect.apply(method, session.simulation, args); }
        finally { options.onCommand?.(name, performance.now() - started); }
      };
    }
  }
  const outcomeDifferences: ReplayOutcomeDifference[] = [];
  const settlement = replaySettlementCommands(report, session.simulation, (command, actual) => {
    if (outcomeDifferences.length >= MAX_OUTCOME_DIFFERENCES) return;
    outcomeDifferences.push({ actual, at: command.at, expected: command.result, name: command.name });
  }, session.beforeFinalSnapshot, session.afterCommand);
  session.finish?.();
  const save = options.captureSave ? await session.save?.() : undefined;
  return { ...(save ? { save } : {}), checkpoints, elapsed: clock.elapsed, finalHash: hashSession(session), outcomeDifferences,
    seed: session.world.seed, settlement, ticks: session.simulation.tickCount() };
};
