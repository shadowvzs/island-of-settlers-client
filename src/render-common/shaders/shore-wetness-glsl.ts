/**
 * Shore wetness (TT-1) and the swash sheet (lane/swash): where the ground at the waterline is wet
 * and how wet, fed into the shared applyGroundWetness (ground-wetness-glsl.ts) before lighting.
 * All from the water field (signed depth, coast distance) and the surf timing of water-glsl.ts:
 * - the swash sheet: a thin water sheet runs up the sand with each surf front (swashRunUp) and drains
 *   back; it tints, glosses and (High) ripples and refracts the sand under it, and carries the foam:
 *   a bright bubble line at its leading edge that thins into lace as it drains, and (High) seaward
 *   backwash streaks;
 * - the drained sand keeps its glossy film a moment after the sheet left it;
 * - the swash zone below the highest run-up stays saturated between the waves (dark, a little gloss);
 * - a damp band above it fades to dry by height above the water and by coast distance (matte).
 *
 * Needs WATER_GLSL (surf timing, foam), NOISE_GLSL and GROUND_WETNESS_GLSL. The band edges wobble
 * analytically (no fetch); only the swash zone fetches the bubble lace: one noise fetch, and
 * SHORE_FOAM_FINE (full ground) adds a finer octave and one streak fetch while the sheet drains.
 * FROZEN_SHORE (cosmetic global winter) and the snowy shore's snow map keep frozen and snow-covered
 * shores matte: darkened as before, never shiny, no sheet tint or foam.
 */
import { MATERIAL } from "../../shared/world/world-data";
import { glslLiteral } from "./glsl-literal";

/**
 * Shore wetness bands, shared with the TSL twin (terrain-nodes.ts). The saturated swash zone holds up to
 * soakHeight.x above the water and fades by soakHeight.y; above it the damp band darkens gradually toward
 * the water (GROUND-PALETTE, owner 2026-11-17: no flat band with a hard top edge): its wetness grows
 * with (1 - smoothstep(dampHeight)) ^ dampCurve, so the beach greys smoothly from dry sand down to the
 * soaked swash zone, and it fades out by coast distance (cells).
 */
export const SHORE_WETNESS_TUNING = {
  dampCoast: [1.0, 2.2],
  dampCurve: 1.5,
  dampHeight: [0.04, 0.62],
  damp: 0.4,
  soak: 0.8,
  soakHeight: [0.1, 0.3],
  /**
   * Terrain normal y (slope-exaggerated) where a bank is too steep for a swash sheet and where it is a
   * gentle beach: on steep banks the run-up bands compress into one dense foam line whose wet sheen,
   * facing the sun at a grazing angle, bloomed into a glowing white line (review 2026-11-17). Steep banks
   * keep the water's own edge foam and a weaker wet film (steepFilm).
   */
  swashGentle: [0.4, 0.72],
  steepFilm: 0.35,
  /** Lit swash foam luminance knee and ceiling of rollOffSwashFoam (no bloom glow line). */
  foamRollOff: [0.75, 1.05]
} as const;

const vec2Literal = (values: readonly number[]) => `vec2(${values.map(value => glslLiteral(value)).join(", ")})`;

/** Splat channel of a material (splatA holds materials 0..3, splatB 4..7). */
const channelOf = (material: number) => "xyzw"[material % 4];
export const splatOf = (material: number) => `${material < 4 ? "splatA" : "splatB"}.${channelOf(material)}`;

