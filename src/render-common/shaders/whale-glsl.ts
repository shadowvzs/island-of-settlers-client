import { WHALE_SKIN_FRACTION } from "../whales/whale-model";
import { ARCH_CENTRE, STROKE_START, STROKE_WAVE } from "../whales/whale-pose";

const float = (value: number) => value.toFixed(4);

/**
 * The whale's bend (the same formulas as whale-pose.ts): pectoral fins turn about their roots,
 * then every vertex follows the spine lifted by the fluke stroke and the arch, its ring turned
 * with the spine's slope. uWhaleBend: stroke phase, stroke amplitude, arch, pectoral turn;
 * uPectoralRoot: the left fin root's y and z (the right one mirrors it).
 */
export const WHALE_BEND_GLSL = `
uniform vec4 uWhaleBend;
uniform vec2 uPectoralRoot;
const float STROKE_WAVE = ${float(STROKE_WAVE)};
const float ARCH_CENTRE = ${float(ARCH_CENTRE)};
const float STROKE_START = ${float(STROKE_START)};

void turnPectoral(inout vec3 point, inout vec3 normal, float side) {
  float turn = uWhaleBend.w * side;
  float c = cos(turn);
  float s = sin(turn);
  vec2 local = point.yz - vec2(uPectoralRoot.x, uPectoralRoot.y * side);
  point.yz = vec2(uPectoralRoot.x, uPectoralRoot.y * side)
    + vec2(local.x * c + local.y * s, -local.x * s + local.y * c);
  normal.yz = vec2(normal.y * c + normal.z * s, -normal.y * s + normal.z * c);
}

void bendWhale(float along, inout vec3 point, inout vec3 normal) {
  float share = max(0.0, (along - STROKE_START) / (1.0 - STROKE_START));
  float envelope = share * sqrt(share);
  float envelopeSlope = share > 0.0 ? 1.5 * sqrt(share) / (1.0 - STROKE_START) : 0.0;
  float wave = uWhaleBend.x - STROKE_WAVE * along;
  float offset = along - ARCH_CENTRE;
  float lift = uWhaleBend.y * envelope * sin(wave) + uWhaleBend.z * offset * offset;
  float liftPerAlong = uWhaleBend.y
    * (envelopeSlope * sin(wave) - envelope * STROKE_WAVE * cos(wave)) + 2.0 * uWhaleBend.z * offset;
  float angle = atan(-liftPerAlong);
  float c = cos(angle);
  float s = sin(angle);
  point = vec3(point.x - point.y * s, lift + point.y * c, point.z);
  normal = vec3(normal.x * c - normal.y * s, normal.x * s + normal.y * c, normal.z);
}
`;

/**
 * Procedural whale skin (no texture): markings, bumps (world units, for derivative bump
 * mapping) and wet gloss from the skin coordinate (whale-model.ts) and the rest position.
 * uSpecies 0 humpback, 1 orca. WHALE_LITE (Minimal) keeps the markings and drops the small relief.
 */
