import { MIN_PITCH } from "./camera-state";
import type { CinematicViewLimits } from "./cinematic/cinematic-frame";
import type { GrassRingLevel } from "./grass/grass-ring-layout";

export type QualityLevel = "minimal" | "low" | "medium" | "high";

/**
 * R10 scene target of the frame compositor: "off" draws straight to the canvas; "rgba8" keeps every
 * material's final display pixel (pixel-identical, one MSAA resolve, output copy); "rgba16f" keeps
 * the tonemapped colour before the grade in half float (HDR headroom for R11, +1.2 ms at 1080p).
 */
export type SceneTarget = "off" | "rgba8" | "rgba16f";

/** Every scene target, cheapest first (the order of the Colour precision choices). */
export const SCENE_TARGETS: readonly SceneTarget[] = ["off", "rgba8", "rgba16f"];

const SCENE_TARGET_ALIASES: Readonly<Record<string, SceneTarget>> = {
  0: "off", 1: "rgba16f", off: "off", rgba16f: "rgba16f", rgba8: "rgba8"
};

/** `?hdr=off|rgba8|rgba16f` (0 and 1 alias off and rgba16f); null for anything else. */
export const readSceneTarget = (value: string | null): SceneTarget | null =>
  value !== null && Object.hasOwn(SCENE_TARGET_ALIASES, value) ? SCENE_TARGET_ALIASES[value]! : null;

/** Slider order of the Detail setting: cheapest first. */
export const QUALITY_LEVELS: readonly QualityLevel[] = ["minimal", "low", "medium", "high"];

/**
 * HDR bloom (R11b): "off" draws no extra pass at all; "low" keeps a 3-level mip chain and "on" a
 * 5-level one. The chain runs after the frame's resolve and feeds the linear output pass.
 */
export type BloomQuality = "off" | "low" | "on";

/** The Bloom choices in select order, cheapest first. */
export const BLOOM_QUALITIES: readonly BloomQuality[] = ["off", "low", "on"];

/** `?bloom=off|low|on`; null for anything else. */
export const readBloomQuality = (value: string | null): BloomQuality | null =>
  value !== null && (BLOOM_QUALITIES as readonly string[]).includes(value)
    ? value as BloomQuality
    : null;

/**
 * Exposure of the frame (R11c): "fixed" keeps the time-of-day exposure in every view; "fps-auto"
 * lets the possessed (first-person) eye adapt to the frame's luminance (eye-adaptation.ts). The
 * strategic view is fixed on every level.
 */
export type ExposureMode = "fixed" | "fps-auto";

/**
 * Screen-space ambient occlusion (R12b): half-resolution GTAO from the scene depth, applied in the
 * output pass. "off" creates no pass, no target and no depth resolve for it; "soft", "strong" and
 * "dramatic" run the same passes and shaders and differ only in their tuning uniforms
 * (AO_LEVEL_TUNING), so Strong and Dramatic cost nothing extra.
 */
export type AmbientOcclusion = "off" | "soft" | "strong" | "dramatic";

/** The choices that run the pass. */
export type ActiveAmbientOcclusion = Exclude<AmbientOcclusion, "off">;

/** The Ambient occlusion choices in select order, cheapest first. */
export const AMBIENT_OCCLUSIONS: readonly AmbientOcclusion[] = ["off", "soft", "strong", "dramatic"];

/** Detail levels that may run the pass at all; Low and Minimal never create it. */
export const AMBIENT_OCCLUSION_LEVELS: readonly QualityLevel[] = ["medium", "high"];

/** The former Off/On setting stored "on": that single strength is Soft now. */
const LEGACY_AMBIENT_OCCLUSION_ON = "on";

/**
 * `?ao=off|soft|strong|dramatic` and stored overrides; a legacy "on" migrates to "soft". Null for anything
 * else.
 */
export const readAmbientOcclusion = (value: unknown): AmbientOcclusion | null => {
  if (value === LEGACY_AMBIENT_OCCLUSION_ON) return "soft";
  return (AMBIENT_OCCLUSIONS as readonly unknown[]).includes(value) ? value as AmbientOcclusion : null;
};

