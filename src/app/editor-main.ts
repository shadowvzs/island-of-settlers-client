import { loadBuildingNavigation } from "@shared/catalog/building-data/navigation";

import { profileAsync } from "../render-common/load-profile";
import { createIdentityClient } from "./account/identity-client";
import { readAppParams } from "./app-params";
import { FOLIAGE_SEED } from "./asset-seeds";
import type { BackendConfig } from "./backend/backend-config";
import { detectBackend } from "./backend/backend-status";
import type { DevelopmentAccess } from "./development-access";
import { loadEditorGameSettings } from "./game-settings/settings-boot";
import { workerPoolSize } from "./island-assets";
import { openIslandCache } from "./island-cache";
import { startIslandRuntime } from "./island-runtime";
import { createLoadingScreen, showLoadingFailure } from "./loading-screen";
import { LEAVE_FOR_CAMPAIGN_QUESTION } from "./map-editor/campaign/constants";
import {
  campaignEditorUrl, isCampaignEditorMode, readCampaignSlotParam
} from "./map-editor/campaign/helpers";
import { loadPublishedStarterMap } from "./map-editor/map-catalog";
import { hasSavedSlot, readWorldMapStart } from "./map-editor/map-startup";
import { createSharedBuilders } from "./pool-builders";
import { openLocalSaveStore } from "./save-store/local-save-store";
import { chooseGraphics } from "./settings/choose-graphics";
import { createResolutionSession, hasCoarsePointer, readGraphicsOptions, settingsStorage } from "./settings/graphics-settings";
import { loadStartMap, restorePendingGame } from "./startup-game";
import { createWorkerPool } from "./worker-pool";

import "./styles.css";
import "./editor.css";

declare global {
  interface Window {
    /** Set when the standalone editor is on screen (Playwright). */
    __editorReady?: boolean;
  }
}

const denyEditor = () => {
  document.title = "401 Unauthorized — Map editor";
  const viewport = document.getElementById("viewport");
  if (!viewport) return;
  viewport.innerHTML = `<main class="editor-unauthorized">
    <p class="editor-unauthorized__code">401</p>
    <h1>Unauthorized</h1>
    <p>The map editor is available only to administrators.</p>
    <p>Sign in with an administrator account, then open it again from the game’s Development tools.</p>
  </main>`;
};

/**
 * The editor is a real page, but its authoring runtime is gated: a development build may open a local
 * offline copy, while an online editor requires the server-issued administrator session. The API
 * repeats the check so hiding a button cannot grant access.
 */
