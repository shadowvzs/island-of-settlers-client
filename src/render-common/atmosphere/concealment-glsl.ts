/** Exploration presentation only. This never changes the physical weather field or saved sight. */
export const CONCEALMENT_UNIFORMS_GLSL = `
uniform float uExplorationFog;
uniform float uLiveFog;
uniform vec2 uWorldSize;
uniform sampler2D uFogMap;
`;

/**
 * Reuses the composed visibility texture, with actual 3D ray positions and a soft height falloff.
 * Unlike the replaced XZ sky projection, upward rays naturally leave the concealment layer.
 * This separate veil shares airlight with weather, but does not make visibility weather density.
 */
export const CONCEALMENT_GLSL = `
float concealmentOpticalDepth(AtmosphereRay ray) {
  if (uExplorationFog <= 0.0 || uLiveFog < 0.5 || uAtmospherePass < 0.5 ||
      uWorldSize.x <= 0.0 || uWorldSize.y <= 0.0 || ray.length <= 3.0) return 0.0;
  float span = min(ray.length, 128.0) - 3.0;
  float stepLength = span / 6.0;
  float opticalDepth = 0.0;
  for (int index = 0; index < 6; index++) {
    vec3 point = ray.origin + ray.direction * (3.0 + (float(index) + 0.5) * stepLength);
    vec2 edge = min(point.xz, uWorldSize - point.xz);
    float interior = smoothstep(0.0, 12.0, min(edge.x, edge.y));
    if (interior <= 0.0) continue;
    float visibility = texture(uFogMap, point.xz / uWorldSize).r;
    float hidden = 1.0 - smoothstep(0.12, 0.48, visibility);
    float height = exp(-max(point.y - uAtmosphereProfile.z - 2.0, 0.0) * 0.12);
    opticalDepth += hidden * interior * height * stepLength * 0.12;
  }
  return min(opticalDepth * uExplorationFog, 32.0);
}
`;
