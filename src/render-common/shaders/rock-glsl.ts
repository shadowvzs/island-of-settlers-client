import { MACRO_NORMAL_GLSL } from "../macro-normal-map";
import { glslLiteral } from "./glsl-literal";
import { ROCK_FORM_GLSL } from "./rock-form-glsl";
import { ROCK_SNOW_GLSL } from "./rock-snow-glsl";
import {
  ORE_CODES,
  ROCK_MACRO_FORM_PULL,
  ROCK_PLANE_STRENGTH,
  ROCK_STONE_DETAIL_SCALE,
  ROCK_TILE
} from "./rock-tuning";

/**
 * Cliff materials, renderer independent (needs NOISE_GLSL). Three materials share one packed
 * texture (R clean rock, G weathered rock, B gravel, A cavity) and blend per pixel:
 * - clean exposed rock: high steep faces; warm grey, brown-grey, mauve-grey and slate beds
 * - weathered rock: cracks, pits, runoff streaks, oxidation
 * - loose rock / gravel: rock feet, shelves and channel beds (stones in dark soil)
 * Form first (rock-form-glsl.ts): broad planes with soft edges and their value structure, strata
 * beds and a few major fractures; moss and dry grass on sheltered upward shelves; cavity
 * shading in crevices, cracks and seams. Snow (rock-snow-glsl.ts) only on gentle upward faces.
 * Zone inputs per vertex: mask (x tint, y moss, z loose cover, w cavity), weathering 0..1.
 * Colours are display space (the island lights in display space; the lab linearises them).
 *
 * ROCK_SURFACE_GLSL: palette, form, zones, albedo (one triplanar fetch set, no normal map); with
 * ROCK_LITE defined (Detail Minimal) it leaves out the finer octaves (second texture octave,
 * fine grain, runoff, oxidation, secondary cracks). ROCK_DETAIL_GLSL adds detail normals.
 */