/**
 * Screen-space water reflections (R18b): a half-resolution pass over the water surface only marches
 * its mirror rays through the frame's depth and fades into the sky reflection where a ray leaves the
 * screen or misses. "off" creates no pass, no target and no depth resolve for it.
 */
export type WaterReflections = "off" | "on";

/** The Water reflections choices in select order, cheapest first. */
export const WATER_REFLECTIONS: readonly WaterReflections[] = ["off", "on"];

/** Detail levels that may run the pass at all; Low and Minimal never create it. */
export const WATER_REFLECTION_LEVELS: readonly QualityLevel[] = ["medium", "high"];

/** Detail levels that may build the winter ice floes; Low and Minimal never create them. */
export const ICE_FLOE_LEVELS: readonly QualityLevel[] = ["medium", "high"];

/** `?ssr=off|on` and stored overrides; null for anything else. */
export const readWaterReflections = (value: unknown): WaterReflections | null =>
  (WATER_REFLECTIONS as readonly unknown[]).includes(value) ? value as WaterReflections : null;

/**
 * Volumetric sun shafts (R06c): "fps-half" ray-marches the sun shadow map at half resolution in the
 * possessed view only; "off" creates no pass, no target and no depth resolve for it.
 */
export type VolumetricLight = "off" | "fps-half";

/** Detail levels that may run the sun shafts at all (the Sun rays setting); the others never create them. */
export const VOLUMETRIC_LIGHT_LEVELS: readonly QualityLevel[] = ["high"];

/**
 * Lawn depth (OD-T4): how deeply dense meadow reads in the ground shading. "off" keeps the
 * untouched ground (and skips the cover-field fetch); "normal" and "strong" darken the clump
 * areas with a slightly cooler self-shaded hue and lower sky occlusion.
 */
export type LawnDepth = "off" | "normal" | "strong";

/** The Lawn depth choices in select order, flattest first. */
export const LAWN_DEPTHS: readonly LawnDepth[] = ["off", "normal", "strong"];

/**
 * uLawnDepth of the ground shaders: rgb albedo shade, w occlusion. Off is the exact no-op
 * (1, 1, 1, 1), whose w also skips the cover-field texture fetch.
 */
export const LAWN_DEPTH_UNIFORMS: Readonly<
  Record<LawnDepth, readonly [number, number, number, number]>
> = {
  normal: [0.86, 0.9, 0.84, 0.82],
  off: [1, 1, 1, 1],
  strong: [0.74, 0.82, 0.72, 0.65]
};

/**
 * Surf and wake foam pattern (R18a): "full" layers two noise octaves, "lite" keeps one (the same
 * surf phase and shape, one texture fetch less per water pixel).
 */
export type WaterFoam = "full" | "lite";

/**
 * Everything that trades looks for speed, per quality level (the Detail setting). The drawing
 * buffer size is the Resolution setting's job (resolution.ts).
 */
/**
 * R15a possessed far trees: "full" samples the four nearest of the 8 x 4 baked views (azimuth and
 * elevation blend), "azimuth" the two nearest azimuths of the closest elevation row, "off" keeps
 * the iso-angle sprites (the rollback, and Low / Minimal: no extra bake or atlas memory there).
 */
export type TreeViewImpostors = "off" | "azimuth" | "full";