export const WHALE_SKIN_GLSL = `
struct WhaleSkin {
  vec3 albedo;
  float gloss;
  float height;
};

const float PI = 3.14159265;
/** Blue-slate humpback back (vivid but natural), the orca's blue-black. */
const vec3 HUMPBACK_DARK = vec3(0.11, 0.135, 0.175);
const vec3 HUMPBACK_SLATE = vec3(0.19, 0.225, 0.28);
const vec3 HUMPBACK_FLANK = vec3(0.3, 0.33, 0.37);
const vec3 SCAR = vec3(0.55, 0.57, 0.58);
const vec3 ORCA_BLACK = vec3(0.022, 0.026, 0.036);
const vec3 ORCA_SHEEN = vec3(0.045, 0.052, 0.07);

float band(float value, float centre, float width) {
  return 1.0 - smoothstep(0.0, width, abs(value - centre));
}

/** Soft ellipse: 1 inside, 0 outside, along / around the body (body lengths, ring share). */
float patchMask(vec2 at, vec2 centre, vec2 radii, float tilt, float softness) {
  vec2 local = at - centre;
  local.y -= local.x * tilt;
  return 1.0 - smoothstep(1.0 - softness, 1.0, length(local / radii));
}

/** Jittered cell bumps (tubercles, barnacles): 0 .. 1 height and the cell's random value. */
vec2 cellBumps(vec2 p, float radius) {
  vec2 cell = floor(p);
  vec4 random = valueNoise4(cell * 7.31 + 0.5);
  vec2 centre = cell + 0.2 + random.xy * 0.6;
  float bump = 1.0 - smoothstep(radius * 0.4, radius, length(p - centre));
  return vec2(bump * bump, random.z);
}

/** Barnacle crust where 'amount' is high: clumped pale shells. */
vec2 barnacles(vec2 p, float amount) {
#ifdef WHALE_LITE
  return vec2(0.0);
#else
  float clump = smoothstep(0.55, 0.75, fbm3(p * 0.35) * amount);
  vec2 shells = cellBumps(p, 0.45);
  return vec2(shells.x * clump, clump);
#endif
}

WhaleSkin humpbackBody(float along, float around, float side, vec3 rest) {
  vec2 at = vec2(along, around);
  vec2 surface = vec2(rest.x, around * 0.32) * 60.0;
  float mottle = fbm3(surface * 0.25);
  // Darker back, paler mottled grey down the flanks, scattered pale speckles.
  float flank = smoothstep(0.25, 0.6, around + 0.12 * (mottle - 0.5));
  vec3 dark = mix(mix(HUMPBACK_DARK, HUMPBACK_SLATE, smoothstep(0.2, 0.8, mottle)), HUMPBACK_FLANK,
    flank * mix(0.25, 0.6, fbm3(surface * 0.09 + 5.0)));
  float speckles = smoothstep(0.76, 0.82, valueNoise(surface * 2.2 + 11.0)) * smoothstep(0.15, 0.45, around);
  dark = mix(dark, HUMPBACK_FLANK * 1.2, speckles * 0.35);
  // Pale pleated throat and belly with dark marbling (patterns differ between animals).
  float ventral = smoothstep(0.6, 0.7, around + 0.08 * (mottle - 0.5))
    * smoothstep(0.015, 0.05, along) * (1.0 - smoothstep(0.4, 0.52, along + 0.08 * mottle));
  float marble = smoothstep(0.42, 0.6, fbm3(surface * 0.12 + 9.0));
  vec3 albedo = mix(dark, mix(vec3(0.78, 0.8, 0.79), vec3(0.2, 0.22, 0.26), marble * 0.7), ventral);
  float height = 0.0;
  float gloss = 0.4;
  // Ventral pleats: grooves along the throat to the navel, converging at the chin.
  float pleated = smoothstep(0.5, 0.6, around) * smoothstep(0.01, 0.04, along)
    * (1.0 - smoothstep(0.42, 0.5, along));
  float groove = pow(abs(sin(around * PI * 34.0)), 8.0) * pleated;
  albedo *= 1.0 - groove * 0.45;
  height -= groove * 0.004;
  // Mouth line: bowed from the rostrum tip back to the corner under the eye.
  float mouthAround = 0.56 - 0.12 * sin(PI * clamp(along / 0.22, 0.0, 1.0));
  float mouth = band(around, mouthAround, 0.012) * (1.0 - smoothstep(0.2, 0.225, along));
  albedo *= 1.0 - mouth * 0.7;
  height -= mouth * 0.006;
  // Eye with its lid bulge just above and behind the mouth corner.
  float eyeDistance = length((at - vec2(0.215, 0.5)) * vec2(1.0, 0.32));
  float lid = 1.0 - smoothstep(0.006, 0.014, eyeDistance);
  float eye = 1.0 - smoothstep(0.004, 0.0055, eyeDistance);
  height += lid * 0.008;
  albedo = mix(albedo, vec3(0.03, 0.02, 0.02), eye);
  gloss = mix(gloss, 1.0, eye);
  // Twin blowholes behind a splash guard.
  float blowholes = band(along, 0.21, 0.012) * band(abs(around * side), 0.018, 0.008)
    * band(around, 0.0, 0.05);
  albedo *= 1.0 - blowholes * 0.8;
  height += band(along, 0.195, 0.012) * band(around, 0.0, 0.06) * 0.006 - blowholes * 0.008;
  // Knuckles: a row of low bumps along the dorsal ridge of the tail stock.
  float ridge = band(around, 0.0, 0.08) * smoothstep(0.66, 0.7, along) * (1.0 - smoothstep(0.84, 0.88, along));
  height += pow(0.5 + 0.5 * sin(along * PI * 40.0), 2.0) * ridge * 0.0025;
#ifndef WHALE_LITE
  // Tubercles: knobs on the rostrum and along the lower jaw.
  float head = (1.0 - smoothstep(0.17, 0.2, along)) * (band(around, 0.0, 0.32) + band(around, 0.7, 0.12));
  vec2 knob = cellBumps(vec2(rest.x * 48.0, around * 9.0), 0.32);
  float tubercle = knob.x * head * step(0.5, knob.y);
  height += tubercle * 0.005;
#endif
  // Pale rake scars (old orca bites) in short parallel sets on the flanks and tail stock.
  float scarZone = smoothstep(0.55, 0.75, fbm3(surface * 0.05 + 21.0)) * smoothstep(0.15, 0.3, around)
    * smoothstep(0.35, 0.5, along);
  float rake = smoothstep(0.85, 0.97, sin((surface.x * 0.7 + surface.y * 1.6) * 2.2)) * scarZone;
  albedo = mix(albedo, SCAR, rake * 0.75);
  vec2 crust = barnacles(surface * 0.5, (1.0 - smoothstep(0.03, 0.08, along)) * 1.3 + ventral * 0.25);
  albedo = mix(albedo, vec3(0.58, 0.57, 0.52), crust.x);
  height += crust.x * 0.006;
  gloss *= 1.0 - crust.y * 0.6;
  return WhaleSkin(albedo, gloss, height);
}

WhaleSkin orcaBody(float along, float around, vec3 rest) {
  vec2 at = vec2(along, around);
  float mottle = fbm3(vec2(rest.x, around * 0.32) * 18.0);
  vec3 black = mix(ORCA_BLACK, ORCA_SHEEN, mottle);
  vec3 white = vec3(0.78, 0.8, 0.8);
  // Eye patch: an oval above and behind the eye, rising towards the rear.
  float eyePatch = patchMask(at, vec2(0.175, 0.37), vec2(0.05, 0.075), -1.2, 0.18);
  // Chin and throat, narrowing along the belly; the flank lobe rising behind the dorsal fin.
  float throat = smoothstep(0.6, 0.64, around - 0.12 * smoothstep(0.3, 0.5, along))
    * (1.0 - smoothstep(0.34, 0.42, along));
  float belly = smoothstep(0.86, 0.9, around) * (1.0 - smoothstep(0.6, 0.66, along));
  float lobeEdge = 0.95 - 0.38 * exp(-pow((along - 0.64) / 0.07, 2.0)) * smoothstep(0.52, 0.6, along);
  float lobe = smoothstep(lobeEdge - 0.02, lobeEdge + 0.02, around) * (1.0 - smoothstep(0.76, 0.8, along));
  float whiteShare = max(max(eyePatch, throat), max(belly, lobe));
  // Grey saddle behind the dorsal fin.
  float saddle = patchMask(at, vec2(0.58, 0.0), vec2(0.085, 0.24), 0.0, 0.5);
  vec3 albedo = mix(mix(black, vec3(0.34, 0.36, 0.4), saddle * 0.85), white, whiteShare);
  float height = 0.0;
  float mouth = band(around, 0.6 - 0.04 * along / 0.12, 0.01) * (1.0 - smoothstep(0.11, 0.125, along));
  albedo = mix(albedo, vec3(0.02), mouth * 0.8);
  height -= mouth * 0.004;
  float eyeDistance = length((at - vec2(0.135, 0.53)) * vec2(1.0, 0.32));
  float eye = 1.0 - smoothstep(0.004, 0.0055, eyeDistance);
  height += (1.0 - smoothstep(0.005, 0.011, eyeDistance)) * 0.005;
  albedo = mix(albedo, vec3(0.01), eye);
  height += band(along, 0.15, 0.008) * band(around, 0.0, 0.03) * -0.005;
  return WhaleSkin(albedo, 0.85 - whiteShare * 0.45, height);
}

WhaleSkin whaleFin(float part, float chord, float span, float upper, vec3 rest) {
  bool humpback = uSpecies < 0.5;
  vec2 surface = vec2(rest.x * 60.0, span * 14.0);
  float mottle = fbm3(surface * 0.3);
  vec3 dark = humpback ? mix(HUMPBACK_DARK, HUMPBACK_SLATE, mottle) : mix(ORCA_BLACK, ORCA_SHEEN, mottle);
  vec3 pale = humpback ? vec3(0.8, 0.82, 0.8) : vec3(0.84, 0.86, 0.86);
  float white = 0.0;
  float height = 0.0;
  float isPectoral = step(part, 2.5);
  float isFluke = step(3.5, part);
  float under = 1.0 - smoothstep(-0.3, 0.3, upper);
  if (humpback) {
    // Long white flippers (the upper side dark at the root), knobs along the leading edge.
    white = isPectoral * max(under, smoothstep(0.2, 0.55, span + 0.15 * mottle));
    float knobs = pow(max(0.0, sin(span * PI * 9.0)), 3.0) * (1.0 - smoothstep(0.05, 0.25, chord));
    height += isPectoral * knobs * 0.01;
    // Fluke underside: white with a black trailing margin and streaks.
    float flukeWhite = under * smoothstep(0.08, 0.2, chord) * (1.0 - smoothstep(0.7, 0.85, chord))
      * (1.0 - smoothstep(0.75, 0.9, span)) * smoothstep(0.35, 0.5, fbm3(surface * 0.2 + 4.0) + 0.2);
    white = max(white, isFluke * flukeWhite);
  } else {
    // Orca: pale undersides of the flukes edged black.
    white = isFluke * under * smoothstep(0.1, 0.22, chord) * (1.0 - smoothstep(0.7, 0.82, chord))
      * (1.0 - smoothstep(0.7, 0.85, span)) * 0.85;
  }
  vec3 albedo = mix(dark, pale, white);
  float crustAmount = humpback
    ? (isPectoral * smoothstep(0.75, 1.0, span) + isFluke * smoothstep(0.85, 1.0, chord)) * 1.4
    : 0.0;
  vec2 crust = barnacles(surface * 0.6, crustAmount);
  albedo = mix(albedo, vec3(0.58, 0.57, 0.52), crust.x);
  height += crust.x * 0.005;
  // Thin trailing edges stay matte (their facets would glint as a dashed line).
  float edge = smoothstep(0.75, 0.95, chord);
  float gloss = (humpback ? 0.4 : 0.85) * (1.0 - crust.y * 0.6) * (1.0 - white * 0.5) * (1.0 - edge * 0.8);
  return WhaleSkin(albedo, gloss, height);
}

WhaleSkin whaleSkin(vec3 skin, vec3 rest) {
  float part = floor(skin.x);
  float fraction = clamp(
    (fract(skin.x) - ${float(WHALE_SKIN_FRACTION.offset)}) / ${float(WHALE_SKIN_FRACTION.span)}, 0.0, 1.0);
  if (part > 0.5) return whaleFin(part, fraction, skin.y, skin.z, rest);
  float around = atan(skin.z, skin.y) / PI;
  if (uSpecies < 0.5) return humpbackBody(fraction, abs(around), sign(around), rest);
  return orcaBody(fraction, abs(around), rest);
}
`;