/** Swash sheet: its coverage, the foam it carries and its surface (shore-wetness-glsl.ts). */
const SWASH_SHEET_GLSL = `
const vec2 SWASH_GENTLE_NORMAL = ${vec2Literal(SHORE_WETNESS_TUNING.swashGentle)};
const float SHORE_STEEP_FILM = ${glslLiteral(SHORE_WETNESS_TUNING.steepFilm)};

/** 0 on a bank too steep for a swash sheet .. 1 on a gentle beach. */
float getSwashGentle(vec3 geometryNormal) {
  return smoothstep(SWASH_GENTLE_NORMAL.x, SWASH_GENTLE_NORMAL.y, geometryNormal.y);
}

/** Thin water sheet of the swash over the sand. */
struct SwashSheet {
  /** 0..1 water sheet over this point. */
  float cover;
  /** 0..1 relative thickness (thin at the edge and while draining). */
  float depth;
  /** 0..1 foam on the sheet: edge line, carried lace, backwash streaks, drained bubbles. */
  float foam;
  /** 0..1 glossy film the drained sheet left behind. */
  float linger;
  /** Ripple slope of the sheet's surface (High; zero on the lite ground). */
  vec2 slope;
};

/** Edge softness and how much the edge wobbles (height units above the water). */
const float SWASH_EDGE_SOFT = 0.012;
const float SWASH_EDGE_WOBBLE = 0.03;
/** Height of water below the edge at which the sheet counts as full thickness. */
const float SWASH_FULL_DEPTH = 0.07;
/** Surf cycle share the drained sand keeps its glossy film. */
const float SWASH_LINGER = 0.12;
/** Surf cycle share the foam left at the highest run-up takes to dissolve after the uprush stops. */
const float SWASH_RESIDUE_LIFE = 0.5;

SwashSheet noSwashSheet() {
  return SwashSheet(0.0, 0.0, 0.0, 0.0, vec2(0.0));
}

/**
 * Surf cycle share since the backwash uncovered a point at this reach share (0 the lowest run-up,
 * 1 the highest); points the sheet never reaches get a whole cycle. Inverse of swashReach.
 */
float getSwashSince(float reachShare, float age) {
  if (reachShare >= 1.0) return 1.0;
  float uncovered = SWASH_UPRUSH + SWASH_BACKWASH * sqrt(1.0 - max(reachShare, 0.0));
  return age >= uncovered ? age - uncovered : age + 1.0 - uncovered;
}

/**
 * Swash lobes -1..1: smooth analytic edge offsets at two scales (no fetch). The finer scale is a
 * scallop: rounded tongues reaching up the beach (-1) between sharp cusps pointing seaward (1), like
 * the edge of real swash instead of a straight or saw-toothed line.
 */
float getSwashLobes(vec2 xz) {
  float broad = sin(dot(xz, vec2(1.9, 0.7)) + sin(dot(xz, vec2(-0.8, 1.6))) * 1.4);
  float scallop = 1.0 - 2.0 * abs(sin(dot(xz, vec2(-3.0, 2.3)) + broad * 1.3 + 0.7));
  return broad * 0.55 + scallop * 0.45;
}

/**
 * Foam of the leading edge: the single foam line of the swash. Its thickness varies along the shore.
 * The front itself stays one continuous line (the lace only shades it); behind it the band is a dense
 * bubble sheet while the sheet runs up and opens into lace (bubbles popping) as it drains. Gating the
 * whole line by the lattice noise broke it into regular dashes (lane/swash-foam).
 */
float getSwashEdgeFoam(float below, float lace, float thickness, float draining) {
  float width = mix(0.05, 0.018, draining) * thickness;
  float band = below / max(width, 0.001);
  float line = smoothstep(-0.002, 0.005, below) * (1.0 - smoothstep(0.3, 1.0, band));
  float front = (1.0 - smoothstep(0.15, 0.5, band)) * (0.8 + 0.2 * lace) * mix(1.0, 0.8, draining);
  // Dense just behind the front, opening into lace towards the back of the band.
  float bubbles = dissolveFoam(lace, mix(0.32, 0.6, draining) + band * 0.25);
  float body = mix(1.0, bubbles, mix(0.6, 1.0, draining));
  // Most of the foam stays behind at the highest run-up (getSwashResidue): the draining edge keeps
  // only a thin lace.
  return line * mix(1.0, 0.4, draining) * max(front, body);
}

/**
 * Foam left at the highest run-up line (TOOL-8 reference clips): when the uprush stops, its foam
 * stays on the sand and dissolves there while the clear sheet drains beneath it. A continuous core
 * line that fades evenly (no noise gating, so no dashes) and lace behind it that pops into bubbles.
 * The sand the uprush wetted stays wet under it meanwhile (y), so the white lace shows on dark wet
 * sand as in the clips instead of vanishing on bright dry sand.
 * peakBelow is the height below that line; since the cycle share since the uprush stopped.
 */
vec2 getSwashResidue(float peakBelow, float lace, float thickness, float since) {
  if (since < 0.0 || since >= SWASH_RESIDUE_LIFE) return vec2(0.0);
  float life = since / SWASH_RESIDUE_LIFE;
  float band = peakBelow / max(0.05 * thickness, 0.001);
  // Wider than the moving front's band: a standing contour this thin fell between the field's
  // height steps and showed only as loose bubbles.
  float line = smoothstep(-0.002, 0.005, peakBelow) * (1.0 - smoothstep(0.6, 1.4, band));
  float core = (1.0 - smoothstep(0.3, 0.9, band)) * (1.0 - smoothstep(0.2, 0.9, life));
  // A wide, soft dissolve: the bubbles thin out gradually instead of leaving hard-edged chips
  // (Minimal's single lace octave turned the narrow dissolveFoam ramp into a row of flakes).
  float threshold = 0.25 + life * 0.6 + band * 0.2;
  float bubbles = smoothstep(threshold, threshold + 0.35, lace) * 0.75;
  float foam = line * max(core, bubbles) * (1.0 - smoothstep(0.75, 1.0, life));
  float wet = smoothstep(-0.004, 0.01, peakBelow) * (1.0 - smoothstep(0.5, 1.0, life));
  return vec2(foam, wet);
}

/**
 * Ripples on the sheet (two analytic trains), running up with the uprush and down with the backwash;
 * two unrelated sines bend their phase, so they never read as regular stripes.
 */
vec2 getSwashRipples(vec2 xz, vec2 seaward, float draining, float time) {
  vec2 across = vec2(-seaward.y, seaward.x);
  float flow = draining * 2.0 - 1.0;
  float along = dot(xz, seaward);
  float bend = sin(dot(xz, across) * 1.3) * 1.5 + sin(dot(xz, vec2(2.3, -1.7)) + along * 3.1) * 1.2;
  float a = along * 11.0 + dot(xz, across) * 4.0 + time * 5.0 * flow + bend;
  float b = along * 7.0 - dot(xz, across) * 6.5 + time * 3.7 * flow + 1.7 - bend * 0.7;
  vec2 slope = seaward * (cos(a) * 0.6 + cos(b) * 0.4) + across * (cos(a) * 0.2 - cos(b) * 0.3);
  return slope * 0.1;
}

#ifdef SHORE_FOAM_FINE
/** Backwash streaks: thin lines down the slope that run seaward (one fetch, only while draining). */
float getBackwashStreaks(vec2 xz, vec2 seaward, float time) {
  vec2 across = vec2(-seaward.y, seaward.x);
  float along = dot(xz, seaward);
  float bend = sin(along * 2.3 + dot(xz, across) * 0.7) * 0.35;
  return valueNoise(vec2((dot(xz, across) + bend) * 11.0, along * 1.4 - time * 1.1) + 7.1);
}
#endif

/** Backwash streaks (High) on a draining sheet being built: thinner water in seaward lines, faint foam. */
void addBackwashStreaks(inout SwashSheet sheet, vec2 xz, vec2 seaward, float draining, float time) {
#ifdef SHORE_FOAM_FINE
  if (draining <= 0.0 || sheet.cover <= 0.0) return;
  float streaks = getBackwashStreaks(xz, seaward, time);
  sheet.depth *= mix(1.0, 0.45 + 0.55 * streaks, draining);
  sheet.foam = max(sheet.foam, smoothstep(0.76, 0.92, streaks) * draining * sheet.cover * 0.18);
#endif
}

/**
 * The swash sheet at this point (open: 0 on snow and frozen shores, which get none). The sheet's age is the surf's at the waterline (coast 0), so its
 * uprush starts when the surf front arrives there; the lace scrolls with the sheet's reach, so the
 * foam rides on the water instead of standing on the sand.
 */
SwashSheet getSwashSheet(
  float signedDepth, float coast, vec2 xz, vec2 flow, vec3 geometryNormal, float open, vec2 ripple, float time
) {
  float height = -signedDepth;
  float sea = (1.0 - smoothstep(0.02, 0.2, length(flow))) * open;
  if (sea <= 0.0 || coast > 3.0 || height < -0.1 || height > SWASH_BASE + SWASH_RISE + SWASH_EDGE_WOBBLE + 0.02)
    return noSwashSheet();
  float age = surfAge(xz, 0.0, time);
  float reach = swashReach(age);
  float draining = smoothstep(SWASH_UPRUSH, SWASH_UPRUSH + SWASH_BACKWASH, age);
  vec2 seaward = normalize(geometryNormal.xz + vec2(1e-4, 0.0));
  // The lace rides up with the uprush and then stays put: the foam it shapes is left on the sand.
  float lace = getShoreLace(xz + seaward * (mix(reach, 1.0, draining) * 0.8));
  float lobes = getSwashLobes(xz);
  float wobble = getShoreBreakup(xz).x * SWASH_EDGE_WOBBLE * 0.5 + lobes * 0.032 + (lace - 0.5) * 0.004;
  float thickness = 0.35 + 0.95 * (0.5 + 0.5 * sin(dot(xz, vec2(4.4, -2.4)) + lobes * 2.5));
  float below = swashRunUp(age) - (height + wobble);
  SwashSheet sheet = noSwashSheet();
  // The sheet continues a little under the water's transparent edge, so no dry seam shows between them.
  float exposed = smoothstep(-0.1, -0.04, height) * sea * getSwashGentle(geometryNormal);
  sheet.cover = smoothstep(-0.004, SWASH_EDGE_SOFT, below) * exposed;
  sheet.depth = clamp(below / SWASH_FULL_DEPTH, 0.0, 1.0) * (1.0 - 0.6 * draining);
  float carried = dissolveFoam(lace, 0.66 + 0.2 * draining) * (1.0 - sheet.depth * 0.6) * 0.2;
  sheet.foam = max(getSwashEdgeFoam(below, lace, thickness, draining), carried * sheet.cover) * exposed;
  float peakBelow = SWASH_BASE + SWASH_RISE - (height + wobble);
  vec2 residue = getSwashResidue(peakBelow, lace, thickness, age - SWASH_UPRUSH);
  sheet.foam = max(sheet.foam, residue.x * exposed);
  float since = getSwashSince((height + wobble - SWASH_BASE) / SWASH_RISE, age);
  float drained = max(1.0 - smoothstep(0.0, SWASH_LINGER, since), residue.y);
  sheet.linger = drained * (1.0 - sheet.cover) * exposed;
  sheet.foam = max(sheet.foam, dissolveFoam(lace, 0.66 + since * 3.0) * sheet.linger * 0.5);
  sheet.slope = ripple;
  addBackwashStreaks(sheet, xz, seaward, draining, time);
  return sheet;
}

/**
 * Ripple slope of the swash sheet (High), scaled by its thickness: it tilts the sheet's normal, so the
 * sky and sun reflection ripple over the sand. Vertex water data (signed depth, flow) and the splat
 * only, no fetch. Snow, the cosmetic winter and the lite ground get none. (Refracting the ground sample
 * by it cost about 0.45 ms of the High terrain pass at 1600x900 and was dropped: lane/swash receipt.)
 */
vec2 getSwashRipple(float vertexDepth, vec2 xz, vec2 flow, vec4 splatB, vec3 geometryNormal, float time) {
#if defined(SHORE_FOAM_FINE) && !defined(FROZEN_SHORE)
  float age = surfAge(xz, 0.0, time);
  float below = swashRunUp(age) + vertexDepth;
  if (below <= 0.0 || vertexDepth > 0.1 || length(flow) > 0.2) return vec2(0.0);
  float draining = smoothstep(SWASH_UPRUSH, SWASH_UPRUSH + SWASH_BACKWASH, age);
  vec2 seaward = normalize(geometryNormal.xz + vec2(1e-4, 0.0));
  float thickness = clamp(below / SWASH_FULL_DEPTH, 0.0, 1.0) * (1.0 - getGroundSnowShare(splatB));
  return getSwashRipples(xz, seaward, draining, time) * thickness;
#else
  return vec2(0.0);
#endif
}

`;

