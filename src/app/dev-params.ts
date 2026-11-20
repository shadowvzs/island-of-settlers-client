import { BODY_GIRTH } from "@workers/worker-body-girth";

import { readColorExposure, readColorToneMapper } from "../render-common/color-output";
import { TIME_PRESETS } from "../render-common/environment";
import { readGroundShaderRequest } from "../render-common/ground-shader-variant";
import {
  isQualityLevel,
  readAmbientOcclusion,
  readBloomQuality,
  readSceneTarget,
  readWaterReflections
} from "../render-common/quality";
import {
  readRendererChoice,
  RENDERER_CHOICE_STORAGE_KEY,
  type RendererChoice
} from "../render-common/renderer-choice";
import { isWorkerNation } from "../render-common/workers/worker-appearance";
import { readFarPropsMode } from "../renderers/three/worker-far-props-mode";
import { readCrowdMode } from "../renderers/three/worker-gpu-mode";
import { readWorkerRingMode } from "../renderers/three/worker-ring-mode";
import { OFFLINE_SKIP_AFTER_MS } from "../shared/balance/offline";
import { isAdventureTheme } from "../shared/settlement/adventure-themes";
import { type GroundPalette, isRockPalette, isSandPalette, isSoilPalette } from "../shared/world/ground-palette";
import type { AppParams } from "./app-params";

/** URL switches that belong to local development, acceptance and administration, never to players. */
export type DevParams = Pick<AppParams,
  | "ambientOcclusion"
  | "bloom"
  | "cinematicTest"
  | "colorOutput"
  | "crowdMode"
  | "explorationPrewarm"
  | "farPropsMode"
  | "flagDemo"
  | "flyerSheet"
  | "fogBanks"
  | "garden"
  | "groundPalette"
  | "expeditionTheme"
  | "nation"
  | "tilledPatch"
  | "glDebug"
  | "glEmulate"
  | "ground"
  | "horse"
  | "hour"
  | "navDebug"
  | "offlineSkipAfterMs"
  | "passProfile"
  | "profile"
  | "quality"
  | "rain"
  | "renderer"
  | "reveal"
  | "sceneDepth"
  | "sceneTarget"
  | "shadowCascades"
  | "snow"
  | "spikeNoOffscreen"
  | "stress"
  | "unlockAll"
  | "view"
  | "waterReflections"
  | "workerRingMode">;

const readNumber = (query: URLSearchParams, key: string, fallback: number) => {
  const value = Number(query.get(key));
  return Number.isFinite(value) && query.has(key) ? value : fallback;
};

