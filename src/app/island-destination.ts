import { FORMATS } from "../../../island-of-settlers-shared/src/formats";
import type { SharedContentBuilders } from "../render-common/content-builders";
import type { QualityPreset } from "../render-common/quality";
import { startIslandBuilds } from "../render-common/start-island-builds";
import type { WorkerNation } from "../render-common/workers/worker-unit";
import type { ColonyVisitRequest } from "../shared/settlement/archipelago";
import type { GameSaveV1, LoadedGameSave } from "../shared/settlement/game-save";
import type { WorldOptions } from "../shared/world/generation/generate-world";
import type { LoadedMap } from "../shared/world/save/map-reader";
import type { WorldData } from "../shared/world/world-data";
import type { AppParams } from "./app-params";
import type { SessionClock } from "./cloud/session-clock";
import { toIslandBuildGroup } from "./island-build-keys";
import { prepareIslandWorld, toIslandCacheGroup } from "./island-world-preparation";
import { readStartMap } from "./map-editor/map-startup";
import { createPoolBuilders, type IslandBuilders } from "./pool-builders";
import { sessionSkipsCatchUp } from "./settlement/catch-up-skip";
import { type ColonyArrival, planColonyArrival } from "./settlement/colony-boot";
import {
  advanceOfflineGameInWorker,
  stageGameSessionInWorker
} from "./settlement/game-session-worker";
import { type OfflineProgress, skipOfflineProgress } from "./settlement/offline-progress";
import type { WorkerPool } from "./worker-pool";

export class DestinationPreparationCancelled extends Error {
  constructor() {
    super("Destination preparation was cancelled");
    this.name = "DestinationPreparationCancelled";
  }
}

export interface PreparedSavedDestination {
  builders: IslandBuilders;
  identity: {
    expeditionKind: WorldData["expeditionKind"] | null;
    seed: number;
    targetKey: string;
  };
  loaded: LoadedGameSave;
  save: GameSaveV1;
  savedAt: number;
  targetKey: string;
  world: WorldData;
}

/** The expensive pieces are injectable so ordering/cancellation can be tested without workers. */
export interface SavedDestinationDeps {
  catchUp: (
    save: GameSaveV1,
    now: number,
    progress: (progress: OfflineProgress) => void
  ) => Promise<GameSaveV1>;
  now: () => number;
  prepareWorld: (loaded: LoadedGameSave) => Promise<{
    builders: IslandBuilders;
    world: WorldData;
  }>;
  stage: (save: GameSaveV1) => Promise<LoadedGameSave>;
}

export interface PrepareSavedDestinationOptions {
  builders: SharedContentBuilders;
  deps?: Partial<SavedDestinationDeps>;
  fog: boolean;
  /** Aborts before any further side effects; the caller still owns the old island. */
  isCurrent?: () => boolean;
  nation: WorkerNation;
  onProgress?: (phase: "builds" | "catch-up" | "stage" | "world") => void;
  params: AppParams;
  pool: WorkerPool;
  quality: QualityPreset;
  revealOre: boolean;
  save: GameSaveV1;
  /** The page's server-anchored clock for accounts, or the device clock for guests. */
  sessionClock?: SessionClock;
  signal?: AbortSignal;
  targetKey: string;
}

interface DestinationWorldOptions {
  builders: SharedContentBuilders;
  fog: boolean;
  nation: WorkerNation;
  params: AppParams;
  pool: WorkerPool;
  quality: QualityPreset;
  revealOre: boolean;
}

/** Shared CPU/worker world preparation for saved, visit and fresh destinations. */
const prepareWorldBuilds = async (world: WorldData, options: DestinationWorldOptions) => {
  prepareIslandWorld(world, options.params, options.fog, options.revealOre, options.nation);
  const builders = createPoolBuilders(
    options.pool,
    options.builders,
    world,
    toIslandBuildGroup(world)
  );
  await Promise.all([
    ...Object.values(startIslandBuilds(builders, options.quality)),
    builders.islandNav()
  ]);
  return builders;
};

