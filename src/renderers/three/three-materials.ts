import {
  CustomBlending,
  DataTexture,
  GLSL3,
  type IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RawShaderMaterial,
  RepeatWrapping,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
  Vector4
} from "three";

import type { GroundShaderVariant } from "../../render-common/ground-shader-variant";
import type { WaterFoam } from "../../render-common/quality";
import type { SharedUniformValues } from "../../render-common/shader-uniforms";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { GROUND_CLIMATE_GLSL } from "../../render-common/shaders/ground-climate-glsl";
import { GROUND_PALETTE_APPLY_GLSL } from "../../render-common/shaders/ground-palette-glsl";
import { GROUND_SCORCH_GLSL } from "../../render-common/shaders/ground-scorch-glsl";
import { GROUND_VARIANT_LAYERS_GLSL } from "../../render-common/shaders/ground-variant-layers-glsl";
import { GROUND_VARIANT_GLSL } from "../../render-common/shaders/ground-variants-glsl";
import { GROUND_WETNESS_GLSL } from "../../render-common/shaders/ground-wetness-glsl";
import { RIVER_BED_GLSL } from "../../render-common/shaders/river-bed-glsl";
import { SEASON_SNOW_GROUND_GLSL } from "../../render-common/shaders/season-ground-glsl";
import { SHORE_WETNESS_GLSL } from "../../render-common/shaders/shore-wetness-glsl";
import { SNOWY_SHORE_GLSL } from "../../render-common/shaders/snowy-shore-glsl";
import { createWaterGlsl, WATER_GLSL, WATER_SWELL_GLSL } from "../../render-common/shaders/water-glsl";
import type { SnowMap } from "../../render-common/snow-map";
import { WATER_FIELD_GLSL } from "../../render-common/water-field";
import { createGroundPaletteUniforms } from "./three-ground-palette";
import { createRuinScorchUniforms } from "./three-ground-scorch";
import { SUN_SHADOW_GLSL } from "./three-shadows";

const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec4 splatA;
in vec4 splatB;
in vec4 splatC;
in vec4 shading;
in vec4 surface;
in vec4 theme;
in vec4 variant;
in vec4 litter;
in vec4 water;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vSplatA;
out vec4 vSplatB;
out vec4 vSplatC;
out vec4 vShading;
out vec4 vSurface;
out vec4 vTheme;
out vec4 vVariant;
out vec4 vLitter;
out vec4 vWater;

