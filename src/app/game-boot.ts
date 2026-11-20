import { loadBuildingNavigation } from "@shared/catalog/building-data/navigation";

import { clearLoadProfile, profileAsync } from "../render-common/load-profile";
import { normalizeQualityOverrides } from "../render-common/quality-overrides";
import { DEFAULT_WORLD_OPTIONS } from "../shared/world/generation/generate-world";
import { continuesLastGame } from "./account/account-boot";
import { readAppParams } from "./app-params";
import { FOLIAGE_SEED } from "./asset-seeds";
import { cloudStartupStore } from "./cloud/cloud-boot";
import { browserWorkingSlot } from "./game-settings/session-mode";
import { createHandoffReceipt, type HandoffReceiptSnapshot } from "./handoff-receipt";
import { workerPoolSize } from "./island-assets";
import { openIslandCache } from "./island-cache";
import {
  matchesImportedDestination,
  matchesMapDestination,
  matchesNewDestination,
  matchesSavedDestination,
  matchesVisitDestination,
  type PreparedMapDestination,
  type PreparedNewDestination,
  type PreparedSavedDestination,
  type PreparedVisitDestination,
  prepareImportedDestination,
  prepareMapDestination,
  prepareNewDestination,
  prepareSavedDestination,
  prepareVisitDestination} from "./island-destination";
import {
  createIslandHandoff,
  type IslandHandoffRequest,
  type IslandHandoffResult
} from "./island-handoff";
import { islandHandoffLoadingMessage } from "./island-handoff-loading";
import { createIslandHandoffStore } from "./island-handoff-store";
import { createReplacementCanvas } from "./island-render-surface";
import { startIslandRuntime } from "./island-runtime";
import { LOADING_MESSAGES } from "./loading-messages";
import { languagePreference } from "./localization/language-store";
import { loadPublishedStarterMap } from "./map-editor/map-catalog";
import { readWorldMapStart } from "./map-editor/map-startup";
import { type IslandChoice, toWorldOptions, writeIslandQuery } from "./map-generator/helpers";
import { generatorStorage } from "./map-generator/storage";
import { reloadPage } from "./page-reload";
import { initializePlayerAvatar } from "./player-avatar/store";
import { createSharedBuilders } from "./pool-builders";
import { withOfflineCloud } from "./save-slots/offline-cloud";
import { openLocalSaveStore } from "./save-store/local-save-store";
import { type BootSession, type GameBootOptions, startBootSession } from "./session-boot";
import { chooseGraphics } from "./settings/choose-graphics";
import {
  type ApplyDetail,
  createResolutionSession,
  hasCoarsePointer,
  readGraphicsOptions,
  reloadWithDetail,
  reloadWithRevealOre,
  settingsStorage
} from "./settings/graphics-settings";
import { bindSeasonalRuntime } from "./settings/seasonal-appearance/runtime-binding";
import { readSeasonPreviewQuery } from "./settings/seasonal-appearance/season-preview-query";
import { getSeasonRuntimeState, seasonalAppearance } from "./settings/seasonal-appearance/store";
import { islandNation } from "./settlement/colony-boot";
import { loadFlagDemoStartup } from "./settlement/flag-demo";
import { loadStartMap, readPendingGame, restorePendingGame } from "./startup-game";
import { createWorkerPool } from "./worker-pool";

declare global {
  interface Window {
    /** Set when the island is on screen (Playwright). */
    __islandReady?: boolean;
    /** Fells the tree whose crown is nearest to the view centre (Playwright). */
    __fellNearestTree?: () => void;
    /** Kills the animal nearest to the view centre (Playwright, death checks); its id or -1. */
    __killNearestAnimal?: () => number;
    /** Threat stimulus for the animals at a world point (Playwright, flee checks). */
    __threatAnimals?: (x: number, z: number, intensity: number) => void;
    /** Map editor rebuild timings (Playwright: ms per flush of the touched chunks). */
    __mapEditorStats?: import("./map-editor/editor-refresh").RefreshStats | null;
    /** Map editor terrain edit timings (Playwright: apply and worker rebuild ms). */
    __terrainStats?: import("./map-editor/terrain-tool").TerrainStats | null;
    /** Map editor animal homes refresh timings (Playwright: ms per refresh). */
    __homesStats?: import("../render-common/island-homes").HomesStats;
    /** Map editor undo steps kept and their memory (Playwright, performance notes). */
    __mapHistory?: () => { bytes: number; steps: number };
    /** Live animals (species, position) for scripted views (Playwright screenshots). */
    __listAnimals?: () => { species: number; x: number; z: number }[];
    /** The wildlife manager (Playwright: scripted rest / dormant motion captures). */
    __wildlife?: import("../render-common/wildlife/animal-manager").AnimalManager;
    /** In-page handoff receipts (development builds). */
    __handoffReceipts?: () => HandoffReceiptSnapshot[];
  }
}