export const ROCK_SURFACE_GLSL = `
uniform sampler2D uRockTexture;
${MACRO_NORMAL_GLSL}
${ROCK_FORM_GLSL}
${ROCK_SNOW_GLSL}
const float ROCK_TILE = ${glslLiteral(ROCK_TILE)};

struct RockZones {
  float clean;
  float weathered;
  float loose;
};

struct RockSurface {
  vec3 albedo;
  vec3 normal;
  float occlusion;
  float roughness;
  /** 0 bare .. 1 snow covered (the detail smooths the snow surface). */
  float snow;
  /** 1 on standalone stones seen close up (finer texture octave and detail normal). */
  float detailed;
  RockZones zones;
};

struct RockUv {
  vec2 x;
  vec2 y;
  vec2 z;
  vec3 weights;
};

/** Soft projection blend (a sharp exponent shows seams on 45 degree faces). */
RockUv getRockUv(vec3 world, vec3 normal) {
  vec3 weights = pow(abs(normal), vec3(2.5));
  return RockUv(
    world.zy * ROCK_TILE,
    world.xz * ROCK_TILE,
    world.xy * ROCK_TILE,
    weights / (weights.x + weights.y + weights.z)
  );
}

/**
 * Height-aware triplanar blend: where projections overlap, the higher rock (texture R) wins a
 * little, so the seam follows the stone pattern instead of a straight blend band.
 */
vec4 sampleRockTriplanar(sampler2D map, RockUv uv) {
  vec4 sampleX = texture(map, uv.x);
  vec4 sampleY = texture(map, uv.y);
  vec4 sampleZ = texture(map, uv.z);
  vec3 weights = uv.weights * (vec3(sampleX.r, sampleY.r, sampleZ.r) * 0.8 + 0.6);
  weights /= weights.x + weights.y + weights.z;
  return sampleX * weights.x + sampleY * weights.y + sampleZ * weights.z;
}

/**
 * Broad stone colour: regional palette (warm grey, brown-grey, mauve-grey, slate; restrained),
 * bed tone (band) on top; never one uniform grey.
 */
vec3 getStonePalette(float tint, float region, float band) {
  vec3 slate = vec3(0.37, 0.39, 0.42);
  vec3 warmGrey = vec3(0.47, 0.46, 0.44);
  vec3 brownGrey = vec3(0.45, 0.4, 0.36);
  vec3 mauve = vec3(0.45, 0.42, 0.44);
  vec3 stone = mix(slate, warmGrey, smoothstep(0.15, 0.5, tint));
  stone = mix(stone, brownGrey, smoothstep(0.6, 0.95, tint) * 0.6);
  stone = mix(stone, mauve, smoothstep(0.5, 0.7, region) * 0.6);
  stone = mix(stone, slate, smoothstep(0.45, 0.28, region) * 0.6);
  float regionValue = 0.78 + smoothstep(0.3, 0.7, region) * 0.22;
  float bed = mix(0.72, 1.18, band);
  stone = mix(stone, slate, smoothstep(0.3, 0.05, band) * 0.4);
  return mix(stone, warmGrey * 1.1, smoothstep(0.7, 0.95, band) * 0.4) * regionValue * bed;
}

#ifndef ROCK_LITE
/**
 * Fine stone grain close up: two octaves of low-contrast grain and sparse light specks from
 * value noise in the triplanar planes (no texture fetch); fades out once a pixel covers more
 * than a few centimetres, so it never shimmers at gameplay distance. Returns a brightness factor.
 */
float sampleFineNoise(RockUv uv, float scale) {
  return valueNoise(uv.x * scale) * uv.weights.x + valueNoise(uv.y * scale) * uv.weights.y
    + valueNoise(uv.z * scale) * uv.weights.z;
}

float getFineGrain(vec3 world, RockUv uv, float loose) {
  float footprint = length(fwidth(world));
  float fade = 1.0 - smoothstep(0.015, 0.06, footprint);
  if (fade <= 0.0) return 1.0;
  float grain = sampleFineNoise(uv, 38.0) * 0.6 + sampleFineNoise(uv, 97.0) * 0.4 - 0.5;
  float speck = smoothstep(0.78, 0.95, sampleFineNoise(uv, 160.0));
  float detail = grain * 0.2 + speck * 0.04;
  return 1.0 + detail * fade * (1.0 - loose * 0.6);
}

/** Water runoff: dark vertical streaks on steep faces, broken along their length. */
float getRunoff(vec3 world, vec3 normal) {
  vec2 across = normalize(vec2(-normal.z, normal.x) + vec2(0.0001, 0.0));
  float streak = valueNoise(vec2(dot(world.xz, across) * 3.2, world.y * 0.14));
  float broken = valueNoise(vec2(dot(world.xz, across) * 0.6, world.y * 0.5));
  float steep = 1.0 - smoothstep(0.35, 0.7, abs(normal.y));
  return smoothstep(0.6, 0.85, streak) * smoothstep(0.25, 0.6, broken) * steep;
}
#endif

/**
 * Value structure by orientation (the plane normal): dusty, warmer, lighter upward planes,
 * the main rock tone on walls, cooler and darker undersides; plane tone and a lighter soft
 * edge between planes (convex edges only: not in cavities).
 */
vec3 applyPlaneValues(vec3 albedo, RockPlanes planes, float cavity) {
  float up = planes.normal.y;
  vec3 toned = albedo * mix(0.74, 1.12, smoothstep(-0.4, 0.85, up));
  vec3 dust = vec3(0.58, 0.56, 0.52) * (0.85 + dot(albedo, vec3(0.33)) * 0.4);
  toned = mix(toned, dust, smoothstep(0.6, 0.95, up) * 0.18);
  toned = mix(toned, toned * vec3(0.74, 0.77, 0.86), smoothstep(-0.05, -0.55, up));
  toned *= 1.0 + planes.tone * 0.16 + planes.edge * (1.0 - cavity) * 0.1;
  return toned;
}

/**
 * Moss and dry grass on sheltered upward shelves (moss mask: moisture, cracks, gullies;
 * cavity: sheltered), in patches (0..1); never on steep faces.
 */
vec3 applyShelfGrowth(vec3 albedo, vec3 normal, vec4 mask, float patches, float breakup) {
  float shelf = smoothstep(0.6, 0.88, normal.y);
  float sheltered = clamp(mask.y * 0.9 + mask.w * 0.6, 0.0, 1.0);
  float growth = smoothstep(0.42, 0.7, shelf * sheltered + (patches - 0.5) * 0.6 + breakup * 0.2);
  vec3 moss = vec3(0.30, 0.35, 0.24);
  vec3 grass = vec3(0.39, 0.43, 0.30);
  vec3 cover = mix(moss, grass, smoothstep(0.42, 0.62, patches)) * (0.85 + breakup * 0.3);
  return mix(albedo, cover, growth * shelf * 0.65);
}

/**
 * Wet rock by falls and in gorges (vertex wetness from the world's wet rock mask): subtly darker,
 * moss tint only in patches on upward wet faces (the detail also lowers the roughness a little).
 */
vec3 applyWetRock(vec3 albedo, vec3 normal, float wetness, float breakup) {
  if (wetness <= 0.0) return albedo;
  vec3 darker = mix(albedo, albedo * vec3(0.8, 0.81, 0.84), wetness);
  float patches = smoothstep(0.62, 0.9, wetness * 0.7 + breakup + 0.35);
  float moss = patches * smoothstep(0.1, 0.6, normal.y) * smoothstep(0.3, 0.7, wetness);
  return mix(darker, darker * vec3(0.72, 0.86, 0.6), moss * 0.6);
}

/**
 * Material weights: wide blends, texture heights (soft contrast) and world noise break the
 * borders up, so they follow the stone rather than the per vertex triangles.
 */
RockZones getRockZones(vec4 mask, float weathering, vec4 materials, float breakup) {
  float loose = smoothstep(0.22, 0.78, mask.z + (materials.b - 0.4) * 0.35 + breakup * 0.3);
  float weathered = smoothstep(0.2, 0.8, weathering + (0.5 - materials.r) * 0.3
    + materials.a * 0.15) * (1.0 - loose);
  return RockZones(1.0 - weathered - loose, weathered, loose);
}

vec3 getCleanRock(vec3 stone, vec4 materials) {
  return stone * (0.66 + materials.r * 0.68);
}

vec3 getWeatheredRock(vec3 stone, vec4 materials, vec3 world, vec3 normal, vec4 mask) {
  vec3 color = stone * vec3(0.9, 0.88, 0.85) * (0.74 + materials.g * 0.52);
#ifndef ROCK_LITE
  float oxidation = smoothstep(0.66, 0.82, fbm3(world.xz * 0.13 + world.y * 0.21));
  color = mix(color, vec3(0.6, 0.46, 0.3) * (0.5 + materials.g), oxidation * 0.25);
  color *= 1.0 - getRunoff(world, normal) * (0.14 + mask.y * 0.1);
#endif
  return color;
}

/** Gravel and soil, low contrast (no pockmarked tops); soil tone matches the ground's gravel. */
vec3 getLooseRock(vec3 stone, vec4 materials, vec4 mask) {
  vec3 soil = mix(vec3(0.43, 0.40, 0.35), vec3(0.34, 0.36, 0.27), mask.y * 0.6);
  float pebbles = smoothstep(0.25, 0.6, materials.b);
  return mix(soil, stone * 0.9, pebbles * 0.75) * (0.8 + materials.b * 0.35);
}

/** Finer tile of the close-up stone detail octave (relative to ROCK_TILE). */
const float STONE_DETAIL_SCALE = ${glslLiteral(ROCK_STONE_DETAIL_SCALE)};

/**
 * Close-up surface detail of standalone stones (meadow stones, foot boulders): a finer octave of
 * the same packed texture (3 fetches, only on these stones) gives mottled tone, mineral
 * speckle, small pits and hairline cracks; lighter weathered tops and edges, darker crevices,
 * pale lichen spots and moss patches on the shaded (north, -z) and upper sides.
 */
vec3 applyStoneDetail(vec3 albedo, vec3 world, vec3 normal, float breakup) {
  RockUv fineUv = getRockUv(world * STONE_DETAIL_SCALE, normal);
  vec4 fine = sampleRockTriplanar(uRockTexture, fineUv);
  float mottle = valueNoise(world.xz * 0.9 + world.y * 0.7 + 3.1);
  vec3 stone = albedo * mix(0.86, 1.12, mottle) * (0.8 + fine.r * 0.45);
  float speckLight = smoothstep(0.66, 0.82, fine.g);
  float speckDark = smoothstep(0.34, 0.2, fine.b);
  stone = mix(stone, stone * 1.25 + 0.04, speckLight * 0.35);
  stone *= 1.0 - speckDark * 0.18 - fine.a * 0.45;
  stone = mix(stone, stone * 1.12 + 0.03, smoothstep(0.35, 0.9, normal.y) * 0.5);
  float lichenNoise = valueNoise(world.xz * 3.3 + world.y * 2.1);
  float lichen = smoothstep(0.74, 0.82, lichenNoise + breakup * 0.2) * smoothstep(0.0, 0.6, normal.y);
  stone = mix(stone, stone * vec3(1.08, 1.06, 0.96) + 0.03, lichen * 0.35);
  float mossSide = smoothstep(0.1, -0.7, normal.z) * 0.6 + smoothstep(0.5, 0.95, normal.y) * 0.4;
  float moss = smoothstep(0.55, 0.75, valueNoise(world.xz * 1.7 + 8.3) + breakup * 0.3) * mossSide;
  return mix(stone, stone * vec3(0.82, 0.9, 0.74), moss * 0.4);
}

#ifndef ROCK_LITE
/** Broken mineral faces and fine joints on the massifs, readable beneath broad strata. */
vec3 applyMountainDetail(vec3 albedo, vec3 world, vec3 normal, RockZones zones, float breakup) {
  RockUv uv = getRockUv(world * 2.35 + vec3(11.7, 3.1, -8.4), normal);
  vec4 detail = sampleRockTriplanar(uRockTexture, uv);
  float exposed = 1.0 - zones.loose * 0.8;
  float mineral = detail.r * 0.65 + detail.g * 0.35;
  vec3 color = albedo * (0.72 + mineral * 0.56);
  color *= 1.0 - detail.a * 0.22 * exposed;
  vec3 patina = mix(vec3(0.96, 0.98, 1.01), vec3(1.03, 1.00, 0.96), smoothstep(-0.2, 0.2, breakup));
  return mix(albedo, color * patina, exposed * 0.8);
}
#endif

/**
 * Ore stones on a surveyed mine field (ORE codes): coal in black seams, iron in rust patches with
 * runoff, gold as quartz veins with glinting specks, granite pale and speckled.
 */
vec3 applyOreStone(vec3 albedo, vec3 world, int ore) {
  float luma = dot(albedo, vec3(0.3, 0.59, 0.11));
  float grain = fbm3(world.xz * 2.4 + world.y * 1.7);
  if (ore == ${ORE_CODES.coal}) {
    float seam = abs(sin(world.y * 11.0 + world.x * 2.0 + grain * 7.0));
    return mix(albedo * 0.8, vec3(0.08, 0.075, 0.07), smoothstep(0.45, 0.15, seam));
  }
  if (ore == ${ORE_CODES.iron}) {
    float rust = smoothstep(0.52, 0.7, grain + (0.5 - fract(world.y * 0.9)) * 0.08);
    return mix(albedo, vec3(0.47, 0.26, 0.15) * (0.75 + luma), rust * 0.6);
  }
  if (ore == ${ORE_CODES.gold}) {
    float vein = abs(sin(world.x * 6.0 - world.z * 4.5 + world.y * 3.0 + grain * 8.0));
    vec3 quartz = mix(albedo, vec3(0.86, 0.84, 0.78), smoothstep(0.22, 0.06, vein));
    float speck = fract(sin(dot(floor(world * 26.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float flash = 0.6 + 0.4 * sin(uTime * 3.0 + speck * 40.0);
    return mix(quartz, vec3(1.0, 0.78, 0.25) * (1.0 + flash), step(0.92, speck) * step(vein, 0.3));
  }
  if (ore == ${ORE_CODES.granite}) {
    float fleck = fract(sin(dot(floor(world * 34.0), vec3(39.3, 11.7, 83.1))) * 43758.5453);
    vec3 flecked = vec3(0.8, 0.78, 0.75) * (0.85 + luma * 0.3);
    if (fleck > 0.84) flecked = vec3(0.7, 0.55, 0.5);
    if (fleck > 0.9) flecked = vec3(0.14, 0.14, 0.15);
    return mix(albedo, flecked, 0.8);
  }
  return albedo;
}

/** Strength of the broad plane snapping on mountain rock (standalone stones stay smooth). */
const float PLANE_STRENGTH = ${glslLiteral(ROCK_PLANE_STRENGTH)};

/** Noise shared by the rock layers: regional (x turn, y strata warp, z zones), meso breakup. */
struct RockNoise {
  vec4 regional;
  /** x breakup, y strata gaps, z snow patches, w growth patches. */
  vec4 meso;
  float region;
};

RockNoise getRockNoise(vec3 world) {
  vec4 regional = valueNoise4(world.xz * 0.035 + world.y * 0.02 + 2.7);
  vec4 meso = valueNoise4(world.xz * 0.6 + world.y * 0.45);
  return RockNoise(regional, meso, fbm3(world.xz * 0.02 + world.y * 0.03));
}

/** The decoded tint byte: x tint 0..1, y detailed stone flag, z ORE code. */
vec3 decodeRockTint(float packedByte) {
  float packedTint = packedByte * 255.0;
  float detailed = step(127.5, packedTint);
  float stoneByte = floor(packedTint + 0.5) - 128.0;
  if (detailed < 0.5) return vec3(packedTint / 127.0, 0.0, 0.0);
  return vec3(mod(stoneByte, 16.0) / 15.0, 1.0, floor(stoneByte / 16.0));
}

/** The three materials blended by the zones, bed tone on the steep clean rock. */
vec3 getZoneAlbedo(
  vec3 stone,
  vec4 materials,
  vec3 world,
  vec3 normal,
  vec4 mask,
  RockZones zones
) {
  return getCleanRock(stone, materials) * zones.clean
    + getWeatheredRock(stone, materials, world, normal, mask) * zones.weathered
    + getLooseRock(stone, materials, mask) * zones.loose;
}

/** Strata on exposed steep rock (layered 0..1): darker recessed seams, lit lips. */
vec3 applyStrata(vec3 albedo, RockStrata strata, float layered) {
  float shade = (1.0 + strata.lip * 0.1) * (1.0 - strata.seam * 0.32);
  return albedo * mix(1.0, shade, layered);
}

/** How far the skin's form normal leans to the landform (broad faces over relief bumps). */
const float MACRO_FORM_PULL = ${glslLiteral(ROCK_MACRO_FORM_PULL)};

/** The form normal: on the skin (macroForm 1) pulled toward the landform's normal. */
vec3 getFormNormal(vec3 normal, vec3 world, float macroForm) {
  vec4 macro = getMacroNormal(world.xz);
  return normalize(mix(normal, macro.xyz, MACRO_FORM_PULL * macroForm * macro.w));
}

/** Close-up detail per kind: ore stones, standalone stones, the mountain's second octave. */
vec3 applyKindDetail(
  vec3 albedo,
  vec3 world,
  vec3 normal,
  vec3 tint,
  RockZones zones,
  float breakup
) {
  if (tint.y > 0.5) albedo = applyStoneDetail(albedo * 1.08, world, normal, breakup);
  if (tint.z > 0.0) return applyOreStone(albedo, world, int(tint.z));
#ifndef ROCK_LITE
  albedo = applyMountainDetail(albedo, world, normal, zones, breakup);
#endif
  return albedo;
}

/**
 * Shared albedo, form and occlusion of the three materials (no detail normal);
 * ROCK_DETAIL_GLSL adds the detail on top. extra: x landform share, z weathering, w wetness.
 */
RockSurface getRockSurface(vec3 world, vec3 normal, vec4 mask, vec4 extra) {
  float wetness = extra.w;
  RockUv uv = getRockUv(world, normal);
  vec4 materials = sampleRockTriplanar(uRockTexture, uv);
  vec3 tint = decodeRockTint(mask.x);
  RockNoise noise = getRockNoise(world);
  float breakup = noise.meso.x - 0.5;
  float zoneWeathering = extra.z + (noise.regional.z - 0.5) * 0.9 + breakup * 0.25;
  RockZones zones = getRockZones(mask, zoneWeathering, materials, breakup);
  float formed = 1.0 - tint.y;
  vec3 form = getFormNormal(normal, world, extra.x);
  RockPlanes planes = getRockPlanes(form, noise.regional.x, PLANE_STRENGTH * formed);
  float exposed = (1.0 - zones.loose) * formed;
  float layered = (1.0 - smoothstep(0.55, 0.85, form.y)) * exposed;
  RockStrata strata = getStrata(world, form, noise.regional.y, noise.meso.y);
  vec3 stone = getStonePalette(tint.x, noise.region, mix(0.45, strata.band, layered));
  vec3 albedo = getZoneAlbedo(stone, materials, world, normal, mask, zones);
#ifndef ROCK_LITE
  albedo *= getFineGrain(world, uv, zones.loose);
#endif
  float crevice = smoothstep(0.3, 0.9, mask.w);
  albedo = applyPlaneValues(albedo, planes, crevice);
  albedo = applyStrata(albedo, strata, layered);
  vec2 clefts = getFractures(world, form, noise.regional.x) * exposed;
  float fractures = clefts.x;
  albedo *= (1.0 - fractures * 0.5) * (1.0 + clefts.y * 0.12);
  albedo = applyKindDetail(albedo, world, normal, tint, zones, breakup);
  albedo = applyShelfGrowth(albedo, normal, mask, noise.meso.w, breakup);
  albedo = applyWetRock(albedo, normal, wetness, breakup);
  vec2 snowPatches = vec2(noise.regional.w, noise.meso.z);
  vec3 snowSlope = normalize(mix(form, normal, 0.65));
  float snow = getSnowCover(world, snowSlope, mask, materials, snowPatches) * (1.0 - wetness);
  albedo = mix(albedo, getSnowColor(world, form, snowPatches), snow);
  albedo *= 1.0 - crevice * 0.16 * (1.0 - snow);
  float cavity = materials.a * (0.16 + zones.weathered * 0.1) * (1.0 - zones.loose);
  float formShade = (1.0 - fractures * 0.4) * (1.0 - strata.seam * layered * 0.25);
  RockSurface surface;
  surface.albedo = albedo;
  surface.normal = normalize(mix(planes.normal, getSnowNormal(form), snow));
  float occlusion = (1.0 - crevice * 0.45) * (1.0 - cavity) * formShade;
  surface.occlusion = mix(occlusion, 1.0, snow * 0.7);
  float dryRoughness = zones.clean * 0.8 + zones.weathered * 0.88 + zones.loose * 0.95;
  dryRoughness += breakup * 0.12;
  surface.roughness = mix(mix(dryRoughness, 0.6, snow), 0.45, wetness * 0.6);
  surface.snow = snow;
  surface.detailed = tint.y;
  surface.zones = zones;
  return surface;
}

/** Debug colours: 1 wet rock, 2 masks (moss, loose, cavity), 3 normals, 4 material zones. */
vec3 getRockDebug(int view, vec4 mask, vec4 extra, RockSurface surface) {
  if (view == 1) return mix(vec3(0.85, 0.8, 0.7), vec3(0.1, 0.3, 0.9), extra.w);
  if (view == 2) return mask.yzw;
  if (view == 3) return surface.normal * 0.5 + 0.5;
  RockZones zones = surface.zones;
  return vec3(0.85, 0.75, 0.6) * zones.clean + vec3(0.35, 0.6, 0.3) * zones.weathered
    + vec3(0.35, 0.45, 0.8) * zones.loose;
}
`;