const assertCurrent = (options: { isCurrent?: () => boolean; signal?: AbortSignal }) => {
  if (options.signal?.aborted || options.isCurrent?.() === false)
    throw new DestinationPreparationCancelled();
};

/**
 * Prepares a saved island CPU-side for an in-page handoff: catch up to the same time cut as startup,
 * validate/stage the save, prepare the world and finish its worker builds. No renderer or scene is
 * created and the active island is not touched.
 */
export const prepareSavedDestination = async (
  options: PrepareSavedDestinationOptions
): Promise<PreparedSavedDestination> => {
  const now = options.deps?.now ?? options.sessionClock ?? Date.now;
  // A pinned rules skip (offline mode, plan §10) moves the clock like a reopened tab, never replays.
  const catchUp = options.deps?.catchUp ??
    ((save: GameSaveV1, at: number, progress: (progress: OfflineProgress) => void) => sessionSkipsCatchUp(save)
      ? Promise.resolve(skipOfflineProgress(save, at).save) : advanceOfflineGameInWorker(save, at, progress));
  const stage = options.deps?.stage ?? ((save: GameSaveV1) => stageGameSessionInWorker(save));
  const prepareWorld = options.deps?.prepareWorld ?? (async (loaded: LoadedGameSave) => {
    const { world } = loaded.map;
    return { builders: await prepareWorldBuilds(world, options), world };
  });

  assertCurrent(options);
  const targetTime = Math.max(options.save.savedAt, now());
  options.onProgress?.("catch-up");
  const save = targetTime > options.save.savedAt
    ? await catchUp(options.save, targetTime, () => undefined)
    : options.save;
  assertCurrent(options);

  options.onProgress?.("stage");
  const loaded = await stage(save);
  assertCurrent(options);

  options.onProgress?.("world");
  const { builders, world } = await prepareWorld(loaded);
  assertCurrent(options);
  options.onProgress?.("builds");

  return {
    builders,
    identity: {
      expeditionKind: world.expeditionKind ?? null,
      seed: world.seed,
      targetKey: options.targetKey
    },
    loaded,
    save,
    savedAt: save.savedAt,
    targetKey: options.targetKey,
    world
  };
};

/** Confirms the prepared save still belongs to the requested saved-island destination. */
export const matchesSavedDestination = (
  prepared: Pick<PreparedSavedDestination, "targetKey">,
  destination: { kind: string; targetKey: string }
) => destination.kind === "saved" && prepared.targetKey === destination.targetKey;

export interface PreparedVisitDestination {
  arrival: ColonyArrival;
  builders: IslandBuilders;
  identity: {
    expeditionKind: WorldData["expeditionKind"] | null;
    seed: number;
    targetKey: string;
  };
  targetKey: string;
  visit: ColonyVisitRequest;
  world: WorldData;
}

export interface VisitDestinationDeps {
  plan: (
    visit: ColonyVisitRequest,
    chart: (island: ColonyArrival["record"]["island"], mapKey: string) => Promise<WorldData | null>
  ) => Promise<ColonyArrival>;
  prepareWorld: (world: WorldData) => Promise<IslandBuilders>;
}

export interface PrepareVisitDestinationOptions {
  builders: SharedContentBuilders;
  deps?: Partial<VisitDestinationDeps>;
  fog: boolean;
  isCurrent?: () => boolean;
  nation: WorkerNation;
  onProgress?: (phase: "builds" | "chart" | "world") => void;
  params: AppParams;
  pool: WorkerPool;
  quality: QualityPreset;
  revealOre: boolean;
  signal?: AbortSignal;
  /** Identity of the requested colony/adventure (`colony:7`). */
  targetKey?: string;
  visit: ColonyVisitRequest;
}

