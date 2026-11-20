import type { ColorOutputSettings } from "../render-common/color-output";
import { TIME_PRESETS } from "../render-common/environment";
import type { GroundShaderRequest } from "../render-common/ground-shader-variant";
import type {
  AmbientOcclusion,
  BloomQuality,
  QualityLevel,
  QualityPreset,
  SceneTarget,
  WaterReflections
} from "../render-common/quality";
import type { RendererChoice } from "../render-common/renderer-choice";
import type { FarPropsMode } from "../renderers/three/worker-far-props-mode";
import type { CrowdMode } from "../renderers/three/worker-gpu-mode";
import type { WorkerRingMode } from "../renderers/three/worker-ring-mode";
import { OFFLINE_SKIP_AFTER_MS } from "../shared/balance/offline";
import { DEFAULT_WORLD_OPTIONS } from "../shared/world/generation/default-world-options";
import {
  DEFAULT_ISLAND_CHOICE,
  type IslandChoice,
  readIslandChoice} from "./map-generator/helpers";

/**
 * Product URL parameters. Dev/test overrides (quality, time, weather, view, stress, reveal, debug
 * views, acceptance timings) are parsed by `dev-params` only in the admin page or a local dev player;
 * a production player entry starts from the defaults below.
 */
export interface AppParams {
  /**
   * Island cache (IndexedDB) on/off: on in builds, off in dev unless ?cache=1, so code changes
   * never show a stale island; ?cache=0 forces it off.
   */
  cache: boolean;
  /** Local dev/test: bird and butterfly specimen sheet (?flyers=1..6); product default off. */
  flyerSheet: number;
  /** Local dev/test: rows of every plant kind in the meadow (?garden=1). */
  garden: boolean;
  /** Local dev/test: the island's sand/soil/rock palette (?sand=white&soil=laterite&rock=basalt; GROUND-PALETTE). */
  groundPalette: import("../shared/world/ground-palette").GroundPalette | null;
  /**
   * Local dev/test: the generated island rethemed as an adventure island (?expedition=forest|swamp|tropical|
   * winter|desert; GROUND-PALETTE review of broadleaf litter and the jungle floor).
   */
  expeditionTheme: import("../shared/settlement/adventure-themes").AdventureTheme | null;
  /** Local dev/test: a painted tilled-soil patch (?tilled=x,z,radius; GROUND-PALETTE step 6 review). */
  tilledPatch: { radius: number; x: number; z: number } | null;
  /** Local dev/test: the player's nation of a fresh island (?nation=viking; GROUND-PALETTE climate review). */
  nation: import("../render-common/workers/worker-unit").WorkerNation | null;
  /**
   * Local dev/test: colour contract A/B (decision D2): ?tonemap=neutral|agx and ?exposure=;
   * product default null (Neutral at its fitted exposure).
   */
  colorOutput: Partial<ColorOutputSettings> | null;
  /** Local dev/test: R12b ambient occlusion A/B (?ao=off|soft|strong|dramatic); product default by the Detail preset. */
  ambientOcclusion: AmbientOcclusion | null;
  /** Local dev/test: R11b bloom A/B (?bloom=off|low|on); product default by the Detail preset. */
  bloom: BloomQuality | null;
  /** Local dev/test: C06 rollback, every character on the skinned path (?crowd=skinned); default "gpu". */
  crowdMode: CrowdMode;
  /** Local dev/test: C06b rollback, the exact pre-C06b prop path on GPU crowd members (?farprops=exact). */
  farPropsMode: FarPropsMode;
  /** Local dev/test: C02 rollback, one ring mesh per worker (?rings=individual); default instanced. */
  workerRingMode: WorkerRingMode;
  /** Local dev/test: GPU diagnostics view (?gldebug=1). */
  glDebug: boolean;
  /** Local dev/test: Mali-like phone GPU emulation (?glemulate=mali). */
  glEmulate: "mali" | null;
  /** Local dev/test: strategic mist banks override (?fogbanks=0|1); product default by preset. */
  fogBanks: boolean | null;
  /** Ground shader variant (?ground=full|lite); product default auto by the GPU. */
  ground: GroundShaderRequest;
  /** Local dev/test: route-bound flag logistics on the developed island (?flagdemo=1). */
  flagDemo: boolean;
  /** Local dev/test: CIN2 cinematic camera review hook, `window.__cinematicTest` (?cinematicTest=1). */
  cinematicTest: boolean;
  /** Local dev/test: horses with riders circling the start (?horse=1). */
  horse: boolean;
  /** Start hour 0..24; product default day, dev/test ?time=dawn|day|dusk|night or a number. */
  hour: number;
  /**
   * The island's generation choice: ?landform=island|archipelago|peninsula, rivers=0..2,
   * forest=0..4, mountains=0..4, width=64..1024, height=64..1024 (legacy size= sets both), theme=meadow|desert|dirt,
   * fluvialErosion=0..1 (M03 carving, 1 by default), peakUplift=0..1 (MC-04 tall summits, 1 by default),
   * cliffBands=0..1 (MC-07 tall cliff bands, off by default).
   */
  island: IslandChoice;
  /** Local dev/test: navigation debug view of the animals (?navdebug=1). */
  navDebug: boolean;
  /** Local dev/test: shortens D15's 60 s skip delay (?offlineSkipMs=). */
  offlineSkipAfterMs: number;
  /** A saved map's slot (?map=, map editor): loaded instead of generating the island. */
  map: string | null;
  /** Local dev/test: R01/C01 per pass CPU/GPU, draws, character counters, GPU bytes (?passes=1). */
  passProfile: boolean;
  /** Local dev/test: logs the load stage table once the island is ready (?profile=1). */
  profile: boolean;
  /** Local dev/test: detail level forced by ?quality=; product default the stored setting. */
  quality: QualityLevel | null;
  /** Local dev/test: start with rain (?rain=1). */
  rain: boolean;
  /** WG-0 renderer switch (?renderer=); the product default is the current WebGL2 renderer. */
  renderer: RendererChoice;
  /** Local dev/test: lifts the fog of war everywhere (?reveal=1). */
  reveal: boolean;
  /** Local dev/test: C11 rollback, lazy possession entry without hero prewarm (?prewarm=off). */
  explorationPrewarm: boolean;
  /** Local dev/test: R12a resolved depth request (?depth=1) for timing; no consumer by default. */
  sceneDepth: boolean;
  /** Local dev/test: R10 scene target A/B (?hdr=off|rgba8|rgba16f); product default by the Detail preset. */
  sceneTarget: SceneTarget | null;
  seed: number;
  /** Local dev/test: R08 possessed shadow cascades A/B (?cascades=1|2|3); product default by the Detail preset. */
  shadowCascades: QualityPreset["shadowCascadesFps"] | null;
  /** True when the URL named an explicit seed (?seed=), even if it equals the default. */
  seedFromUrl: boolean;
  /** Local dev/test: every building placeable whatever the level (?unlockall=1). */
  unlockAll: boolean;
  /** Local dev/test: start with snowfall (?snow=1; wins over ?rain=1). */
  snow: boolean;
  /** WG-0 dev baseline: draw the WebGL scene without offscreen shadow/refraction/post passes (?wg0=nooffscreen). */
  spikeNoOffscreen: boolean;
  /** Local dev/test: 300 units, 200 buildings, 400 fish (?stress=1). */
  stress: boolean;
  /** Local dev/test: optional fixed camera (x, z, zoom) for screenshots. */
  view: { x: number; z: number; zoom: number } | null;
  /** Local dev/test: R18b water reflections A/B (?ssr=off|on); product default by the Detail preset. */
  waterReflections: WaterReflections | null;
}