export interface QualityPreset {
  /** Half-resolution GTAO (R12b); only Medium and High may switch it on. */
  ambientOcclusion: AmbientOcclusion;
  /** Restrained strategic atmosphere; walking keeps its cheap height profile on every tier. */
  atmosphere: boolean;
  /** Two slowly drifting analytical mist banks in the strategic (isometric) view. */
  atmosphereBanks: boolean;
  /** animals seen through crowns and hills (an extra pass over the animals). */
  animalSilhouettes: boolean;
  /** HDR bloom mip chain (R11b): off draws no extra pass. */
  bloom: BloomQuality;
  /** Possessed-eye auto-exposure (R11c); needs the scene target, so Low and Minimal stay fixed. */
  exposureMode: ExposureMode;
  /**
   * How strongly the possessed eye adapts where exposureMode runs (0..1, the Auto-exposure slider):
   * 1 is the R11c tuning, lower values scale its compensation and EV range down.
   */
  exposureStrength: number;
  /**
   * R16b: possessed-view radius (world units, around the eye) within which buildings draw their
   * Detailed recipe regardless of the strategic zoom; 0 keeps the zoom rule (Minimal: simple only).
   */
  buildingEyeDetailRadius: number;
  /** Character LOD cap, A/B tier caps per view (C03) and the sun-shadow caster budget (C07). */
  characters: {
    /**
     * Finest authored level a body may use (0 = the full-detail LOD0). Minimal and Low start at
     * LOD1: their bodies never load LOD0 (C05); coarser levels follow the projected size.
     */
    lodMax: 0 | 1 | 2 | 3;
    /** Finest authored level a soldier body may use; Minimal keeps soldiers at LOD2 (owner 2026-11-07). */
    soldierLodMax: 0 | 1 | 2 | 3;
    fpsCaps: readonly [number, number];
    isoCaps: readonly [number, number];
    /** Most characters (people and riders) that cast a sun shadow in one frame. */
    shadowCasters: number;
    /** Smallest projected height (device px) that still casts; `null` never casts (contact ring). */
    shadowCastPixels: number | null;
  };
  /**
   * Campaign cinematic camera (CIN2): Minimal lifts flat shots to 30 degrees and caps the far plane so
   * the horizon stays out of a phone's triangle/fill budget; it also draws fewer area glint sparkles.
   */
  cinematicView: CinematicViewLimits;
  /**
   * D07b: near-tier road decorations and decoration plants cast into the sun map (depth twins on the
   * near-caster layer, sized by the decoration LOD's projected-size gate). Needs `sunShadows`.
   */
  decorationShadows: boolean;
  /**
   * D08: near-tier decoration plants sway with the shared world wind (trunk < branch < leaf, the same
   * offset in the sun-shadow pass); structures never move. High only; off is the rollback.
   */
  decorationWind: boolean;
  /**
   * Most decorative fish swimming in the shallows (FISH-SCHOOLS): drawn only into the seabed
   * refraction capture, so presets without refraction build no fish layer (0).
   */
  fishSchools: number;
  /**
   * Fog-of-war cover over hidden cells (R07): "lit" shades the drifting cloud cover as a sunlit
   * relief (fake normal, self-shadow, view parallax); "flat" keeps the 2D cover. Both conceal
   * exactly the same cells.
   */
  fogOfWarStyle: "flat" | "lit";
  /** Field cover (grass tufts) drawn. */
  grass: boolean;
  /** Field cover samples per cell (grass tuft density). */
  grassSamples: number;
  /** T07 possessed near grass ring: off (Low, Minimal), compact (Medium) or dense (High). */
  grassRing: GrassRingLevel;
  /**
   * R14c possessed parallax occlusion mapping on paths, sand and gravel (8–16 height steps in the
   * near band, ground-parallax-glsl.ts). High only; off compiles the ground without it.
   */
  groundParallax: boolean;
  /**
   * Edge (px) of the ground texture array layers (TT-3): Low and up keep the painted 512² tiles; Minimal
   * uploads their 256² level (a quarter of the memory; the iso view already samples that mip).
   */
  groundTileSize: GroundTileSize;
  /**
   * Real 3D ice floes on winter coasts (three-ice-floes.ts). Off builds no mesh and draws nothing;
   * only Medium and High offer them (ICE_FLOE_LEVELS).
   */
  iceFloes: boolean;
  /** Dense meadow depth in the ground shading (Off, Normal, Strong). */
  lawnDepth: LawnDepth;