/**
 * Charts a first colony/adventure visit and prepares its CPU island state. The visit payload is the
 * only destination source; a chart failure leaves the active island untouched.
 */
export const prepareVisitDestination = async (
  options: PrepareVisitDestinationOptions
): Promise<PreparedVisitDestination> => {
  const targetKey = options.targetKey ?? `visit:${options.visit.archipelago.active}`;
  const plan = options.deps?.plan ?? planColonyArrival;
  const chart = (island: ColonyArrival["record"]["island"], mapKey: string) =>
    options.pool.chartIsland(
      island,
      toIslandCacheGroup(options.params, options.fog, options.revealOre, mapKey)
    );
  const prepareWorld = options.deps?.prepareWorld ??
    ((world: WorldData) => prepareWorldBuilds(world, options));

  assertCurrent(options);
  options.onProgress?.("chart");
  const arrival = await plan(options.visit, chart);
  assertCurrent(options);
  options.onProgress?.("world");
  const builders = await prepareWorld(arrival.world);
  assertCurrent(options);
  options.onProgress?.("builds");
  return {
    arrival,
    builders,
    identity: {
      expeditionKind: arrival.world.expeditionKind ?? null,
      seed: arrival.record.island.seed,
      targetKey
    },
    targetKey,
    visit: options.visit,
    world: arrival.world
  };
};

/** Confirms the charted visit still belongs to the requested colony/adventure destination. */
export const matchesVisitDestination = (
  prepared: Pick<PreparedVisitDestination, "targetKey">,
  destination: { kind: string; targetKey: string }
) => destination.kind === "visit" && prepared.targetKey === destination.targetKey;

export interface PreparedNewDestination {
  builders: IslandBuilders;
  /** Generator choice/seed retained for the in-page URL/storage commit. */
  choice?: import("./map-generator/helpers").IslandChoice;
  identity: {
    expeditionKind: WorldData["expeditionKind"] | null;
    seed: number;
    targetKey: string;
  };
  seed?: number;
  targetKey: string;
  world: WorldData;
}

export interface NewDestinationDeps {
  generate: (options: WorldOptions, group: string) => Promise<WorldData>;
  prepareWorld: (world: WorldData) => Promise<IslandBuilders>;
}

export interface PrepareNewDestinationOptions {
  builders: SharedContentBuilders;
  deps?: Partial<NewDestinationDeps>;
  fog: boolean;
  isCurrent?: () => boolean;
  nation: WorkerNation;
  onProgress?: (phase: "builds" | "generate" | "world") => void;
  params: AppParams;
  pool: WorkerPool;
  quality: QualityPreset;
  revealOre: boolean;
  choice?: import("./map-generator/helpers").IslandChoice;
  seed?: number;
  signal?: AbortSignal;
  targetKey: string;
  worldOptions: WorldOptions;
}

/** Generates and prepares a fresh island without touching the active session. */
export const prepareNewDestination = async (
  options: PrepareNewDestinationOptions
): Promise<PreparedNewDestination> => {
  const generate = options.deps?.generate ??
    ((worldOptions: WorldOptions, group: string) => options.pool.generateWorld(worldOptions, group));
  const prepareWorld = options.deps?.prepareWorld ??
    ((world: WorldData) => prepareWorldBuilds(world, options));

  assertCurrent(options);
  options.onProgress?.("generate");
  // NATION-TERRAIN: a fresh island leans to its nation's homeland landscape (a bias inside the generator).
  const worldOptions = options.worldOptions.nation === undefined
    ? { ...options.worldOptions, nation: options.nation }
    : options.worldOptions;
  const world = await generate(
    worldOptions,
    toIslandCacheGroup(options.params, options.fog, options.revealOre, options.targetKey, options.nation)
  );
  assertCurrent(options);
  options.onProgress?.("world");
  const builders = await prepareWorld(world);
  assertCurrent(options);
  options.onProgress?.("builds");
  return {
    builders,
    choice: options.choice,
    identity: {
      expeditionKind: world.expeditionKind ?? null,
      seed: world.seed,
      targetKey: options.targetKey
    },
    seed: options.seed,
    targetKey: options.targetKey,
    world
  };
};

