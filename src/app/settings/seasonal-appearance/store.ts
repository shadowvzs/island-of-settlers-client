import {
  DEFAULT_SEASON_SETTINGS,
  getDominantSeason,
  resolveSeasonPhase,
  type SeasonPhase,
  type SeasonSettings
} from "../../../../../island-of-settlers-shared/src/appearance/season-calendar";
import { isSeasonSnowPhase } from "../../../render-common/seasonal-appearance/season-weights";
import { createExternalStore } from "../../components/ui-store";
import { type AppearanceApiConfig, type AppearanceResponse, createAppearanceApi, type SeasonChange } from "./api";
import { readIgnoreGlobalWinter, writeIgnoreGlobalWinter } from "./preference";

export interface SeasonalAppearanceSnapshot {
  /** Server time minus this browser's clock (ms), so the season blend follows the server clock. */
  clockOffset: number;
  globalWinter: boolean;
  /** The per-browser opt-out: shows summer for every global season. */
  ignoreGlobalWinter: boolean;
  online: boolean;
  season: SeasonSettings;
  /** The shown phase can show global snow (into, in or out of winter): the GPU snow path is armed (T1). */
  seasonSnowActive: boolean;
  /** Only the added global season; naturally snowy islands retain their original appearance. */
  winterActive: boolean;
}

/** What an island runtime was built with: the snapping winter extras and the armed GPU season snow. */
export interface SeasonRuntimeState {
  seasonSnow?: boolean;
  visualWinter?: boolean;
}

/** The runtime state the snapshot asks for (a rebuild applies a change of it). */
export const getSeasonRuntimeState = (snapshot: SeasonalAppearanceSnapshot): Required<SeasonRuntimeState> => ({
  seasonSnow: snapshot.seasonSnowActive, visualWinter: snapshot.winterActive
});

export const isSameSeasonRuntime = (a: SeasonRuntimeState, b: SeasonRuntimeState) =>
  (a.seasonSnow === true) === (b.seasonSnow === true) && (a.visualWinter === true) === (b.visualWinter === true);

const SUMMER_PHASE: SeasonPhase = Object.freeze({ blend: 1, from: "summer", to: "summer" });

/** The global season phase this browser shows at local time `nowMs` (summer while ignored). */
export const getShownSeasonPhase = (snapshot: SeasonalAppearanceSnapshot, nowMs = Date.now()): SeasonPhase =>
  snapshot.ignoreGlobalWinter ? SUMMER_PHASE : resolveSeasonPhase(snapshot.season, nowMs + snapshot.clockOffset);

/** The prepared (rebuild) winter look switches at mid-transition; the GPU seasons blend continuously. */
const isWinterShown = (snapshot: SeasonalAppearanceSnapshot) =>
  getDominantSeason(getShownSeasonPhase(snapshot)) === "winter";

const isSameSeason = (a: SeasonSettings, b: SeasonSettings) =>
  a.changedAt === b.changedAt && a.fixedSeason === b.fixedSeason && a.mode === b.mode &&
  a.previousSeason === b.previousSeason && a.transitionSeconds === b.transitionSeconds;

const fromResponse = (response: AppearanceResponse): Partial<SeasonalAppearanceSnapshot> => ({
  clockOffset: response.serverNow === undefined ? 0 : response.serverNow - Date.now(),
  globalWinter: response.globalWinter,
  season: response.season
});

interface SeasonalAppearanceOptions {
  document?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  fetch?: typeof fetch;
}

const REFRESH_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * One cached cosmetic snapshot for controls and the renderer. No world/save data enters this service.
 * Network failures retain the last accepted season for this session; standalone starts without winter.
 */