void main() {
  vWorld = position;
  vNormal = normal;
  vSplatA = splatA;
  vSplatB = splatB;
  vSplatC = splatC;
  vShading = shading;
  vSurface = surface;
  vTheme = theme;
  vVariant = variant;
  vLitter = litter;
  vWater = water;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_HEADER = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vSplatA;
in vec4 vSplatB;
in vec4 vSplatC;
in vec4 vShading;
/** Surface mask (surface-mask.ts): wetness, coast type, talus, dryness. */
in vec4 vSurface;
/** Island theme weights (xyz, the snowy weight is the rest; getThemeWeights) and w the tilled-soil paint. */
in vec4 vTheme;
/** Editor-painted ground variants (stones, moss, swamp mud, cracked earth; tilled soil is vTheme.w). */
in vec4 vVariant;
/** Crown litter (canopy-field.ts): pine needles, leaf litter; ground zones: mountain foot, dune zone. */
in vec4 vLitter;
in vec4 vWater;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
`;

/**
 * Minimal's lite ground evaluates the sky light without its quadratic band (cheapest path) and keeps
 * wet ground to tint and roughness; the full ground adds the wet film's sheen and a finer foam lace.
 */
const GROUND_VARIANT_DEFINES: Record<GroundShaderVariant, string> = {
  full: "#define GROUND_WET_SHEEN\n#define SHORE_FOAM_FINE\n#define RIVER_BED_BLEND_BAND\n#define GROUND_VARIANT_NORMALS",
  lite: "#define SKY_IRRADIANCE_L1"
};

/**
 * Snowy shore (snowy-shore-glsl.ts): only worlds with snow areas compile it, so every other
 * terrain source stays unchanged. Its snow map also keeps the frozen wet band matte (frozen).
 */
const getSnowyShoreMain = (enabled: boolean) => ({
  declarations: enabled ? SNOWY_SHORE_GLSL : "",
  frozen: enabled ? "getSnowMap(xz)" : "0.0",
  freeze: enabled ? "  color = freezeWetShore(color, xz, field.x, field.y);\n" : "",
  splat: enabled ? "  float shoreSnow = coverSnowyShore(mountainSplatB, xz, field.y);\n" : "",
  waterlineDepth: enabled ? "getSnowyShoreDepth(field.x, shoreSnow)" : "field.x"
});

/** Ground of the full or the lite variant (ground-shader-variant.ts). */
const createTerrainFragmentGlsl = (
  variant: GroundShaderVariant, snowyShore = false, shore = getSnowyShoreMain(snowyShore)
) => `
${GROUND_VARIANT_DEFINES[variant]}
${FRAGMENT_HEADER}
/** The seabed under the real weed strands keeps a softer weed tint. */
const float WEED_BED_STRENGTH = 0.5;
${GROUND_VARIANT_GLSL[variant]}
#ifdef SEASON_SNOW
${SEASON_SNOW_GROUND_GLSL}
#endif
${WATER_GLSL}
${WATER_FIELD_GLSL}
${FOG_OF_WAR_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${GROUND_PALETTE_APPLY_GLSL}
${GROUND_VARIANT_LAYERS_GLSL}
${GROUND_CLIMATE_GLSL}
${GROUND_SCORCH_GLSL}
${GROUND_WETNESS_GLSL}
${SHORE_WETNESS_GLSL}
${RIVER_BED_GLSL}
${shore.declarations}
void main() {
  vec2 xz = vWorld.xz;
  // Gentle mountain rock reads as the apron gravel, walls as bare rock, and loose cover and snow
  // slide off walls (ground-cliff-glsl.ts). Render-only weights preserve deposits, navigation and
  // saved-world material data.
  vec3 groundNormal = normalize(vNormal);
  vec4 mountainSplatA = vSplatA;
  vec4 mountainSplatB = vSplatB;
  vec4 mountainSplatC = vSplatC;
  float apron = shedOntoCliffs(mountainSplatA, mountainSplatB, mountainSplatC, groundNormal);
  shapeSummitSnow(mountainSplatA, mountainSplatB, mountainSplatC, vWorld, groundNormal, vShading.y);
  shapeRiverBed(mountainSplatA, mountainSplatB, vWater.zw, vWater.x, xz);
  // T1: the global season's snow cover (the loose ground, and rock and mine ground where the slope holds it, move
  // to snow); the detail layers keep to the bare share.
#ifdef SEASON_SNOW
  float seasonBare = 1.0 - coverSeasonSnow(mountainSplatA, mountainSplatB, mountainSplatC, xz, vWater.x,
    groundNormal, apron) * getSnowKeep(xz);
#else
  float seasonBare = 1.0;
#endif
  vec4 field = sampleWaterField(xz);
${shore.splat}  float signedDepth = ${shore.waterlineDepth};
  GroundSample ground = sampleGround(vWorld, mountainSplatA, mountainSplatB, mountainSplatC,
    groundNormal, vShading.w, getGroundDryness(vTheme, vSurface));
  // GROUND-PALETTE: island sand/soil palette, clover, quarry/apron tint and the sand's wet factor, then the
  // render-only variant tiles (stony shore and scree, moss, swamp mud, cracked earth / salt flat).
  GroundContext groundContext = getGroundContext(vTheme, apron, vWater.x);
  applyGroundPalette(ground, groundContext);
#ifdef SEASON_SNOW
  coolSeasonShore(ground.albedo, ground.paletteShares.x + ground.paletteShares.y, vWater.x);
#endif
  // The masks read the raw splat varyings: keeping the shaped splat live across sampleGround's layer loops
  // raised the register pressure (+0.4 ms High, lane/ground-palette TOOL-4).
  float grass = clamp(vSplatA.x + vSplatA.y, 0.0, 1.0) * seasonBare;
  vec2 alpineZone = getAlpineZone(vWorld, vLitter.z);
  applyAlpineGrass(ground, grass, alpineZone);
  // Step 5 climate detail: heather moorland, dune grass behind the beach, tidal silt flats.
  applyHeather(ground, getHeatherMask(grass, groundContext.heather, vSurface.w, vWorld), xz);
  applyDuneGrass(ground, vLitter.w * seasonBare, vSplatB.x, -signedDepth, xz);
  float tidal = getTidalFlat(vSurface.y, vSplatB.x, -signedDepth, groundNormal, xz, getThemeWeights(vTheme).w);
  // Painted tilled soil (theme.w) and the crop plots' cultivated soil, furrowed along the field rows.
  float fieldSoil = sampleFieldSoil(xz);
  GroundDetail detail = getGroundDetail(vSplatA, vSplatB, vSplatC, vSurface, getThemeWeights(vTheme), vVariant,
    max(vTheme.w, fieldSoil) * seasonBare, vShading.w, signedDepth, groundContext.swamp, groundNormal, vWorld,
    alpineZone);
  detail.variants *= seasonBare;
  detail.fieldRows = fieldSoil;
  detail.litter = getGroundLitterMasks(vSplatA, vSplatB, vLitter, getThemeWeights(vTheme), vWorld) * seasonBare;
  detail.basalt = getBasaltMask(ground, groundContext, groundNormal);
  applyGroundVariants(ground, detail, groundContext, groundNormal, xz, signedDepth);
  applyTidalSilt(ground, tidal, xz);
  // Step 7: the tropical jungle floor and the scorched ground around fresh ruins.
  applyJungleFloor(ground, vSplatA.z * seasonBare, groundContext.jungle);
  applyRuinScorch(ground, xz);
  // The swash sheet runs up the sand with each surf front; High ripples its surface.
  vec2 swashRipple = getSwashRipple(vWater.x, xz, vWater.zw, mountainSplatB, groundNormal, uTime);
  float shoreOpen = getShoreOpen(mountainSplatB, getShoreFrozen(${shore.frozen}));
  applyWrackLine(ground, getWrackLine(-signedDepth, vSurface.y, vSplatB.x, xz, shoreOpen), xz);
  SwashSheet swash = getSwashSheet(signedDepth, field.y, xz, vWater.zw, groundNormal, shoreOpen, swashRipple,
    uTime);
  // Wet shore before lighting (TT-1): darker, glossier sand and rock along the swash, a damp band;
  // river banks and fall spray from the surface mask (TT-2).
  vec2 wetFilm = wetShoreGround(ground, groundNormal, mountainSplatA, mountainSplatB, signedDepth, field.y, xz,
    shoreOpen, swash, getSeasonWetness(max(vSurface.x, tidal * TIDAL_WETNESS), getThemeWeights(vTheme).y));
  float sunVisibility = bakedSunVisibility(vShading.x) * sampleSunShadow(vWorld);
  float occlusion = getCliffOcclusion(vShading.y, groundNormal);
  vec3 color = lightGround(ground, sunVisibility, occlusion, xz)
    + getWetGroundSheen(ground, wetFilm, vWorld, sunVisibility, occlusion);
  color = rollOffSwashFoam(color, swash.foam);
  color = weedBed(color, xz, field.w, field.x, vWater.zw, uTime, WEED_BED_STRENGTH);
  color = waterlineGround(color, signedDepth, xz, uTime, sunVisibility);
${shore.freeze}  color = applyFogOfWar(color, field.z, xz);
  // Submerged ground is the refraction capture or the no-extra-pass water destination. Camera
  // air belongs to the water surface in both paths, so applying it here would double count it.
  float tau = field.x <= 0.0 ? atmosphereSurfaceTau(vWorld) : 0.0;
  // In the refraction capture colorOutput keeps linear radiance: the water grades it once.
  fragColor = vec4(finishColor(color, tau), 1.0);
}
`;

/** The water surface's vertex stage: the swell lift (also drawn by the R18b reflection pass). */
export const WATER_VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec4 water;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec4 vWater;
${COMMON_UNIFORMS_GLSL}
${WATER_SWELL_GLSL}

void main() {
  float lift = getSwell(position.xz, uTime).x * getSwellCalm(water.x, water.zw);
  vec3 moved = position + vec3(0.0, lift * getMapInterior(position.xz), 0.0);
  vWorld = moved;
  vWater = water;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(moved, 1.0);
}
`;

/**
 * Opaque water over a refraction texture of the seabed (rendered just before, half size); with
 * NO_REFRACTION a premultiplied layer blended over the seabed already drawn (no extra pass).
 */
const createWaterFragmentGlsl = (winter: boolean) => `
precision highp float;
in vec3 vWorld;
in vec4 vWater;
uniform sampler2D uRefraction;
uniform vec2 uViewport;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${createWaterGlsl(winter)}
${WATER_FIELD_GLSL}
${FOG_OF_WAR_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}

#ifndef NO_REFRACTION
/**
 * Fish (FISH-SCHOOLS) mark their texels in the capture with alpha 0.25 .. 0.65: their depth as a
 * share of the water column. The seabed and weeds write 1, so the filtered alpha tells how much of
 * a texel is fish (soft edges at the half-resolution capture) and how deep it swims.
 */
float getFishShare(float alpha) {
  return smoothstep(0.97, 0.68, alpha);
}

/** Water the fish is seen through, as a share of the column (a little clearer than nature). */
const float FISH_WATER_SHARE = 0.85;

/**
 * The seabed seen through the waves (rgb) and the share of the water column in front of it (a).
 * The full wave offset suits the broad bed but would shred a small fish into slivers, so a fish
 * under this pixel keeps a gentle wobble and is seen through only the water above it; a bed pixel
 * never borrows a displaced fish fragment (it keeps its own texel instead).
 */
vec4 sampleRefraction(vec2 screenUv, vec2 offset) {
  vec4 direct = texture(uRefraction, screenUv);
  vec4 displaced = texture(uRefraction, screenUv + offset);
  vec3 bed = displaced.a < 0.995 ? direct.rgb : displaced.rgb;
  float fish = getFishShare(direct.a);
  if (fish <= 0.0) return vec4(bed, 1.0);
  vec4 swimmer = texture(uRefraction, screenUv + offset * 0.12);
  float column = clamp((swimmer.a - 0.25) / 0.4, 0.0, 1.0) * FISH_WATER_SHARE;
  return vec4(mix(bed, swimmer.rgb, fish), mix(1.0, column, fish));
}
#endif

void main() {
  vec4 field = sampleWaterField(vWorld.xz);
  float depth = max(field.x, 0.0);
  // The same swell as the vertex lift; the shallows keep a gentle share of its slope.
  vec2 swell = getSwell(vWorld.xz, uTime).yz * getSwellSlopeWeight(depth, vWater.zw);
  vec3 normal = normalize(waterNormal(vWorld.xz, vWater.zw, uTime) + vec3(-swell.x, 0.0, -swell.y));
  vec3 viewDirection = isOrthographic ? uViewDirection : normalize(cameraPosition - vWorld);
  // A shadow on water darkens the sunlit seabed and body light: deep in the shallows over bright sand,
  // softer over deep water, where the sky reflection carries more of the colour (R18b-land).
  float shade = mix(waterShadowFloor(depth), 1.0, sampleSunShadow(vWorld));
#ifdef NO_REFRACTION
  WaterLayer water = shadeWaterLayer(vWorld.xz, field.x, field.y, vWater.zw, uTime, normal, viewDirection);
  float interior = getMapInterior(vWorld.xz);
  vec3 color = water.color + OPEN_SEA_BED * water.transmit * (1.0 - interior);
  // Premultiplied scalar-alpha fallback: average RGB attenuation because this path has no
  // per-channel destination alpha. High refraction keeps the true per-channel transmission.
  float seen = dot(water.transmit, vec3(1.0 / 3.0)) * interior * shade;
  // The blend happens after the seabed's own colour output, so the premultiplied source goes
  // through the same output here (on its straight colour) before it is blended.
  vec3 source = colorOutputPremultiplied(applyFogOfWar(color * shade, field.z, vWorld.xz), 1.0 - seen);
  // The seabed is genuinely unfogged in camera air (see the terrain shader). Move the surface
  // source and its alpha through the same air segment so the premultiplied blend stays valid.
  float atmosphereTransmittance = exp(-atmosphereSurfaceTau(vWorld));
  vec3 sourceRgb = source * atmosphereTransmittance;
  if (atmosphereTransmittance < 1.0)
    sourceRgb += (1.0 - atmosphereTransmittance) * colorOutputAirlight(vWorld, atmosphereSurfaceTau(vWorld));
  float sourceAlpha = 1.0 - atmosphereTransmittance * seen;
  fragColor = vec4(sourceRgb, sourceAlpha);
#else
  vec2 screenUv = gl_FragCoord.xy / uViewport;
  // The capture holds linear seabed radiance (sRGB target, ungraded); back to the display-authored
  // values the water optics are tuned on, so the bed is graded once, by this surface.
  vec4 refracted = sampleRefraction(screenUv, normal.xz * 0.25 * min(depth, 1.0));
  vec3 bed = blendOpenSeaBed(colorSrgbEncode(refracted.rgb), vWorld.xz);
  float seenDepth = field.x * refracted.a;
  vec3 color = shadeWater(vWorld.xz, seenDepth, field.y, vWater.zw, uTime, normal, viewDirection, bed);
  // The capture excluded camera air; the opaque water surface applies it exactly once.
  fragColor = vec4(finishSurface(applyFogOfWar(color * shade, field.z, vWorld.xz), vWorld), 1.0);
#endif
}
`;

/** Small tileable data texture (noise, ripples), repeated across the world. */
export const createRepeatTexture = (pixels: Uint8Array, size: number) => {
  const texture = createAtlasTexture(pixels, size, size);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
};

export const createAtlasTexture = (
  pixels: Uint8Array,
  width: number,
  height: number,
  mips?: readonly { data: Uint8Array; height: number; width: number }[]
) => {
  const texture = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  if (mips && mips.length > 1) {
    texture.mipmaps = mips.map(mip => ({
      data: mip.data,
      height: mip.height,
      width: mip.width
    }));
    texture.generateMipmaps = false;
  } else {
    texture.generateMipmaps = true;
  }
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  texture.premultiplyAlpha = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
};

/** The snow map texture; userData flags switch the winter shader variants on. */
export const createSnowTexture = (snowMap: SnowMap) => {
  const texture = createAtlasTexture(snowMap.pixels, snowMap.width, snowMap.height);
  texture.userData.distribution = snowMap.distribution;
  texture.userData.visualWinter = snowMap.visualWinter === true;
  texture.userData.hasSnow = snowMap.hasSnow;
  texture.userData.seasonSnow = snowMap.seasonSnow === true;
  texture.userData.seasonalDistribution = snowMap.seasonSnow === true && !snowMap.hasSnow;
  return texture;
};

/** Three uniform objects whose values are the shared arrays (scalars are copied each frame). */
const fallbackFog = createAtlasTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
/** Keeps the CPU pixel reusable, releases disposed renderers' texture listeners and GPU bindings. */
export const releaseFallbackFogGpu = () => fallbackFog.dispose();
export const createThreeUniforms = (values: SharedUniformValues): Record<string, IUniform> => ({
  uLiveFog: { value: values.uLiveFog },
  uAtmosphereAirlightLinear: { value: values.uAtmosphereAirlightLinear },
  uAtmosphereSun: { value: values.uAtmosphereSun },
  uAtmosphereSunTint: { value: values.uAtmosphereSunTint },
  uAtmosphereBankA: { value: values.uAtmosphereBankA },
  uAtmosphereBankB: { value: values.uAtmosphereBankB },
  uAtmosphereBankParams: { value: values.uAtmosphereBankParams },
  uAtmosphereBoundsMin: { value: values.uAtmosphereBoundsMin },
  uAtmosphereBoundsMax: { value: values.uAtmosphereBoundsMax },
  uAtmosphereEye: { value: values.uAtmosphereEye },
  uAtmosphereFar: { value: values.uAtmosphereFar },
  uAtmosphereOrthoDepth: { value: values.uAtmosphereOrthoDepth },
  uAtmosphereForward: { value: values.uAtmosphereForward },
  uAtmospherePass: { value: values.uAtmospherePass },
  uAtmosphereRainbow: { value: values.uAtmosphereRainbow },
  uAtmosphereProfile: { value: values.uAtmosphereProfile },
  uFogMap: { value: fallbackFog },
  uAmbientGround: { value: values.uAmbientGround },
  uAmbientSky: { value: values.uAmbientSky },
  uBakedShadowWeight: { value: values.uBakedShadowWeight },
  uCloudCover: { value: values.uCloudCover },
  uCloudDrift: { value: values.uCloudDrift },
  uCloudTime: { value: values.uCloudTime },
  uColorGradeRain: { value: values.uColorGradeRain },
  uColorOutputMode: { value: values.uColorOutputMode },
  uColorToneMapper: { value: values.uColorToneMapper },
  uColorVividBoost: { value: values.uColorVividBoost },
  uDaylight: { value: values.uDaylight },
  uExplorationFog: { value: values.uExplorationFog },
  uFogColor: { value: values.uFogColor },
  uFogOfWarLit: { value: values.uFogOfWarLit },
  uHighlight: { value: values.uHighlight },
  uRain: { value: values.uRain },
  uSkyIrradiance: { value: values.uSkyIrradiance },
  uSkyReflection: { value: values.uSkyReflection },
  uSunColor: { value: values.uSunColor },
  uSunDirection: { value: values.uSunDirection },
  uSunGlint: { value: values.uSunGlint },
  uTime: { value: values.uTime },
  uViewDirection: { value: values.uViewDirection },
  uWind: { value: values.uWind },
  uWindPhase: { value: values.uWindPhase },
  uWorldSize: { value: values.uWorldSize }
});

type SnowTextureUniform = {
  userData?: {
    distribution?: boolean; hasSnow?: boolean; seasonalDistribution?: boolean; seasonSnow?: boolean;
    visualWinter?: boolean;
  };
} | undefined;

/** Worlds with snow areas (theme snow) cover their dry beach sand with snow (snowy-shore-glsl.ts). */
const hasSnowyShore = (uniforms: Record<string, IUniform>) =>
  (uniforms.uSnowMap?.value as SnowTextureUniform)?.userData?.hasSnow === true;

/** The prepared cosmetic winter freezes the whole shore at once; under the GPU season snow the ice ramps (seasons-5). */
const isPreparedFrozenShore = (snowTexture: SnowTextureUniform) =>
  snowTexture?.userData?.visualWinter === true && snowTexture.userData.seasonSnow !== true;

/**
 * Ground switches: the snow keep redistribution (when the snow map carries it), the global season's GPU snow
 * (SEASON_SNOW, T1; its keep redistribution follows the season ramp where the world has no snow), the frozen shore
 * of the prepared cosmetic winter (no wet gloss or foam residue, shore-wetness-glsl.ts) and the R14c
 * possessed parallax (QualityPreset.groundParallax; only the full variant contains it).
 */
const getTerrainDefines = (uniforms: Record<string, IUniform>, parallax: boolean) => {
  const snowTexture = uniforms.uSnowMap?.value as SnowTextureUniform;
  return {
    ...(snowTexture?.userData?.distribution === true ? { SNOW_DISTRIBUTION: "" } : {}),
    ...(snowTexture?.userData?.seasonSnow === true ? { SEASON_SNOW: "" } : {}),
    ...(snowTexture?.userData?.seasonalDistribution === true ? { SNOW_DISTRIBUTION_SEASONAL: "" } : {}),
    ...(isPreparedFrozenShore(snowTexture) ? { FROZEN_SHORE: "" } : {}),
    ...(parallax ? { GROUND_PARALLAX: "" } : {})
  };
};

/** Grounds without the island shading owner (showcases, fixtures) keep the summer ground (zero uniforms). */
const getSeasonGroundUniformDefaults = (uniforms: Record<string, IUniform>) => ({
  uSeasonCover: uniforms.uSeasonCover ?? { value: new Vector4(0, 0, 0, 0) },
  uSeasonLitter: uniforms.uSeasonLitter ?? { value: new Vector4(0, 0, 0, 0) },
  uSeasonMeadow: uniforms.uSeasonMeadow ?? { value: new Vector4(0, 0, 0, 0) }
});

export const createTerrainMaterial = (
  uniforms: Record<string, IUniform>,
  albedo: Texture,
  normal: Texture,
  variant: GroundShaderVariant,
  parallax = false
) => {
  const defines = getTerrainDefines(uniforms, parallax);
  return new RawShaderMaterial({
    ...(Object.keys(defines).length > 0 ? { defines } : {}),
    fragmentShader: createTerrainFragmentGlsl(variant, hasSnowyShore(uniforms)),
    glslVersion: GLSL3,
    uniforms: {
      ...uniforms,
      uGroundAlbedo: { value: albedo },
      uGroundNormal: { value: normal },
      // Grounds built without the island shading owner (showcases, fixtures) keep the plain ground.
      uLawnDepth: uniforms.uLawnDepth ?? { value: new Vector4(1, 1, 1, 1) },
      ...getSeasonGroundUniformDefaults(uniforms),
      uFieldSoilBox: uniforms.uFieldSoilBox ?? { value: new Vector4(1, 1, 0, 0) },
      ...(uniforms.uSandPalette ? {} : createGroundPaletteUniforms({}, {})),
      ...(uniforms.uScorch ? {} : createRuinScorchUniforms())
    },
    vertexShader: VERTEX_GLSL
  });
};

/** Swaps the terrain material's ground variant (Three rebuilds the program on the next draw). */
export const setTerrainVariant = (material: RawShaderMaterial, variant: GroundShaderVariant) => {
  material.fragmentShader = createTerrainFragmentGlsl(variant, hasSnowyShore(material.uniforms));
  material.needsUpdate = true;
};

/** Without refraction the water is a premultiplied layer over the seabed drawn before it. */
const getWaterBlending = (refraction: boolean) =>
  refraction
    ? {}
    : {
        blendDst: OneMinusSrcAlphaFactor,
        blendSrc: OneFactor,
        blending: CustomBlending,
        transparent: true
      };

/** Shader switches: the premultiplied no-refraction path and the one-octave foam (water-glsl.ts). */
const getWaterDefines = (refraction: boolean, foam: WaterFoam) => ({
  ...(refraction ? {} : { NO_REFRACTION: "" }),
  ...(foam === "lite" ? { WATER_FOAM_LITE: "" } : {})
});

export const createWaterMaterial = (
  uniforms: Record<string, IUniform>, refraction: boolean, winter = false, foam: WaterFoam = "full"
) =>
  new RawShaderMaterial({
    defines: getWaterDefines(refraction, foam),
    fragmentShader: createWaterFragmentGlsl(winter),
    userData: { waterRefraction: refraction, winterWater: winter },
    glslVersion: GLSL3,
    uniforms,
    vertexShader: WATER_VERTEX_GLSL,
    ...getWaterBlending(refraction)
  });