  /** Ground shader "lite" variant (fewer detail layers per pixel). */
  liteGround: boolean;
  /** from this zoom on plants draw their full LOD (stems, twigs, every leaf). */
  plantDetailZoom: number;
  /**
   * Rainbow after rain in the possessed view (atmosphere/rainbow.ts): a few ALU in the sky and
   * the shared airlight, no pass or texture. Iso never shows it.
   */
  rainbow: boolean;
  /** seabed refraction pass; off: the water blends over the seabed already drawn. */
  refraction: boolean;
  /** refraction pass size relative to the screen. */
  refractionScale: number;
  /**
   * Lowest render scale the budget controller (R09) may use on this level when the player keeps
   * the level's default; up close blur is more visible, so the FPS view adds a margin.
   */
  renderScaleMin: number;
  /**
   * Rock detail: detail normals, the second texture octave, fine grain, runoff, oxidation and
   * secondary cracks (off: the lite rock shader, form and snow stay).
   */
  rockDetail: boolean;
  /**
   * Road-verge plants drawn at most (card V-R01b): `near` with the authored High parts, `far` with
   * the whole-plant Minimal cards. Paid road content on every level; Minimal draws no High parts.
   */
  roadVerges: { far: number; near: number };
  /**
   * R10 frame compositor target (SceneTarget): every world layer of the frame draws into one MSAA
   * scene target, resolved once, then one output pass writes the canvas (the hook for R11–R13).
   */
  sceneTarget: SceneTarget;
  /**
   * R08 sun shadow cascades of the possessed (first-person) view: 1 keeps the single eye-centred
   * map (the rollback), 2 (Medium) and 3 (High, the third one cached) split the map into 2048²
   * atlas tiles that reach the fog. The isometric view always uses one fitted map.
   */
  shadowCascadesFps: 1 | 2 | 3;
  /**
   * Sun shadow lookup: "pcf3" the 3 x 3 PCF, "poisson12" a rotated 12-tap Poisson disc with a
   * cheap contact-hardening penumbra (R08, High).
   */
  shadowFilter: "pcf3" | "poisson12";
  /** sun shadow map resolution (the atlas side with cascades). */
  shadowMapSize: number;
  /**
   * Sky environment reflection (R05 PMREM) on the building and crowd scenes: metals and the
   * dielectric Fresnel sheen reflect the shared sky. Off: SH9 ambient only, no bake.
   */
  skyEnvironment: boolean;
  /**
   * Sky radiance source of the possessed and perspective skies (R06b): "lut" samples the shared
   * sky-view LUT texture, "analytic" evaluates the same model per pixel (no texture, no upload).
   */
  skyModel: "analytic" | "lut";
  /**
   * Most moving ships and boats that trail a foam wake (R18a): one blended ribbon draw for all of
   * them, only over the pixels they cover; 0 builds no wake layer.
   */
  shipWakes: number;
  /**
   * SHIP-WIND: sails billow along the world wind relative to each ship's heading and flutter at their free
   * edges (vertex shader, one shared uniform). Off keeps the authored rest cloth with no shader patch.
   */
  shipClothWind: boolean;
  /** sun shadow pass (props, rocks and terrain shadow each other). */
  sunShadows: boolean;
  /** Traffic wear from walking/cart actors (presentation-only; all presets per D4). */
  trafficWear: boolean;
  /** below this zoom trees are drawn as baked impostor sprites. */
  treeImpostorZoom: number;
  /**
   * R15a view atlas memory budget (MiB, both maps with mips): the layout picks the highest texel
   * density that fits it. Owner 2026-11-12: High 64, Medium 32; 0 where the layer is off.
   */
  treeViewAtlasMiB: number;
  /** R15a hemispherical view impostors of the possessed far trees (iso view unchanged). */
  treeViewImpostors: TreeViewImpostors;
  /**
   * Extra grade saturation of the Vivid tone (0.1 = +10 %), calibrated per preset so the day
   * isometric mean saturation matches the pre-R04 baseline (R04b receipt).
   */
  vividSaturationBoost: number;
  /** Possessed-view sun shafts (R06c); only High runs them, the strategic view never does. */
  volumetricLight: VolumetricLight;
  /**
   * Brightness of the sun shafts where volumetricLight runs (0..2, the Sun rays slider): 1 is the
   * R06c intensity, 2 doubles it.
   */
  volumetricLightStrength: number;
  /** Surf and wake foam pattern detail. */
  waterFoam: WaterFoam;
  /** Screen-space water reflections (R18b); only Medium and High may switch them on. */
  waterReflections: WaterReflections;
  /** rain and snowfall particles (the weather itself still shades the world). */
  weatherParticles: boolean;
  /**
   * Rare decorative whale surfacings (render only): "full" draws the detailed body with skin
   * relief, sun shadow and a 320 particle spray, switching to the light body when small on screen;
   * "lite" always draws the light body (about 900 triangles) without relief or shadow, 120 particles.
   */
  whales: WhaleDetailLevel;
}