export const createSeasonalAppearanceStore = (options: SeasonalAppearanceOptions = {}) => {
  const store = createExternalStore<SeasonalAppearanceSnapshot>({
    clockOffset: 0, globalWinter: false, ignoreGlobalWinter: readIgnoreGlobalWinter(), online: false,
    season: { ...DEFAULT_SEASON_SETTINGS }, seasonSnowActive: false, winterActive: false
  });
  let generation = 0, revision = 0;
  let api: ReturnType<typeof createAppearanceApi> | undefined;
  let controller: AbortController | undefined;
  let pending: Promise<boolean> | undefined;
  let writing = false;
  let stopWatching: (() => void) | undefined;

  const publish = (patch: Partial<SeasonalAppearanceSnapshot>) => {
    const current = store.getSnapshot();
    const next = { ...current, ...patch };
    next.winterActive = isWinterShown(next);
    next.seasonSnowActive = isSeasonSnowPhase(getShownSeasonPhase(next));
    const unchanged = next.globalWinter === current.globalWinter && isSameSeason(next.season, current.season) &&
      next.ignoreGlobalWinter === current.ignoreGlobalWinter && next.online === current.online &&
      isSameSeasonRuntime(getSeasonRuntimeState(next), getSeasonRuntimeState(current));
    if (unchanged) return;
    store.set(next);
  };

  const refresh = (): Promise<boolean> => {
    if (!api || writing) return Promise.resolve(false);
    if (pending) return pending;
    const server = api, startedGeneration = generation, startedRevision = revision;
    const operation = (async () => {
      try {
        const next = await server.read();
        if (generation !== startedGeneration || revision !== startedRevision || writing) return false;
        publish(fromResponse(next));
        return true;
      } catch {
        return false;
      } finally {
        if (generation === startedGeneration) pending = undefined;
      }
    })();
    pending = operation;
    return operation;
  };

  const dispose = () => {
    generation++;
    controller?.abort();
    controller = undefined;
    stopWatching?.();
    stopWatching = undefined;
    api = undefined;
    pending = undefined;
    writing = false;
  };

  const start = (config: AppearanceApiConfig | null): Promise<boolean> => {
    dispose();
    publish({ globalWinter: false, online: Boolean(config), season: { ...DEFAULT_SEASON_SETTINGS } });
    if (!config) return Promise.resolve(false);
    controller = new AbortController();
    const lifecycle = controller.signal;
    const request = config.fetch ?? options.fetch ?? fetch;
    api = createAppearanceApi({ ...config, fetch: (input, init) => request(input, {
      ...init, signal: AbortSignal.any([lifecycle, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    }) });
    const target = options.document ?? globalThis.document;
    const refreshVisible = () => {
      if (!target || target.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(refreshVisible, REFRESH_MS);
    target?.addEventListener("visibilitychange", refreshVisible);
    stopWatching = () => {
      clearInterval(timer);
      target?.removeEventListener("visibilitychange", refreshVisible);
    };
    return refresh();
  };

  const write = async (send: (server: NonNullable<typeof api>) => Promise<AppearanceResponse>) => {
    if (!api) throw new Error("The online appearance service is unavailable");
    if (writing) throw new Error("An appearance change is already being saved");
    const startedGeneration = generation;
    writing = true;
    revision++;
    try {
      const next = await send(api);
      if (generation === startedGeneration) publish(fromResponse(next));
    } finally {
      if (generation === startedGeneration) {
        writing = false;
        revision++;
      }
    }
  };

  return {
    dispose,
    getSnapshot: store.getSnapshot,
    /** Dev captures and standalone previews: show these settings without the server (never saved). */
    preview: (season: SeasonSettings) => publish({ clockOffset: 0, season }),
    refresh,
    setGlobalWinter: (globalWinter: boolean) => write(server => server.setGlobalWinter(globalWinter)),
    setSeason: (change: SeasonChange) => write(server => server.setSeason(change)),
    setIgnoreGlobalWinter: (ignoreGlobalWinter: boolean) => {
      writeIgnoreGlobalWinter(ignoreGlobalWinter);
      publish({ ignoreGlobalWinter });
    },
    start,
    subscribe: store.subscribe
  };
};

export const seasonalAppearance = createSeasonalAppearanceStore();