/**
 * Detail normals per material (rock or gravel slopes from the packed normal
 * texture), damp recess and moss roughness.
 */
export const ROCK_DETAIL_GLSL = `
uniform sampler2D uRockNormal;

/**
 * Bends the vertex normal by the three projected detail slopes (whiteout style blend), weakly
 * and only close up (fade): the rock reads as smooth, softly rounded stone.
 */
vec3 getRockDetailNormal(vec3 normal, RockUv uv, RockZones zones, float fade) {
  vec4 slopesX = texture(uRockNormal, uv.x) * 2.0 - 1.0;
  vec4 slopesY = texture(uRockNormal, uv.y) * 2.0 - 1.0;
  vec4 slopesZ = texture(uRockNormal, uv.z) * 2.0 - 1.0;
  vec2 nx = mix(slopesX.xy, slopesX.zw, zones.loose);
  vec2 ny = mix(slopesY.xy, slopesY.zw, zones.loose);
  vec2 nz = mix(slopesZ.xy, slopesZ.zw, zones.loose);
  vec3 detail = vec3(0.0, nx.y, nx.x) * uv.weights.x + vec3(ny.x, 0.0, ny.y) * uv.weights.y
    + vec3(nz.x, nz.y, 0.0) * uv.weights.z;
  float strength = zones.clean * 0.3 + zones.weathered * 0.34 + zones.loose * 0.2;
  return normalize(normal + detail * strength * fade);
}

/** Subtle fine detail normal on standalone stones close up (the shading stays smooth). */
void applyStoneDetailNormal(inout RockSurface surface, vec3 world, vec3 normal, float fade) {
  if (surface.detailed < 0.5 || fade <= 0.0) return;
  RockUv uv = getRockUv(world * STONE_DETAIL_SCALE, normal);
  vec4 slopesX = texture(uRockNormal, uv.x) * 2.0 - 1.0;
  vec4 slopesY = texture(uRockNormal, uv.y) * 2.0 - 1.0;
  vec4 slopesZ = texture(uRockNormal, uv.z) * 2.0 - 1.0;
  vec3 detail = vec3(0.0, slopesX.y, slopesX.x) * uv.weights.x
    + vec3(slopesY.x, 0.0, slopesY.y) * uv.weights.y
    + vec3(slopesZ.x, slopesZ.y, 0.0) * uv.weights.z;
  surface.normal = normalize(surface.normal + detail * 0.2 * fade);
}

/**
 * Snow detail: smooth (little stone detail under it: back toward the surface normal before the
 * detail), matte, without glitter.
 */
void applySnowDetail(inout RockSurface surface, vec3 world, vec3 smoothNormal) {
  if (surface.snow <= 0.0) return;
  surface.normal = normalize(mix(surface.normal, smoothNormal, surface.snow * 0.85));
  surface.roughness = mix(surface.roughness, 0.55, surface.snow);

}

RockSurface getRockDetailSurface(vec3 world, vec3 normal, vec4 mask, vec4 extra) {
  RockSurface surface = getRockSurface(world, normal, mask, extra);
  vec3 smoothNormal = surface.normal;
  float nearFade = 1.0 - smoothstep(0.02, 0.08, length(fwidth(world)));
  surface.normal = getRockDetailNormal(
    surface.normal,
    getRockUv(world, normal),
    surface.zones,
    nearFade
  );
  float damp = mask.w * smoothstep(0.3, 0.8, mask.y);
  surface.roughness = mix(surface.roughness, 0.7, damp * 0.5);
  float moss = smoothstep(0.5, 0.8, mask.y) * surface.zones.weathered;
  surface.roughness = mix(surface.roughness, 0.95, moss);
  applyStoneDetailNormal(surface, world, normal, nearFade);
  applySnowDetail(surface, world, smoothNormal);
  return surface;
}

`;