/** Confirms the generated world still belongs to the requested new-map destination. */
export const matchesNewDestination = (
  prepared: Pick<PreparedNewDestination, "targetKey">,
  destination: { kind: string; targetKey: string }
) => destination.kind === "new" && prepared.targetKey === destination.targetKey;

export interface PreparedMapDestination {
  builders: IslandBuilders;
  identity: {
    expeditionKind: WorldData["expeditionKind"] | null;
    seed: number;
    targetKey: string;
  };
  loaded: LoadedMap;
  targetKey: string;
  world: WorldData;
}

export interface MapDestinationDeps {
  read: (slotId: string) => Promise<{ error: string; loaded: LoadedMap | null }>;
  prepareWorld: (world: WorldData) => Promise<IslandBuilders>;
}

export interface PrepareMapDestinationOptions extends DestinationWorldOptions {
  deps?: Partial<MapDestinationDeps>;
  isCurrent?: () => boolean;
  onProgress?: (phase: "builds" | "world") => void;
  signal?: AbortSignal;
  slotId: string;
  targetKey: string;
}

/**
 * Reads an editor map slot/file and prepares its world/builds without touching the active island.
 * The slot is read again on a reload fallback, after the URL maps to the same durable map file.
 */
export const prepareMapDestination = async (
  options: PrepareMapDestinationOptions
): Promise<PreparedMapDestination> => {
  const read = options.deps?.read ?? readStartMap;
  assertCurrent(options);
  const start = await read(options.slotId);
  assertCurrent(options);
  if (!start.loaded) throw new Error(start.error || "The saved map could not be read.");
  const nation = start.loaded.world.scenario?.nation ?? options.nation;
  const prepareWorld = options.deps?.prepareWorld ??
    ((world: WorldData) => prepareWorldBuilds(world, { ...options, nation }));

  options.onProgress?.("world");
  const builders = await prepareWorld(start.loaded.world);
  assertCurrent(options);
  options.onProgress?.("builds");
  return {
    builders,
    identity: {
      expeditionKind: start.loaded.world.expeditionKind ?? null,
      seed: start.loaded.world.seed,
      targetKey: options.targetKey
    },
    loaded: start.loaded,
    targetKey: options.targetKey,
    world: start.loaded.world
  };
};

/** Confirms the prepared map still belongs to the requested slot/file. */
export const matchesMapDestination = (
  prepared: Pick<PreparedMapDestination, "targetKey">,
  destination: { kind: string; targetKey: string }
) => destination.kind === "map" && prepared.targetKey === destination.targetKey;

export interface PrepareImportedDestinationOptions extends Omit<PrepareSavedDestinationOptions, "save"> {
  value: unknown;
}

const parseImportedSave = (value: unknown): GameSaveV1 => {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" ||
    (parsed as { format?: unknown }).format !== FORMATS.gameSave.id)
    throw new Error("The imported file is not an island-settlers game save");
  return parsed as GameSaveV1;
};

/**
 * Validates an imported game save and prepares it through the same catch-up/stage/world pipeline as a
 * saved destination. The active island and save slot are untouched until the handoff commit.
 */
export const prepareImportedDestination = async (
  options: PrepareImportedDestinationOptions
): Promise<PreparedSavedDestination> =>
  prepareSavedDestination({ ...options, save: parseImportedSave(options.value) });

/** Confirms the prepared imported game still belongs to the requested import destination. */
export const matchesImportedDestination = (
  prepared: Pick<PreparedSavedDestination, "targetKey">,
  destination: { kind: string; targetKey: string }
) => destination.kind === "import" && prepared.targetKey === destination.targetKey;