export const SHORE_WETNESS_GLSL = `
/** Height above the water where the saturated swash zone fades, and its wetness. */
const vec2 SHORE_SOAK_HEIGHT = ${vec2Literal(SHORE_WETNESS_TUNING.soakHeight)};
const float SHORE_SOAK = ${glslLiteral(SHORE_WETNESS_TUNING.soak)};
/** Height above the water and coast distance (cells) where the damp band fades out, its wetness. */
const vec2 SHORE_DAMP_HEIGHT = ${vec2Literal(SHORE_WETNESS_TUNING.dampHeight)};
const vec2 SHORE_DAMP_COAST = ${vec2Literal(SHORE_WETNESS_TUNING.dampCoast)};
const float SHORE_DAMP = ${glslLiteral(SHORE_WETNESS_TUNING.damp)};
const float SHORE_DAMP_CURVE = ${glslLiteral(SHORE_WETNESS_TUNING.dampCurve)};
/** Bubble lace scale (noise cells per world unit) and the swash foam's colour on the sand. */
const float SHORE_LACE_SCALE = 7.0;
const vec3 SWASH_FOAM_ALBEDO = vec3(0.96, 0.97, 0.98);
/** Lit foam luminance where the roll-off starts (knee) and that it approaches (ceiling). */
const vec2 SWASH_FOAM_ROLL_OFF = ${vec2Literal(SHORE_WETNESS_TUNING.foamRollOff)};
/** Sand seen through the sheet: the water absorbs red first (a slight clear tint; wet sand stays warm). */
const vec3 SWASH_WATER_TINT = vec3(0.9, 0.96, 0.95);

/** Porosity of the ground mix: sand and soil 1, grass 0.5, gravel 0.7, rock 0.45. */
float getGroundPorosity(vec4 splatA, vec4 splatB) {
  return clamp(1.0 - 0.5 * (${splatOf(MATERIAL.grass)} + ${splatOf(MATERIAL.lushGrass)})
    - 0.55 * ${splatOf(MATERIAL.rock)} - 0.3 * ${splatOf(MATERIAL.gravel)}, 0.0, 1.0);
}

/** Share of the ground that is snow: snow stays matte at the waterline. */
float getGroundSnowShare(vec4 splatB) {
  return clamp(${splatOf(MATERIAL.snow)}, 0.0, 1.0);
}

/**
 * 1 where the shore is frozen: the prepared cosmetic winter everywhere, the global season's ice ramp (SEASON_SNOW,
 * season-ground-glsl.ts) or else the snowy shore's map.
 */
float getShoreFrozen(float snowyShore) {
#if defined(FROZEN_SHORE)
  return 1.0;
#elif defined(SEASON_SNOW)
  return max(snowyShore, getSeasonIce());
#else
  return snowyShore;
#endif
}

/**
 * Bubble lace 0..1: one noise fetch on the lite ground, two (coarse + finer octave) on the full. Both
 * octaves are turned off the world axes (and off each other), so the noise lattice never lines up
 * with a straight shore as a regular row of blobs.
 */
float getShoreLace(vec2 xz) {
#ifdef SHORE_FOAM_FINE
  float coarse = valueNoise(mat2(0.96, 0.28, -0.28, 0.96) * xz * SHORE_LACE_SCALE);
  return coarse * 0.6 + valueNoise(mat2(0.8, -0.6, 0.6, 0.8) * xz * (SHORE_LACE_SCALE * 2.3) + 19.3) * 0.4;
#else
  // One octave only: at the fine octave's scale, so the flecks stay bubble sized.
  return valueNoise(mat2(0.8, -0.6, 0.6, 0.8) * xz * (SHORE_LACE_SCALE * 1.8));
#endif
}

/** Analytic (no fetch) wobble -1..1 of the band edges and 0..1 patchiness of the water film. */
vec2 getShoreBreakup(vec2 xz) {
  float wobble = sin(dot(xz, vec2(1.7, -1.1))) * 0.5 + sin(dot(xz, vec2(-0.6, 2.3)) + 1.3) * 0.5;
  float patches = sin(dot(xz, vec2(2.9, 1.9)) + sin(dot(xz, vec2(-1.3, 3.7))) * 1.6);
  return vec2(wobble, patches * 0.5 + 0.5);
}
${SWASH_SHEET_GLSL}
/** Wetness for applyGroundWetness: the sheet and its drained film, the saturated zone, the damp band. */
float getShoreWetness(float signedDepth, float coast, vec2 xz, SwashSheet sheet) {
  float height = -signedDepth;
  if (height > SHORE_DAMP_HEIGHT.y * 1.2 || coast > SHORE_DAMP_COAST.y + 0.4) return 0.0;
  float exposed = smoothstep(-0.03, 0.0, height);
  // Submerged ground is saturated and matte, except under the sheet's edge at the waterline.
  float submerged = mix(0.5, 1.0, sheet.cover);
  if (exposed <= 0.0) return submerged;
  vec2 breakup = getShoreBreakup(xz);
  float jitter = breakup.x * 0.5;
  float film = max(sheet.cover, sheet.linger * (0.8 + 0.2 * breakup.y));
  float soak = SHORE_SOAK * (1.0 - smoothstep(SHORE_SOAK_HEIGHT.x, SHORE_SOAK_HEIGHT.y, height + jitter * 0.05));
  float dampTop = SHORE_DAMP_HEIGHT.y * (1.0 + 0.2 * breakup.x);
  float damp = SHORE_DAMP * pow(1.0 - smoothstep(SHORE_DAMP_HEIGHT.x, dampTop, height), SHORE_DAMP_CURVE)
    * (1.0 - smoothstep(SHORE_DAMP_COAST.x, SHORE_DAMP_COAST.y, coast + jitter * 0.6));
  return mix(submerged, max(max(film, soak), damp), exposed);
}

/** The sheet's water over the wet sand: a clear tint, (High) its ripples, and the foam it carries. */
void coverWithSwash(inout GroundSample ground, SwashSheet sheet) {
  ground.albedo *= mix(vec3(1.0), SWASH_WATER_TINT, sheet.cover * (0.2 + 0.8 * sheet.depth));
  ground.normal = normalize(ground.normal + vec3(sheet.slope.x, 0.0, sheet.slope.y) * sheet.cover);
  ground.albedo = mix(ground.albedo, SWASH_FOAM_ALBEDO, sheet.foam);
  ground.roughness = mix(ground.roughness, 0.6, sheet.foam);
}

/**
 * Lit swash foam rolled off above a knee toward a ceiling (luminance, hue kept), like the noon snow: the
 * near-white foam lit by the full sun went far past the bloom threshold and glowed as a thick white line
 * along the shore (review 2026-11-17). Foam below the knee (the ref-tuner's foam/sand contrast) is unchanged.
 */
vec3 rollOffSwashFoam(vec3 color, float foam) {
  if (foam <= 0.0) return color;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  if (luma <= SWASH_FOAM_ROLL_OFF.x) return color;
  float excess = luma - SWASH_FOAM_ROLL_OFF.x;
  float rolled = SWASH_FOAM_ROLL_OFF.x + excess / (1.0 + excess / (SWASH_FOAM_ROLL_OFF.y - SWASH_FOAM_ROLL_OFF.x));
  return color * mix(1.0, rolled / luma, clamp(foam * 1.5, 0.0, 1.0));
}

/** 1 where the swash sheet may show: 0 on snow and on frozen shores (they stay matte). */
float getShoreOpen(vec4 splatB, float frozen) {
  return 1.0 - max(getGroundSnowShare(splatB), frozen);
}

/**
 * River bank and spray wetness of the surface mask (TT-2, surface-mask.ts) on exposed ground,
 * slightly patchy; snow-covered and frozen banks stay dry.
 */
float getBankWetness(float bankWetness, float exposed, float matte, vec2 xz) {
  if (bankWetness <= 0.0) return 0.0;
  return bankWetness * exposed * (1.0 - matte) * (0.85 + 0.15 * getShoreBreakup(xz).y);
}

/**
 * Wet shore and the swash sheet on the ground sample, before lighting (the snow and the frozen shore
 * stay matte and keep the saturated darkening only). Returns x: the film share, y: the sheet share
 * of it, for getWetGroundSheen. River banks and spray come from the surface mask's wetness
 * (TT-2), the wetter of both.
 */
vec2 wetShoreGround(
  inout GroundSample ground, vec3 geometryNormal, vec4 splatA, vec4 splatB, float signedDepth, float coast,
  vec2 xz, float open, SwashSheet sheet, float bankWetness
) {
  float exposed = smoothstep(-0.03, 0.0, -signedDepth);
  float wetness = max(getShoreWetness(signedDepth, coast, xz, sheet),
    getBankWetness(bankWetness, exposed, 1.0 - open, xz));
  if (wetness <= 0.0) return vec2(0.0);
  float porosity = mix(1.0, getGroundPorosity(splatA, splatB), exposed);
  float film = applyGroundWetness(ground, geometryNormal, min(wetness, mix(0.5, 1.0, open)), porosity);
  film *= mix(SHORE_STEEP_FILM, 1.0, getSwashGentle(geometryNormal));
  if (sheet.cover + sheet.foam <= 0.0) return vec2(film, 0.0);
  coverWithSwash(ground, sheet);
  return vec2(film * (1.0 - sheet.foam), sheet.cover);
}
`;
