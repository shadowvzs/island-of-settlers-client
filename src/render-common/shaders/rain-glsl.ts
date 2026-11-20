/**
 * Screen space precipitation: two layers of slanted, falling rain streaks (slant
 * follows the wind) or, where the view is in a winter area, slowly drifting snowflakes, plus a
 * light grey haze. uPrecipitation: 0 dry .. 1 heavy; uSnowfall: the snow share of it (0 rain ..
 * 1 snow). Needs COMMON_UNIFORMS and NOISE (for the per cell randomness). Output is
 * premultiplied.
 */
export const RAIN_OVERLAY_GLSL = `
uniform vec2 uViewportSize;
uniform float uPrecipitation;
uniform float uSnowfall;
uniform float uLightning;

float rainLayer(vec2 uv, float columns, float speed, float slant, float time) {
  // Each column gets its own angle and fall speed; drops no longer move as one sheet.
  vec2 column = floor(vec2(uv.x * columns, uv.y * columns * 0.09));
  float angleSeed = texture(uNoiseTexture, (column + 0.5) / 197.0).r;
  float localSlant = slant + (angleSeed - 0.5) * 0.24;
  float localSpeed = speed * (0.72 + angleSeed * 0.56);
  vec2 p = vec2(uv.x * columns + uv.y * localSlant * columns,
    uv.y * columns * 0.09 + time * localSpeed);
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float seed = texture(uNoiseTexture, (cell + 0.5) / 197.0).r;
  float present = step(0.48, fract(seed * 17.31));
  float streak = smoothstep(0.08, 0.0, abs(f.x - fract(seed * 3.7)));
  float length = smoothstep(0.0, 0.3, f.y) * smoothstep(0.85, 0.45, f.y);
  return streak * length * present;
}

/** Round flakes, one at most per cell, falling slowly and swaying with the wind. */
float snowLayer(vec2 uv, float cells, float speed, float time, float offset) {
  float sway = sin(time * 0.8 + uv.y * 7.0 + offset) * 0.25 + uWind.x * time * 0.04;
  vec2 p = vec2(uv.x * cells + sway, uv.y * cells + time * speed);
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float seed = texture(uNoiseTexture, (cell + offset + 0.5) / 197.0).g;
  float present = step(0.5, fract(seed * 13.7));
  vec2 centre = vec2(fract(seed * 7.13), fract(seed * 3.31)) * 0.6 + 0.2;
  float radius = 0.06 + fract(seed * 5.7) * 0.06;
  return present * smoothstep(radius, radius * 0.3, length(f - centre));
}

vec4 rainOverlay(vec2 fragCoord) {
  vec2 uv = fragCoord / uViewportSize;
  uv.x *= uViewportSize.x / uViewportSize.y;
  float slant = clamp(uWind.x * 0.12, -0.4, 0.4);
  float rain = 0.0;
  if (uSnowfall < 1.0) {
    float near = rainLayer(uv, 70.0, 6.0, slant, uTime);
    float far = rainLayer(uv + vec2(0.37, 0.11), 130.0, 4.2, slant, uTime) * 0.6;
    rain = (near * 0.32 + far * 0.22) * (1.0 - uSnowfall);
  }
  float snow = 0.0;
  if (uSnowfall > 0.0) {
    float near = snowLayer(uv, 24.0, 0.55, uTime, 0.0);
    float far = snowLayer(uv + vec2(0.21, 0.53), 46.0, 0.35, uTime, 41.0) * 0.6;
    snow = (near * 0.85 + far * 0.6) * uSnowfall;
  }
  float alpha = (rain + snow) * uPrecipitation + uPrecipitation * 0.07;
  vec3 color = mix(vec3(0.82, 0.86, 0.92), uAmbientSky + uSunColor * 0.2, 0.4);
  color = mix(color, vec3(0.95, 0.97, 1.0), snow / max(rain + snow, 0.001));
  // The world-space bolt carries the shape; this only adds the storm's screen flash.
  float flash = clamp(uLightning, 0.0, 1.0);
  color = mix(color, vec3(0.90, 0.95, 1.0), flash * 0.55);
  alpha = max(alpha, flash * 0.30);
  return vec4(color * alpha, alpha);
}
`;
