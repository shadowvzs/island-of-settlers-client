import type { FishMarking } from "../../render-common/fish-schools/fish-species";

/** The marking ids of FISH_PAINT_GLSL's `uMarking`. */
export const FISH_MARKING_IDS: Record<FishMarking, number> = {
  bands: 4,
  bars: 2,
  eyeband: 3,
  none: 0,
  stripe: 1,
  twotone: 5
};

/**
 * Per-pixel fish colours from the rest-pose body coordinates (vBody, vFin; FISH_VERTEX_GLSL):
 * countershading (dark back, flank, light belly), the species marking with anti-aliased edges,
 * diamond scale rows, a dark pupil in a light iris ring on both flanks, and fins in their own
 * stronger colour with fine rays and a pale rim. Needs the fragment's `vBody`, `vFin`.
 */
export const FISH_PAINT_GLSL = `
uniform vec3 uBack;
uniform vec3 uSide;
uniform vec3 uBelly;
uniform vec3 uAccent;
uniform vec3 uFinColor;
uniform float uMarking;
const float FISH_PI = 3.14159265;
/** Body share 0 (tail root) .. 1 (snout) of the length share x (stations -0.4 .. 0.46). */
float bodyShare() {
  return (vBody.x + 0.4) / 0.86;
}

/** Ring direction around the body axis: x up share (1 back .. -1 belly), y side share. */
vec2 ringDirection() {
  vec2 ring = vBody.yz;
  return ring / max(length(ring), 1e-4);
}

/** 1 within halfWidth of centre, an anti-aliased edge one pixel wide. */
float band(float value, float centre, float halfWidth) {
  float edge = fwidth(value) * 0.75 + 1e-4;
  return 1.0 - smoothstep(halfWidth - edge, halfWidth + edge, abs(value - centre));
}

float getMarking(float t, float up) {
  if (uMarking < 0.5) return 0.0;
  if (uMarking < 1.5) return band(up, 0.0, 0.17) * band(t, 0.48, 0.42);
  if (uMarking < 2.5) {
    float bars = 0.5 + 0.5 * sin(t * FISH_PI * 10.0 + 1.2);
    return smoothstep(0.45, 0.65, bars) * smoothstep(-0.55, -0.35, up) * band(t, 0.47, 0.4);
  }
  if (uMarking < 3.5) return max(band(t, 0.8, 0.045), band(t, 0.24, 0.05) * smoothstep(-0.1, 0.1, up));
  if (uMarking < 4.5) return max(max(band(t, 0.8, 0.04), band(t, 0.5, 0.05)), band(t, 0.14, 0.03));
  return 1.0 - smoothstep(0.62, 0.7, t);
}

/** Thin dark rims around the white bands (the clownfish-like outline). */
float getBandRims(float t) {
  if (uMarking < 3.5 || uMarking > 4.5) return 0.0;
  float rims = 0.0;
  rims += band(t, 0.8, 0.055) - band(t, 0.8, 0.04);
  rims += band(t, 0.5, 0.065) - band(t, 0.5, 0.05);
  rims += band(t, 0.14, 0.045) - band(t, 0.14, 0.03);
  return clamp(rims, 0.0, 1.0);
}

/** Diamond scale rows: 0 between the rows .. 1 on a scale. */
float getScaleRows() {
  float t = bodyShare(), up = ringDirection().x;
  return 0.5 + 0.5 * sin(t * 90.0 + up * 9.0) * sin(t * 90.0 - up * 9.0);
}

vec3 paintBody(float scales) {
  float t = bodyShare();
  vec2 ring = ringDirection();
  vec3 color = mix(uSide, uBack, smoothstep(0.35, 0.8, ring.x));
  color = mix(color, uBelly, smoothstep(-0.25, -0.7, ring.x));
  color = mix(color, uAccent, getMarking(t, ring.x));
  color *= 1.0 - 0.75 * getBandRims(t);
  color *= 0.9 + 0.12 * scales;
  // Larger than nature: the eye must read at the half-resolution capture.
  vec2 eye = vec2((t - 0.87) / 0.065, (ring.x - 0.42) / 0.32);
  float onFlank = smoothstep(0.3, 0.5, abs(ring.y));
  float iris = band(length(eye), 0.0, 1.0) * onFlank;
  float pupil = band(length(eye), 0.0, 0.55) * onFlank;
  // The head darkens towards the snout on the back (reads as a head from above).
  color *= 1.0 - 0.3 * smoothstep(0.8, 0.98, t) * smoothstep(0.0, 0.6, ring.x);
  color = mix(color, vec3(0.92, 0.88, 0.7), iris);
  return mix(color, vec3(0.015, 0.015, 0.02), pupil);
}

/** Fins a little more saturated than the body, so they read through the water. */
vec3 saturateFin(vec3 color) {
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(grey), color, 1.35), 0.0, 1.0);
}

vec3 paintFin() {
  float rays = 0.5 + 0.5 * sin((vBody.y * 1.4 - vBody.x) * 160.0);
  vec3 color = saturateFin(uFinColor) * (0.78 + 0.22 * rays);
  float rim = smoothstep(0.62, 0.66, abs(vBody.x)) + smoothstep(0.24, 0.3, abs(vBody.y));
  return mix(color, saturateFin(uFinColor) * 1.25 + 0.08, clamp(rim, 0.0, 1.0) * 0.5);
}

vec3 paintFish(float scales) {
  return mix(paintBody(scales), paintFin(), step(0.5, vFin));
}
`;