export type WhaleDetailLevel = "full" | "lite";

export type GroundTileSize = 256 | 512;

/** Minimal cinematic clamp: lowest shot pitch (30 degrees) and the far plane cap (world units). */
const MINIMAL_CINEMATIC_PITCH = Math.PI / 6;
const MINIMAL_CINEMATIC_FAR = 320;

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  high: {
    ambientOcclusion: "soft",
    animalSilhouettes: true,
    atmosphere: true,
    atmosphereBanks: true,
    bloom: "on",
    buildingEyeDetailRadius: 70,
    characters: { lodMax: 0, soldierLodMax: 0, fpsCaps: [8, 40], isoCaps: [4, 40], shadowCasters: 64, shadowCastPixels: 30 },
    cinematicView: { far: Infinity, glintSprites: 96, minPitch: MIN_PITCH },
    decorationShadows: true,
    decorationWind: true,
    exposureMode: "fps-auto",
    exposureStrength: 1,
    fishSchools: 160,
    fogOfWarStyle: "lit",
    grass: true,
    // grass-band 2026-11-14 (owner: dense meadow on High): 10 -> 14 tufts per cell, so the meadow beyond
    // the possessed ring matches the denser ring (grass-ring-layout DENSE.tuftCover).
    grassSamples: 14,
    grassRing: "dense",
    groundParallax: true,
    groundTileSize: 512,
    iceFloes: true,
    lawnDepth: "strong",
    liteGround: false,
    plantDetailZoom: 1.3,
    rainbow: true,
    refraction: true,
    refractionScale: 0.5,
    renderScaleMin: 0.75,
    rockDetail: true,
    roadVerges: { far: 7000, near: 2400 },
    sceneTarget: "rgba8",
    shadowCascadesFps: 3,
    shadowFilter: "poisson12",
    shadowMapSize: 4096,
    skyEnvironment: true,
    skyModel: "lut",
    shipClothWind: true,
    shipWakes: 12,
    sunShadows: true,
    trafficWear: true,
    treeImpostorZoom: 0.55,
    treeViewAtlasMiB: 64,
    treeViewImpostors: "full",
    vividSaturationBoost: 0.1,
    volumetricLight: "fps-half",
    volumetricLightStrength: 1,
    waterFoam: "full",
    waterReflections: "on",
    weatherParticles: true,
    whales: "full"
  },
  medium: {
    ambientOcclusion: "off",
    animalSilhouettes: true,
    atmosphere: true,
    atmosphereBanks: false,
    bloom: "low",
    buildingEyeDetailRadius: 55,
    characters: { lodMax: 0, soldierLodMax: 0, fpsCaps: [4, 24], isoCaps: [2, 24], shadowCasters: 40, shadowCastPixels: 30 },
    cinematicView: { far: Infinity, glintSprites: 72, minPitch: MIN_PITCH },
    decorationShadows: true,
    decorationWind: false,
    exposureMode: "fps-auto",
    exposureStrength: 1,
    fishSchools: 120,
    fogOfWarStyle: "lit",
    grass: true,
    grassSamples: 6,
    grassRing: "compact",
    groundParallax: false,
    groundTileSize: 512,
    iceFloes: true,
    lawnDepth: "strong",
    liteGround: false,
    plantDetailZoom: 1.7,
    rainbow: true,
    refraction: true,
    refractionScale: 0.5,
    renderScaleMin: 0.7,
    rockDetail: true,
    roadVerges: { far: 5500, near: 1600 },
    sceneTarget: "rgba8",
    shadowCascadesFps: 2,
    shadowFilter: "pcf3",
    shadowMapSize: 2048,
    skyEnvironment: true,
    skyModel: "lut",
    shipClothWind: true,
    shipWakes: 8,
    sunShadows: true,
    trafficWear: true,
    treeImpostorZoom: 0.8,
    treeViewAtlasMiB: 32,
    treeViewImpostors: "azimuth",
    vividSaturationBoost: 0.1,
    volumetricLight: "off",
    volumetricLightStrength: 1,
    waterFoam: "full",
    waterReflections: "off",
    weatherParticles: true,
    whales: "full"
  },
  low: {
    ambientOcclusion: "off",
    animalSilhouettes: true,
    atmosphere: true,
    atmosphereBanks: false,
    bloom: "off",
    buildingEyeDetailRadius: 40,
    characters: { lodMax: 1, soldierLodMax: 1, fpsCaps: [2, 16], isoCaps: [1, 16], shadowCasters: 16, shadowCastPixels: 120 },
    cinematicView: { far: Infinity, glintSprites: 48, minPitch: MIN_PITCH },
    decorationShadows: false,
    decorationWind: false,
    exposureMode: "fixed",
    exposureStrength: 1,
    fishSchools: 64,
    fogOfWarStyle: "flat",
    grass: true,
    grassSamples: 3,
    grassRing: "off",
    groundParallax: false,
    groundTileSize: 512,
    iceFloes: false,
    lawnDepth: "strong",
    liteGround: false,
    plantDetailZoom: 2.3,
    rainbow: false,
    refraction: true,
    refractionScale: 0.35,
    renderScaleMin: 0.65,
    rockDetail: true,
    roadVerges: { far: 4000, near: 900 },
    sceneTarget: "off",
    shadowCascadesFps: 1,
    shadowFilter: "pcf3",
    shadowMapSize: 1024,
    skyEnvironment: false,
    skyModel: "analytic",
    shipClothWind: true,
    shipWakes: 4,
    sunShadows: true,
    trafficWear: true,
    treeImpostorZoom: 1.1,
    treeViewAtlasMiB: 0,
    treeViewImpostors: "off",
    vividSaturationBoost: 0.1,
    volumetricLight: "off",
    volumetricLightStrength: 1,
    waterFoam: "lite",
    waterReflections: "off",
    weatherParticles: true,
    whales: "lite"
  },
  /**
   * Optional passes off (weak GPUs and phones), except the two-sample min-LOD grass that keeps the
   * biome readable; plant contact shadows stay: without sun shadows they are all that grounds the trees.
   */
  minimal: {
    ambientOcclusion: "off",
    animalSilhouettes: false,
    atmosphere: false,
    atmosphereBanks: false,
    bloom: "off",
    buildingEyeDetailRadius: 0,
    characters: { lodMax: 1, soldierLodMax: 2, fpsCaps: [1, 8], isoCaps: [0, 8], shadowCasters: 0, shadowCastPixels: null },
    cinematicView: { far: MINIMAL_CINEMATIC_FAR, glintSprites: 24, minPitch: MINIMAL_CINEMATIC_PITCH },
    decorationShadows: false,
    decorationWind: false,
    exposureMode: "fixed",
    exposureStrength: 1,
    fishSchools: 0,
    fogOfWarStyle: "flat",
    // BIOME-GRASS (2026-11-18): a two-sample min-LOD sward keeps the biome readable on phones.
    grass: true,
    grassSamples: 2,
    grassRing: "off",
    groundParallax: false,
    groundTileSize: 256,
    iceFloes: false,
    lawnDepth: "strong",
    liteGround: true,
    plantDetailZoom: Infinity,
    rainbow: false,
    refraction: false,
    refractionScale: 0.35,
    renderScaleMin: 0.6,
    rockDetail: false,
    roadVerges: { far: 2400, near: 0 },
    sceneTarget: "off",
    shadowCascadesFps: 1,
    shadowFilter: "pcf3",
    shadowMapSize: 1024,
    skyEnvironment: false,
    skyModel: "analytic",
    shipClothWind: false,
    shipWakes: 0,
    sunShadows: false,
    trafficWear: true,
    treeImpostorZoom: Infinity,
    treeViewAtlasMiB: 0,
    treeViewImpostors: "off",
    vividSaturationBoost: 0,
    volumetricLight: "off",
    volumetricLightStrength: 1,
    waterFoam: "lite",
    waterReflections: "off",
    weatherParticles: false,
    whales: "lite"
  }
};

export const isQualityLevel = (value: string | null): value is QualityLevel =>
  QUALITY_LEVELS.includes(value as QualityLevel);
