import { DRAGON_SCULPT_GLSL } from "./japanese-sail-dragon-sculpt";

/**
 * Fragment shader rendering the sculpted sail dragon (japanese-sail-dragon-sculpt.ts) as an illustration:
 * a key light from the upper left with soft shadows and ambient occlusion, banded cel/gradient tones,
 * glossy highlights, inked scale edges and belly-plate grooves. uMode 0 writes colour (2x2 supersampled,
 * alpha = coverage); uMode 1 writes material and depth for the outline pass.
 */
export const DRAGON_FRAGMENT_GLSL = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform int uMode;
out vec4 outColor;
${DRAGON_SCULPT_GLSL}
const vec3 CAMERA = vec3(0.0, 0.0, 6.0);
const float FRAME = 1.15, NEAR = 4.6, FAR = 7.6;
const vec3 KEY = vec3(-0.5, 0.68, 0.54);
const vec3 INK = vec3(0.05, 0.09, 0.05);

vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0); const float e = 0.0012;
  return normalize(k.xyy * map(p + k.xyy * e).x + k.yyx * map(p + k.yyx * e).x + k.yxy * map(p + k.yxy * e).x
    + k.xxx * map(p + k.xxx * e).x);
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.012;
  for (int i = 0; i < 40 && t < 1.6; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 9.0 * h / t);
    if (res < 0.01) break;
    t += clamp(h, 0.006, 0.12);
  }
  return clamp(res, 0.0, 1.0);
}

float occlusion(vec3 p, vec3 n) {
  float occ = 0.0, weight = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.012 * float(i * i);
    occ += (h - map(p + n * h).x) * weight; weight *= 0.7;
  }
  return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

/** Ray march; returns (t, material) or t < 0 for a miss. */
vec2 march(vec3 ro, vec3 rd) {
  float t = NEAR;
  for (int i = 0; i < 260; i++) {
    vec2 h = map(ro + rd * t);
    if (h.x < 0.0004) return vec2(t, h.y);
    t += h.x * 0.8;
    if (t > FAR) break;
  }
  return vec2(-1.0, 0.0);
}

vec3 hex(float r, float g, float b) { return vec3(r, g, b) / 255.0; }

/** Green scale colour: lighter domes, darker roots, inked free edges. Returns rgb; ink in .a of out. */
vec4 scaleSkin(vec3 scale) {
  vec3 dark = hex(28.0, 84.0, 36.0), mid = hex(48.0, 128.0, 52.0), light = hex(118.0, 190.0, 80.0);
  vec3 colour = mix(mix(dark, mid, smoothstep(0.1, 0.55, scale.x)), light, smoothstep(0.6, 1.0, scale.x) * 0.55);
  colour *= 0.9 + 0.2 * scale.y;
  return vec4(colour, scale.z * 0.85);
}

vec4 bodySkin(vec3 p) {
  vec3 centre, tangent; vec3 axis = spineAxis(p, centre, tangent);
  vec3 dorsal = spineDorsal(tangent), side = cross(tangent, dorsal), o = p - centre;
  float angle = atan(dot(o, side), dot(o, dorsal));
  return scaleSkin(shingles(vec2(axis.y / 0.055, angle * axis.z / 0.055)));
}

vec4 belly(vec3 p) {
  vec3 centre, tangent; vec3 axis = spineAxis(p, centre, tangent);
  float plate = fract(axis.y / 0.09);
  vec3 colour = mix(hex(170.0, 88.0, 30.0), hex(236.0, 160.0, 66.0), smoothstep(0.05, 0.5, plate));
  colour = mix(colour, hex(250.0, 196.0, 104.0), smoothstep(0.55, 0.85, plate) * 0.4);
  return vec4(colour, 1.0 - smoothstep(0.02, 0.07, plate));
}

vec4 hornColour(vec3 p) {
  float t = horn(toHead(p)).y, band = 0.5 + 0.5 * sin(t * 80.0);
  vec3 colour = mix(hex(120.0, 92.0, 70.0), hex(196.0, 172.0, 140.0), smoothstep(0.0, 0.5, t));
  colour = mix(colour, hex(90.0, 70.0, 56.0), smoothstep(0.75, 1.0, t) * 0.6);
  return vec4(colour * (0.82 + 0.18 * band), smoothstep(0.8, 0.97, band) * 0.35);
}

vec4 maneColour(vec3 p) {
  vec3 centre, tangent; vec3 axis = spineAxis(p, centre, tangent);
  vec3 h = toHead(p);
  float root = min(min(upperHead(h), lowerJaw(h)) * HEAD_SCALE, axis.x - axis.z);
  float tip = smoothstep(0.0, 0.22, root);
  return vec4(mix(hex(30.0, 92.0, 40.0), hex(150.0, 210.0, 92.0), tip), 0.0);
}