const readNumber = (query: URLSearchParams, key: string, fallback: number) => {
  const value = Number(query.get(key));
  return Number.isFinite(value) && query.has(key) ? value : fallback;
};

const readCacheFlag = (value: string | null) => {
  if (value === "1") return true;
  if (value === "0") return false;
  return !import.meta.env.DEV;
};

export const readAppParams = (search: string): AppParams => {
  const query = new URLSearchParams(search);
  return {
    ambientOcclusion: null,
    bloom: null,
    cache: readCacheFlag(query.get("cache")),
    cinematicTest: false,
    colorOutput: null,
    crowdMode: "gpu",
    explorationPrewarm: true,
    farPropsMode: "far",
    flagDemo: false,
    flyerSheet: 0,
    fogBanks: null,
    garden: false,
    groundPalette: null,
    expeditionTheme: null,
    nation: null,
    tilledPatch: null,
    glDebug: false,
    glEmulate: null,
    ground: "auto",
    horse: false,
    hour: TIME_PRESETS.day,
    island: readIslandChoice(query, DEFAULT_ISLAND_CHOICE),
    navDebug: false,
    offlineSkipAfterMs: OFFLINE_SKIP_AFTER_MS,
    map: query.get("map"),
    passProfile: false,
    profile: false,
    quality: null,
    rain: false,
    renderer: "webgl",
    reveal: false,
    sceneDepth: false,
    sceneTarget: null,
    seed: readNumber(query, "seed", DEFAULT_WORLD_OPTIONS.seed),
    seedFromUrl: query.has("seed"),
    shadowCascades: null,
    snow: false,
    spikeNoOffscreen: false,
    stress: false,
    unlockAll: import.meta.env.VITE_UNLOCK_ALL_BUILDINGS === "1",
    view: null,
    waterReflections: null,
    workerRingMode: "instanced"
  };
};