/**
 * ?gldebug=1: GL hooks before any context draws; ?glemulate=mali: a Mali-like context (a lazy
 * chunk: no cost otherwise).
 */
const loadGlDebug = async (params: ReturnType<typeof readAppParams>) => {
  const debug = await import("./gl-debug/gl-debug-view");
  if (params.glEmulate === "mali") debug.installMaliEmulation();
  if (params.glDebug) debug.installGlDebugHooks();
  return params.glDebug ? debug : null;
};

/**
 * The island half of the player page: everything after the title page. `main.ts` loads this graph
 * dynamically while the boot session (language, sign-in, title page) runs.
 */
// oxlint-disable-next-line max-lines-per-function -- page shell owns handoff and runtime wiring
export const startIsland = async (session: BootSession) => {
  const {
    account: playerAccount, backend, cloud, developmentAccess, developmentModules, gameSettings, loading,
    offlineCloud, params, toolRun
  } = session;
  const appearanceReady = seasonalAppearance.start(backend ? {
    apiUrl: backend.apiUrl,
    getAccessToken: playerAccount?.identity.accessToken,
    renewAccessToken: playerAccount?.identity.renew
  } : null);
  const seasonPreview = import.meta.env.DEV ? readSeasonPreviewQuery(location.search, Date.now()) : null;
  if (seasonPreview) void appearanceReady.then(() => seasonalAppearance.preview(seasonPreview));
  if (playerAccount) loading.setNation(playerAccount.account.nation);
  const settlementEnabled = !params.stress && !params.garden && !params.horse;
  const glDebug = params.glDebug || params.glEmulate ? await loadGlDebug(params) : null;
  const graphics = await profileAsync("check graphics", () =>
    chooseGraphics(params.quality, () => {
      void loading.setStep(languagePreference.i18n._(LOADING_MESSAGES.step.checkingGraphics));
    })
  );
  await loading.setStep(languagePreference.i18n._(LOADING_MESSAGES.step.generating));
  const viewport = document.getElementById("viewport")!;
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const startedAt = performance.now();
  const fog = settingsStorage.readFog() && !params.reveal;
  let revealOre = settingsStorage.readRevealOre() &&
    (developmentAccess.allowed || Boolean(developmentModules));
  const saveStore = cloud?.store ??
    withOfflineCloud(await openLocalSaveStore(browserWorkingSlot(gameSettings)), offlineCloud);
  const sessionClock = cloud?.clock ?? Date.now; // Real UTC time: the server's for accounts, else the device's.
  if (params.flagDemo) await loadFlagDemoStartup(saveStore, sessionClock, text => loading.setStep(text));
  const requestedSeed = params.seedFromUrl ? params.seed : undefined;
  /** A seed launch reads the save only to compare its home seed; ?map= still starts a new map. */
  const readSavedGame = !toolRun && !params.map &&
    (continuesLastGame(location.search) || requestedSeed !== undefined);
  const pendingRead = await readPendingGame(
    cloud ? cloudStartupStore(cloud) : saveStore,
    readSavedGame,
    requestedSeed
  );
  const pool = createWorkerPool(
    workerPoolSize(),
    await profileAsync("open island cache", () => openIslandCache(params.cache))
  );
  const restore = await restorePendingGame({
    fog,
    loading,
    offlineSkipAfterMs: params.offlineSkipAfterMs,
    params,
    pendingGame: pendingRead.pendingGame,
    pool,
    revealOre,
    saveStore,
    serverCatchUp: cloud?.caughtUp,
    sessionClock
  });
  const { colonyArrival, colonyVisit, restoredGame } = restore;
  const worldMap = !restoredGame && !toolRun && !params.map && !params.seedFromUrl
    ? await readWorldMapStart() : null;
  const starter = !worldMap?.loaded && !restoredGame && !toolRun && !params.map && !params.seedFromUrl
    ? await loadPublishedStarterMap() : null;
  const startMap = await loadStartMap(restoredGame, params,
    worldMap?.loaded ? worldMap : starter);
  const playerNation = params.nation ?? cloud?.economy.startNation ?? islandNation(restoredGame, colonyVisit) ??
    colonyArrival?.world.scenario?.nation ??
    startMap?.loaded?.world.scenario?.nation ?? playerAccount?.account.nation ??
    settingsStorage.readWorkerNation();
  initializePlayerAvatar({
    accountGender: playerAccount?.account.avatarGender,
    accountId: playerAccount?.account.id,
    nation: playerNation,
    saveAccountGender: playerAccount
      ? async gender => (await playerAccount.identity.setAvatarGender(gender)).ok
      : undefined
  });
  loading.setNation(playerNation);
  // CAT8: the settlement reads this nation's building navigation sidecars synchronously from its first tick.
  await loadBuildingNavigation(playerNation);
  const coarsePointer = hasCoarsePointer();
  let graphicsOptions = readGraphicsOptions(graphics.detail, params.ground, coarsePointer);
  if (params.fogBanks !== null)
    graphicsOptions.quality = { ...graphicsOptions.quality, atmosphereBanks: params.fogBanks };
  const resolution = createResolutionSession(
    graphicsOptions.resolutionMode,
    coarsePointer,
    graphicsOptions.resolution
  );
  const shared = createSharedBuilders(pool);
  const handoffStore = createIslandHandoffStore(saveStore);
  const foliage = pool.generateFoliage(FOLIAGE_SEED);
  type IslandRuntime = Awaited<ReturnType<typeof startIslandRuntime>>;
  let currentRuntime: IslandRuntime | undefined;
  let nextCanvas: HTMLCanvasElement | undefined;
  const handoffReceipts: HandoffReceiptSnapshot[] = [];
  type PreparedHandoffDestination =
    | { kind: "saved"; prepared: PreparedSavedDestination }
    | { kind: "visit"; prepared: PreparedVisitDestination }
    | { kind: "new"; prepared: PreparedNewDestination }
    | { kind: "map"; prepared: PreparedMapDestination }
    | { kind: "import"; prepared: PreparedSavedDestination };
  const pageHandoff = async (
    request: IslandHandoffRequest
  ): Promise<IslandHandoffResult<PreparedHandoffDestination, IslandRuntime>> => {
    const runtime = currentRuntime;
    const session = runtime?.settlementSession;
    if (!runtime || !session) return { ok: false, reason: "failed" };
    const receipt = createHandoffReceipt();
    const handoff = createIslandHandoff<PreparedHandoffDestination, IslandRuntime>({
      captureDeparture: async () => {
        throw new Error("The departing island was not captured");
      },
      commitDestination: async prepared => {
        if (prepared.kind === "visit") {
          await handoffStore.commitStartup(prepared.prepared.visit);
          return;
        }
        if (prepared.kind === "new") {
          const choice = prepared.prepared.choice;
          if (!choice) throw new Error("The generated island has no committed choice");
          generatorStorage.write(choice);
          const query = new URLSearchParams(location.search);
          writeIslandQuery(query, choice);
          query.set("seed", String(prepared.prepared.seed ?? prepared.prepared.world.seed));
          query.delete("map");
          query.delete("view");
          const search = query.toString();
          history.replaceState(null, "", `${location.pathname}${search ? `?${search}` : ""}`);
          await handoffStore.complete();
          return;
        }
        if (prepared.kind === "map") {
          const query = new URLSearchParams(location.search);
          query.set("map", prepared.prepared.targetKey.startsWith("map:")
            ? prepared.prepared.targetKey.slice(4) : prepared.prepared.targetKey);
          query.delete("view");
          const search = query.toString();
          history.replaceState(null, "", `${location.pathname}${search ? `?${search}` : ""}`);
          await handoffStore.complete();
          return;
        }
        await handoffStore.commit(prepared.prepared.save);
      },
      complete: async () => {
        // A first visit has no destination slot save until its landing has settled; keep the
        // startup fallback until then.
        await currentRuntime?.settlementSession?.settle();
        await handoffStore.complete();
      },
      current: () => currentRuntime ?? null,
      dispose: async old => {
        const replacement = createReplacementCanvas(old.canvas);
        old.canvas.replaceWith(replacement);
        nextCanvas = replacement;
        await old.dispose();
      },
      install: async prepared => {
        const assets = currentRuntime?.assets;
        const canvas = nextCanvas;
        if (!assets || !canvas) throw new Error("The replacement render surface is unavailable");
        const visit = prepared.kind === "visit" ? prepared.prepared : null;
        const fresh = prepared.kind === "new" ? prepared.prepared : null;
        const map = prepared.kind === "map" ? prepared.prepared : null;
        const saved = prepared.kind === "saved" || prepared.kind === "import" ? prepared.prepared : null;
        const restoredGame = saved?.loaded ?? null;
        const installed = await startIslandRuntime({
          assets,
          canvas,
          cloud,
          developmentAccess,
          developmentModules,
          fog,
          gameSettings,
          graphics,
          graphicsOptions,
          glDebug,
          handoff: pageHandoff,
          hideLoadingOnReady: false,
          loading,
          offlineCloud,
          params,
          playerAccount,
          playerNation: visit
            ? visit.visit.archipelago.home?.settlement.playerNation ?? playerNation
            : map?.loaded.world.scenario?.nation ?? saved?.loaded.settlement.playerNation ?? playerNation,
          pool,
          prepared: {
            assets,
            builders: visit?.builders ?? fresh?.builders ?? map?.builders ?? saved!.builders,
            world: visit?.world ?? fresh?.world ?? map?.world ?? saved!.world
          },
          resolution,
          restore: {
            awayNotice: "",
            colonyArrival: visit?.arrival ?? null,
            colonyVisit: visit?.visit ?? null,
            gameLoadError: "",
            pendingSave: undefined,
            restoredGame,
            savedAt: visit || fresh || map ? sessionClock() : saved!.savedAt
          },
          revealOre,
          saveStore,
          sessionClock,
          settlementEnabled,
          shared,
          foliage,
          startMap: { error: "", loaded: map?.loaded ?? saved?.loaded.map ?? null },
          onRecreate: recreateIsland,
          onGenerateMap: recreateEditorIsland,
          onLoadMap: loadMapInPage,
          applyDetail: applyDetailLive,
          setRevealOre: setRevealOreLive,
          startedAt: performance.now(),
          toolRun,
          ...getSeasonRuntimeState(seasonalAppearance.getSnapshot()),
          viewport
        });
        await installed.ready;
        currentRuntime = installed;
        return installed;
      },
      matches: (prepared, destination) => {
        if (prepared.kind === "visit") return matchesVisitDestination(prepared.prepared, destination);
        if (prepared.kind === "new") return matchesNewDestination(prepared.prepared, destination);
        if (prepared.kind === "map") return matchesMapDestination(prepared.prepared, destination);
        if (prepared.kind === "import") return matchesImportedDestination(prepared.prepared, destination);
        return matchesSavedDestination(prepared.prepared, destination);
      },
      prepare: async (destination, token) => {
        const common = {
          builders: shared,
          fog,
          isCurrent: () => token.current(),
          nation: playerNation,
          onProgress: (phase: "world" | "builds" | "chart" | "catch-up" | "stage" | "generate") => {
            if (phase === "world" || phase === "builds" || phase === "chart" || phase === "generate")
              void loading.setStep(languagePreference.i18n._(LOADING_MESSAGES.step.building));
          },
          params,
          pool,
          quality: graphicsOptions.quality,
          revealOre,
          sessionClock,
          targetKey: destination.targetKey
        };
        if (destination.kind === "visit") {
          return {
            kind: "visit",
            prepared: await prepareVisitDestination({
              ...common,
              visit: destination.payload as import("../shared/settlement/archipelago").ColonyVisitRequest
            })
          };
        }
        if (destination.kind === "import") {
          return {
            kind: "import",
            prepared: await prepareImportedDestination({ ...common, value: destination.value })
          };
        }
        if (destination.kind === "new") {
          const choice = destination.choice as IslandChoice;
          return {
            kind: "new",
            prepared: await prepareNewDestination({
              ...common,
              choice,
              seed: destination.seed,
              worldOptions: { ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(choice) }
            })
          };
        }
        if (destination.kind === "map") {
          return {
            kind: "map",
            prepared: await prepareMapDestination({
              ...common,
              slotId: destination.slotId
            })
          };
        }
        if (destination.kind !== "saved")
          throw new Error("This island destination is not enabled in this tab");
        return {
          kind: "saved",
          prepared: await prepareSavedDestination({ ...common, save: destination.payload })
        };
      },
      receipt,
      sampleResources: () => ({ renderers: currentRuntime ? 1 : 0 }),
      settle: () => currentRuntime?.settlementSession?.settle() ?? Promise.resolve(),
      showLoading: async () => {
        loading.show();
        const message = islandHandoffLoadingMessage(request.trigger);
        await loading.setStep(languagePreference.i18n._(message));
      },
      hideLoading: () => loading.hide(),
      transition: session.transition,
      writeDeparture: handoffStore.writeDeparture
    });
    // Each destination owns one load profile; repeated handoffs must not accumulate stage history.
    clearLoadProfile();
    const outcome = await handoff.replace(request);
    // Development telemetry must not become an unbounded leak during repeated handoff reviews.
    if (handoffReceipts.length >= 512) handoffReceipts.shift();
    handoffReceipts.push(receipt.snapshot());
    return outcome;
  };
  const recreateIsland = (
    choice: IslandChoice,
    seed?: number,
    trigger: "editor-generate" | "generator-recreate" = "generator-recreate"
  ) => {
    const nextSeed = seed ?? Math.floor(Math.random() * 1_000_000_000);
    void pageHandoff({
      destination: { choice, kind: "new", seed: nextSeed, targetKey: `${trigger}:${nextSeed}` },
      key: `${trigger}:${nextSeed}`,
      saveDeparture: false,
      trigger
    }).then(outcome => { if (!outcome.ok && outcome.reason === "reload-required") reloadPage(); });
  };
  const recreateEditorIsland = (choice: IslandChoice, seed?: number) =>
    recreateIsland(choice, seed, "editor-generate");
  const loadMapInPage = async (slotId: string) => {
    const outcome = await pageHandoff({
      destination: { kind: "map", slotId, targetKey: `map:${slotId}` },
      key: `map:${slotId}`,
      saveDeparture: false,
      trigger: "editor-map-load"
    });
    if (!outcome.ok && outcome.reason === "reload-required") {
      reloadPage();
      return true;
    }
    return outcome.ok;
  };
  let graphicsRefresh = 0;
  let graphicsRefreshBusy = false;
  /**
   * Same-document graphics refresh: capture the live island, rebuild its runtime with the new
   * quality/reveal options, and keep the page (account, worker pool, cache) alive. The current
   * save is the durable fallback if installation fails.
   */
  const refreshGraphics = async (
    trigger: "graphics-detail" | "graphics-reveal-ore" | "graphics-appearance",
    commit: () => void,
    rollback: () => void
  ) => {
    const session = currentRuntime?.settlementSession;
    if (!session?.capture || graphicsRefreshBusy) return false;
    graphicsRefreshBusy = true;
    try {
      commit();
      const save = await session.capture();
      const key = `refresh:${trigger}:${(graphicsRefresh += 1)}`;
      const outcome = await pageHandoff({
        departure: save,
        destination: { kind: "saved", payload: save, targetKey: key },
        key,
        saveDeparture: false,
        trigger
      });
      if (!outcome.ok && outcome.reason === "reload-required") {
        reloadPage();
        return true;
      }
      if (!outcome.ok) rollback();
      return outcome.ok;
    } catch {
      rollback();
      return false;
    } finally {
      graphicsRefreshBusy = false;
    }
  };
  const applyDetailLive: ApplyDetail = (level, overrides) => {
    const settingsSession = currentRuntime?.settlementSession;
    if (!settingsSession?.capture) {
      reloadWithDetail(level, overrides);
      return;
    }
    const previousDetail = graphics.detail;
    const previousOverrides = settingsStorage.readQualityOverrides();
    const previousOptions = graphicsOptions;
    const rollback = () => {
      settingsStorage.writeDetail(previousDetail);
      settingsStorage.writeQualityOverrides(previousOverrides);
      graphics.detail = previousDetail;
      graphicsOptions = previousOptions;
    };
    void refreshGraphics("graphics-detail", () => {
      settingsStorage.writeDetail(level);
      settingsStorage.writeQualityOverrides(normalizeQualityOverrides(level, overrides));
      graphics.detail = level;
      graphicsOptions = readGraphicsOptions(level, params.ground, coarsePointer);
    }, rollback).then(ok => { if (!ok) rollback(); });
  };
  const setRevealOreLive = (revealed: boolean) => {
    const settingsSession = currentRuntime?.settlementSession;
    if (!settingsSession?.capture) {
      reloadWithRevealOre(revealed);
      return;
    }
    const previous = revealOre;
    const rollback = () => {
      settingsStorage.writeRevealOre(previous);
      revealOre = previous;
    };
    void refreshGraphics("graphics-reveal-ore", () => {
      settingsStorage.writeRevealOre(revealed);
      revealOre = revealed;
    }, rollback).then(ok => { if (!ok) rollback(); });
  };
  await appearanceReady;
  const initial = await startIslandRuntime({
    canvas,
    cloud,
    developmentAccess,
    developmentModules,
    fog,
    gameSettings,
    graphics,
    graphicsOptions,
    glDebug,
    handoff: pageHandoff,
    loading,
    offlineCloud,
    params,
    pendingSave: restore.pendingSave,
    playerAccount,
    playerNation,
    pool,
    resolution,
    restore,
    revealOre,
    saveStore,
    sessionClock,
    settlementEnabled,
    shared,
    foliage,
    startMap,
    startedAt,
    toolRun,
    ...getSeasonRuntimeState(seasonalAppearance.getSnapshot()),
    viewport,
    onRecreate: recreateIsland,
    onGenerateMap: recreateEditorIsland,
    onLoadMap: loadMapInPage,
    applyDetail: applyDetailLive,
    setRevealOre: setRevealOreLive
  });
  currentRuntime = initial;
  await initial.ready;
  const unbindSeason = bindSeasonalRuntime({
    applied: () => ({ seasonSnow: currentRuntime?.seasonSnow, visualWinter: currentRuntime?.visualWinter }),
    busy: () => graphicsRefreshBusy || Boolean(currentRuntime?.settlementSession?.transition.busy()),
    onFailure: () => console.warn("[appearance] The winter appearance could not be refreshed."),
    refresh: () => refreshGraphics("graphics-appearance", () => {}, () => {}),
    store: seasonalAppearance
  });
  const stopAppearance = (event: PageTransitionEvent) => {
    if (event.persisted) return;
    unbindSeason();
    seasonalAppearance.dispose();
    window.removeEventListener("pagehide", stopAppearance);
  };
  window.addEventListener("pagehide", stopAppearance);
  if (import.meta.env.DEV)
    (window as Window & { __islandBoot?: { params: unknown; restore: unknown; startMap: unknown } })
      .__islandBoot = { params, restore, startMap };
  // Season captures: show settings locally without the server (seasons-1 receipt).
  if (import.meta.env.DEV)
    (window as Window & { __seasonPreview?: typeof seasonalAppearance.preview })
      .__seasonPreview = seasonalAppearance.preview;
  if (import.meta.env.DEV)
    (window as Window & {
      __graphicsReview?: {
        applyDetail: typeof applyDetailLive;
        setRevealOre: typeof setRevealOreLive;
      };
    }).__graphicsReview = { applyDetail: applyDetailLive, setRevealOre: setRevealOreLive };
  if (import.meta.env.DEV)
    (window as Window & {
      __islandLoadReview?: {
        generate: typeof recreateEditorIsland;
        loadMap: typeof loadMapInPage;
        saveMap: () => Promise<string>;
      };
    }).__islandLoadReview = {
      generate: recreateEditorIsland,
      loadMap: loadMapInPage,
      saveMap: async () => {
        const world = currentRuntime?.world;
        if (!world) throw new Error("The current island is not ready");
        const [{ writeMapFile }, { openMapStorage }] = await Promise.all([
          import("../shared/world/save/map-writer"),
          import("./map-editor/map-storage")
        ]);
        const storage = await openMapStorage();
        if (!storage) throw new Error("Map storage is unavailable");
        const id = "review-map";
        const bytes = await writeMapFile(world, {
          animals: [], name: "Load review", savedAt: Date.now(), source: "review", terrain: null
        });
        await storage.write({ id, name: "Load review", savedAt: Date.now(), size: bytes.length }, bytes);
        storage.close();
        return id;
      }
    };
  if (import.meta.env.DEV)
    (window as Window & { __handoffReceipts?: () => HandoffReceiptSnapshot[] }).__handoffReceipts =
      () => handoffReceipts.map(snapshot => ({ ...snapshot }));
};

/** Admin page shell: one ordered boot (the admin entry is not size-critical). */
export const startGame = async (options: GameBootOptions = {}) => {
  const session = await startBootSession(options);
  if (session) await startIsland(session);
};