/**
 * Rock-only light: the plane value push and the fill light (sky fill on upward faces and warm
 * bounce from the ground on undersides), strongest where the sun does not reach, so shadowed
 * rock keeps its form and texture (mid-dark, never black). Needs COMMON_UNIFORMS_GLSL.
 */
export const ROCK_FILL_GLSL = `
/**
 * Value push between the broad planes: planes turned to the sun read clearly lighter and warmer,
 * planes turned away (and shadowed rock) darker and cooler; the plane edges stay soft. Snow and
 * standalone stones only get a little of it. Needs ROCK_SURFACE_GLSL.
 */
vec3 getRockPlaneContrast(RockSurface rock, float sunLit) {
  float lit = smoothstep(-0.1, 0.6, dot(rock.normal, uSunDirection)) * mix(0.35, 1.0, sunLit);
  vec3 push = mix(vec3(0.72, 0.75, 0.85), vec3(1.05, 1.03, 1.0), lit);
  float strength = (1.0 - rock.snow * 0.8) * (1.0 - rock.detailed * 0.6);
  return mix(vec3(1.0), push, strength);
}

vec3 getRockFill(vec3 albedo, vec3 normal, float sunLit, float occlusion) {
  float shade = 1.0 - sunLit * clamp(dot(normal, uSunDirection) * 1.5 + 0.3, 0.0, 1.0);
  vec3 sky = uAmbientSky * smoothstep(-0.3, 0.8, normal.y);
  vec3 bounce = uAmbientGround * vec3(1.15, 1.0, 0.85) * smoothstep(0.4, -0.6, normal.y);
  return albedo * (sky * 0.3 + bounce * 0.4) * shade * mix(0.6, 1.0, occlusion);
}
`;
