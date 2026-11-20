/**
 * Presentation boundary, separate from world-space weather. Geometry must meet the sky before
 * the perspective far plane cuts it away. Spyglass changes this boundary, never weather density.
 */
export const ATMOSPHERE_VIEW_LIMIT_GLSL = `
float atmosphereViewLimitOpticalDepth(vec3 worldPosition) {
  if (uAtmospherePass < 0.5 || uExplorationFog <= 0.0 || uAtmosphereFar <= 0.0) return 0.0;
  float viewDepth = dot(worldPosition - uAtmosphereEye, uAtmosphereForward);
  float start = uAtmosphereFar * 0.6;
  if (viewDepth <= start) return 0.0;
  float veil = smoothstep(start, uAtmosphereFar * 0.98, viewDepth) * uExplorationFog;
  return -log(max(1.0 - veil, 0.000001));
}
`;