const readView = (query: URLSearchParams) => {
  const parts = query.get("view")?.split(",").map(Number);
  if (!parts || parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { x: parts[0]!, z: parts[1]!, zoom: parts[2]! };
};

const readHour = (value: string | null) => {
  if (value && value in TIME_PRESETS) return TIME_PRESETS[value as keyof typeof TIME_PRESETS];
  const hour = Number(value);
  return value !== null && Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : TIME_PRESETS.day;
};

/** The skip delay is a product rule; only a dev server may shorten it for the acceptance test. */
const readOfflineSkipAfterMs = (value: string | null) => {
  const milliseconds = Number(value);
  return import.meta.env.DEV && value !== null && Number.isFinite(milliseconds) && milliseconds >= 0
    ? milliseconds : OFFLINE_SKIP_AFTER_MS;
};

/** `?cascades=1|2|3` (R08 A/B; 1 is the single-map rollback); null for anything else. */
const readShadowCascades = (value: string | null): DevParams["shadowCascades"] => {
  if (value === "1" || value === "2" || value === "3") return Number(value) as NonNullable<DevParams["shadowCascades"]>;
  return null;
};

/**
 * Hidden admin/dev renderer setting. WG-0: a lane can keep `island.renderer=webgpu` in its browser
 * profile without a query string; an explicit `?renderer=` wins and is stored for the next reload.
 */
const readStoredRendererChoice = () => {
  try {
    return readRendererChoice(localStorage.getItem(RENDERER_CHOICE_STORAGE_KEY));
  } catch {
    return "webgl" as const;
  }
};

const storeRendererChoice = (choice: ReturnType<typeof readRendererChoice>) => {
  try {
    localStorage.setItem(RENDERER_CHOICE_STORAGE_KEY, choice);
  } catch {
    // A private/blocked storage only loses the persistence, not the current choice.
  }
};

/** A stored WebGPU choice applies on every reload without a query; the dev marker keeps it visible. */
const showStoredWebGpuChoice = (choice: Exclude<RendererChoice, "webgl">) => {
  if (!import.meta.env.DEV) return;
  void import("./webgpu-spike-marker")
    .then(module => module.showWebGpuSpikeMarker(choice))
    .catch(() => undefined);
};

/** `?tonemap=` and `?exposure=` (decision D2 captures); null when neither is valid. */
const readColorOutput = (query: URLSearchParams) => {
  const toneMapper = readColorToneMapper(query.get("tonemap"));
  const exposure = readColorExposure(query.get("exposure"));
  if (toneMapper === null && exposure === null) return null;
  return {
    ...(toneMapper === null ? {} : { toneMapper }),
    ...(exposure === null ? {} : { exposure })
  };
};

/** `?sand=` / `?soil=` / `?rock=` palette ids (unknown ids stay automatic). */
const readGroundPaletteQuery = (query: URLSearchParams): GroundPalette => {
  const rock = query.get("rock");
  const sand = query.get("sand");
  const soil = query.get("soil");
  return {
    ...(isRockPalette(rock) ? { rock } : {}),
    ...(isSandPalette(sand) ? { sand } : {}),
    ...(isSoilPalette(soil) ? { soil } : {})
  };
};

/**
 * Test/review overrides for the admin page and local dev player. Product params are parsed by
 * `readAppParams`; production player entries never import this module.
 */
export const readDevParams = (search: string): Partial<DevParams> => {
  const query = new URLSearchParams(search);
  const params: Partial<DevParams> = {};
  if (query.has("ao")) params.ambientOcclusion = readAmbientOcclusion(query.get("ao"));
  if (query.has("bloom")) params.bloom = readBloomQuality(query.get("bloom"));
  if (query.has("ssr")) params.waterReflections = readWaterReflections(query.get("ssr"));
  // `?girth=0`: the published donor bodies without the girth fit (before/after review, rollback check).
  if (query.has("girth")) BODY_GIRTH.enabled = query.get("girth") !== "0";
  if (query.has("tonemap") || query.has("exposure")) params.colorOutput = readColorOutput(query);
  if (query.has("cinematicTest")) params.cinematicTest = query.get("cinematicTest") === "1";
  if (query.has("crowd")) params.crowdMode = readCrowdMode(query.get("crowd"));
  if (query.has("prewarm")) params.explorationPrewarm = query.get("prewarm") !== "off";
  if (query.has("depth")) params.sceneDepth = query.get("depth") === "1";
  if (query.has("farprops")) params.farPropsMode = readFarPropsMode(query.get("farprops"));
  if (query.has("flagdemo")) params.flagDemo = query.get("flagdemo") === "1";
  if (query.has("flyers")) params.flyerSheet = readNumber(query, "flyers", 0);
  if (query.has("fogbanks")) params.fogBanks = query.get("fogbanks") === "1";
  if (query.has("garden")) params.garden = query.get("garden") === "1";
  if (["rock", "sand", "soil"].some(key => query.has(key))) params.groundPalette = readGroundPaletteQuery(query);
  const expedition = query.get("expedition");
  if (isAdventureTheme(expedition)) params.expeditionTheme = expedition;
  const tilled = query.get("tilled")?.split(",").map(Number);
  if (tilled?.length === 3 && tilled.every(Number.isFinite)) {
    params.tilledPatch = { radius: tilled[2]!, x: tilled[0]!, z: tilled[1]! };
  }
  const nation = query.get("nation");
  if (isWorkerNation(nation)) params.nation = nation;
  if (query.has("gldebug")) params.glDebug = query.get("gldebug") === "1";
  if (query.has("glemulate"))
    params.glEmulate = query.get("glemulate") === "mali" ? "mali" : null;
  if (query.has("ground")) params.ground = readGroundShaderRequest(query.get("ground"));
  if (query.has("hdr")) params.sceneTarget = readSceneTarget(query.get("hdr"));
  if (query.has("horse")) params.horse = query.get("horse") === "1";
  if (query.has("time")) params.hour = readHour(query.get("time"));
  if (query.has("navdebug")) params.navDebug = query.get("navdebug") === "1";
  if (query.has("offlineSkipMs")) params.offlineSkipAfterMs = readOfflineSkipAfterMs(query.get("offlineSkipMs"));
  if (query.has("passes")) params.passProfile = query.get("passes") === "1";
  if (query.has("profile")) params.profile = query.get("profile") === "1";
  if (query.has("quality")) {
    const quality = query.get("quality");
    params.quality = isQualityLevel(quality) ? quality : null;
  }
  if (query.has("rain")) params.rain = query.get("rain") === "1";
  if (query.has("renderer")) {
    params.renderer = readRendererChoice(query.get("renderer"));
    storeRendererChoice(params.renderer);
  } else {
    const stored = readStoredRendererChoice();
    if (stored !== "webgl") {
      params.renderer = stored;
      showStoredWebGpuChoice(stored);
    }
  }
  if (query.has("reveal")) params.reveal = query.get("reveal") === "1";
  if (query.has("rings")) params.workerRingMode = readWorkerRingMode(query.get("rings"));
  if (query.has("cascades")) params.shadowCascades = readShadowCascades(query.get("cascades"));
  if (query.has("snow")) params.snow = query.get("snow") === "1";
  if (query.has("wg0")) params.spikeNoOffscreen = query.get("wg0") === "nooffscreen";
  if (query.has("stress")) params.stress = query.get("stress") === "1";
  if (query.has("unlockall")) params.unlockAll = query.get("unlockall") === "1";
  if (query.has("view")) params.view = readView(query);
  return params;
};