vec4 eyeColour(vec3 p) {
  vec3 h = toHead(p), q = vec3(h.xy, abs(h.z)), e = normalize(q - EYE_CENTRE);
  vec3 gaze = normalize(vec3(-0.55, 0.05, 0.83)), right = normalize(cross(vec3(0, 1, 0), gaze));
  vec3 up = cross(gaze, right);
  float c = dot(e, gaze), u = dot(e, right), v = dot(e, up);
  vec3 iris = mix(hex(255.0, 214.0, 70.0), hex(226.0, 76.0, 12.0), smoothstep(0.98, 0.7, c));
  vec3 colour = mix(hex(110.0, 30.0, 10.0), iris, smoothstep(0.6, 0.66, c));
  float slit = step(abs(u), 0.07 * (1.0 - v * v * 2.2)) * step(0.72, c);
  return vec4(mix(colour, vec3(0.02), slit), smoothstep(0.66, 0.6, c) * smoothstep(0.5, 0.6, c));
}

/** Albedo (rgb) and ink (a) of the surface under p. */
vec4 surfaceColour(vec3 p, float m) {
  if (m == M_BODY) return bodySkin(p);
  if (m == M_BELLY) return belly(p);
  if (m == M_SKIN) { vec3 h = toHead(p); return scaleSkin(shingles(headScaleUv(h, headCentreY(h)))); }
  if (m == M_JAW) return scaleSkin(shingles(headScaleUv(toJaw(toHead(p)), -0.2)));
  if (m == M_LEG) return scaleSkin(shingles(p.xy * vec2(26.0, 30.0)));
  if (m == M_HORN) return hornColour(p);
  if (m == M_MANE) return maneColour(p);
  if (m == M_EYE) return eyeColour(p);
  if (m == M_MOUTH) return vec4(hex(150.0, 26.0, 26.0), 0.0);
  if (m == M_TONGUE) return vec4(hex(214.0, 86.0, 82.0), 0.0);
  if (m == M_WHISKER) return vec4(hex(40.0, 110.0, 46.0), 0.0);
  return vec4(hex(246.0, 238.0, 216.0), 0.0);
}

float glossOf(float m) {
  if (m == M_EYE || m == M_MOUTH || m == M_TONGUE) return 80.0;
  if (m == M_TOOTH || m == M_CLAW || m == M_HORN) return 40.0;
  return 24.0;
}

vec3 shade(vec3 p, vec3 rd, float m) {
  vec3 n = normalAt(p), key = normalize(KEY);
  vec4 surface = surfaceColour(p, m);
  float lit = clamp(dot(n, key), 0.0, 1.0) * softShadow(p + n * 0.004, key);
  float cel = smoothstep(0.06, 0.14, lit) * 0.45 + smoothstep(0.45, 0.55, lit) * 0.3 + lit * 0.25;
  float ao = occlusion(p, n);
  vec3 colour = surface.rgb * (0.38 + 0.8 * cel) * mix(0.5, 1.0, ao);
  colour *= mix(vec3(0.8, 0.86, 0.95), vec3(1.0), 0.5 + 0.5 * n.y);
  float specular = pow(max(dot(n, normalize(key - rd)), 0.0), glossOf(m));
  colour += vec3(1.0, 0.97, 0.88) * smoothstep(0.35, 0.6, specular) * (m == M_EYE ? 0.9 : (m == M_BELLY ? 0.12 : 0.3)) * lit;
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * smoothstep(-0.2, 0.4, dot(n, vec3(0.7, 0.3, -0.3)));
  colour += vec3(0.55, 0.8, 0.4) * rim * 0.25 * ao;
  return mix(colour, INK, surface.a);
}

void main() {
  if (uMode == 1) {
    vec2 hit = march(CAMERA, normalize(vec3((gl_FragCoord.xy / uResolution * 2.0 - 1.0) * FRAME, -6.0)));
    if (hit.x < 0.0) { outColor = vec4(0.0); return; }
    float depth = clamp((hit.x - NEAR) / (FAR - NEAR), 0.0, 1.0) * 65535.0;
    outColor = vec4(hit.y / 16.0, floor(depth / 256.0) / 255.0, mod(depth, 256.0) / 255.0, 1.0);
    return;
  }
  vec3 sum = vec3(0.0); float hits = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 offset = vec2(float(i % 2), float(i / 2)) * 0.5 - 0.25;
    vec3 rd = normalize(vec3(((gl_FragCoord.xy + offset) / uResolution * 2.0 - 1.0) * FRAME, -6.0));
    vec2 hit = march(CAMERA, rd);
    if (hit.x < 0.0) continue;
    sum += shade(CAMERA + rd * hit.x, rd, hit.y); hits += 1.0;
  }
  outColor = hits > 0.0 ? vec4(clamp(sum / hits, 0.0, 1.0), hits / 4.0) : vec4(0.0);
}
`;