const isEditorAllowed = async (backend: BackendConfig | null) => {
  if (!backend) return import.meta.env.DEV;
  const identity = createIdentityClient({ identityUrl: backend.identityUrl });
  const account = await identity.resume();
  if (!account || account.role !== "admin") return false;
  try {
    const token = await identity.accessToken();
    const response = await fetch(`${backend.apiUrl}/v1/editor/access`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * The admin gate of both editors. An allowed editor then reads the deployment's game settings (plan §13.4) in the
 * background: the editors show the default mode with a "not loaded" hint until the answer arrives.
 */
const authorizeEditor = async () => {
  const backend = await detectBackend();
  const allowed = await isEditorAllowed(backend);
  if (allowed) void loadEditorGameSettings(backend);
  return allowed;
};

/**
 * Campaign mode (`?mode=campaign`, lane C6): the same admin gate, then the React campaign editor alone. No 3D
 * island is started (plan item 52: the campaign map view needs no WebGL and must not share memory with one).
 */
const startCampaignEditor = async () => {
  document.getElementById("loading-screen")?.remove();
  if (!(await authorizeEditor())) {
    document.body.classList.add("editor-mode");
    denyEditor();
    return;
  }
  document.body.classList.add("campaign-editor-mode");
  document.title = "Island of Settlers — Campaign editor";
  const host = document.createElement("div");
  host.id = "campaign-editor";
  document.body.append(host);
  const { mountCampaignEditor } = await import("./map-editor/campaign/mount-campaign-editor");
  await mountCampaignEditor(host);
  if (import.meta.env.DEV) window.__editorReady = true;
};

/**
 * The standalone map-authoring page: shared engine, renderer and map codec, but no settlement
 * simulation. The authoring panel opens immediately; the map generator is a direct bottom-bar
 * action instead of a game settings submenu.
 */
const start = async () => {
  if (isCampaignEditorMode(location.search)) { await startCampaignEditor(); return; }
  document.body.classList.add("editor-mode");
  if (!(await authorizeEditor())) { denyEditor(); return; }
  const developmentModules = await (await import("./admin-modules")).loadAdminModules();
  const params = readAppParams(location.search);
  Object.assign(params, developmentModules.readDevParams(location.search));
  // Opened from the campaign editor: load the campaign map's own slot once it has been saved.
  const campaignSlot = readCampaignSlotParam(location.search);
  if (campaignSlot && !params.map && await hasSavedSlot(campaignSlot.slotId)) params.map = campaignSlot.slotId;
  const loading = createLoadingScreen();
  const graphics = await profileAsync("check graphics", () =>
    chooseGraphics(params.quality, () => void loading.setStep("Checking graphics…")));
  const viewport = document.getElementById("viewport")!;
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const saveStore = await openLocalSaveStore();
  const pool = createWorkerPool(
    workerPoolSize(),
    await profileAsync("open island cache", () => openIslandCache(params.cache))
  );
  const restore = await restorePendingGame({
    fog: false,
    loading,
    offlineSkipAfterMs: params.offlineSkipAfterMs,
    params,
    pendingGame: null,
    pool,
    revealOre: true,
    saveStore,
    serverCatchUp: undefined,
    sessionClock: Date.now
  });
  // A new campaign map (its slot not saved yet) starts from the published starter, never the local home map.
  const worldMap = !params.map && !params.seedFromUrl && !campaignSlot ? await readWorldMapStart() : null;
  const starter = !worldMap?.loaded && !params.map && !params.seedFromUrl ? await loadPublishedStarterMap() : null;
  const startMap = await loadStartMap(null, params, worldMap?.loaded ? worldMap : starter);
  const playerNation = startMap?.loaded?.world.scenario?.nation ?? settingsStorage.readWorkerNation();
  // CAT8: the settlement reads this nation's building navigation sidecars synchronously from its first tick.
  await loadBuildingNavigation(playerNation);
  const coarsePointer = hasCoarsePointer();
  const graphicsOptions = readGraphicsOptions(graphics.detail, params.ground, coarsePointer);
  const resolution = createResolutionSession(graphicsOptions.resolutionMode, coarsePointer, graphicsOptions.resolution);
  const shared = createSharedBuilders(pool);
  const foliage = pool.generateFoliage(FOLIAGE_SEED);
  // `authorizeEditor` has already checked the server-issued administrator session.
  const developmentAccess: DevelopmentAccess = {
    allowed: true, reason: import.meta.env.DEV ? "guest-dev-build" : "admin"
  };
  const runtime = await startIslandRuntime({
    applyDetail: undefined,
    assets: undefined,
    canvas,
    cloud: null,
    developmentAccess,
    developmentModules,
    editorOnly: true,
    fog: false,
    foliage,
    gameSettings: null,
    glDebug: null,
    graphics,
    graphicsOptions,
    handoff: undefined,
    hideLoadingOnReady: true,
    loading,
    offlineCloud: null,
    onGenerateMap: undefined,
    onLoadMap: undefined,
    onRecreate: undefined,
    params,
    pendingSave: undefined,
    playerAccount: null,
    playerNation,
    pool,
    prepared: undefined,
    resolution,
    restore,
    revealOre: true,
    saveStore,
    sessionClock: Date.now,
    settlementEnabled: false,
    shared,
    startMap,
    startedAt: performance.now(),
    toolRun: true,
    viewport
  });
  const hooks = runtime.editorHooks;
  if (!hooks) throw new Error("The editor hooks were not created");
  await hooks.mapEditor.ensureLoaded();
  if (import.meta.env.DEV) (window as Window & { __editorHooks?: typeof hooks }).__editorHooks = hooks;
  const bar = document.getElementById("editor-bar");
  if (!bar) throw new Error("The editor bar is missing");
  // The game closes its corner panels on any window pointer press; editor-bar actions own their click.
  bar.addEventListener("pointerdown", event => event.stopPropagation());
  const button = (action: string) => bar.querySelector<HTMLButtonElement>(`[data-editor-action="${action}"]`)!;
  const editorButton = button("editor"), generatorButton = button("generator"), minimapButton = button("minimap");
  button("campaign").addEventListener("click", () => {
    if (!confirm(LEAVE_FOR_CAMPAIGN_QUESTION)) return;
    location.assign(campaignEditorUrl(location.href, campaignSlot?.campaignId ?? null, campaignSlot?.mapId ?? null));
  });
  const sync = () => {
    editorButton.setAttribute("aria-pressed", String(hooks.mapEditor.isEnabled()));
    generatorButton.setAttribute("aria-pressed", String(hooks.settings.isMapOpen()));
    minimapButton.setAttribute("aria-pressed", String(hooks.minimap.isVisible()));
  };
  editorButton.addEventListener("click", () => {
    hooks.mapEditor.setEnabled(!hooks.mapEditor.isEnabled());
    sync();
  });
  generatorButton.addEventListener("click", () => {
    hooks.settings.openMap();
    sync();
  });
  minimapButton.addEventListener("click", () => {
    hooks.minimap.setVisible(!hooks.minimap.isVisible());
    sync();
  });
  hooks.mapEditor.onEnabledChange(sync);
  hooks.minimap.setVisible(true);
  sync();
  await runtime.ready;
  // Keep the authoring bar off-screen until the loading screen has actually gone.
  const loadingScreen = document.getElementById("loading-screen");
  if (loadingScreen?.isConnected) {
    await new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        if (loadingScreen.isConnected) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
  document.body.classList.add("editor-ready");
  if (import.meta.env.DEV) window.__editorReady = true;
};

void start().catch(showLoadingFailure);
