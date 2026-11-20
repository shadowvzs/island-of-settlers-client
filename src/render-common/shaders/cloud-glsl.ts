import { glslLiteral } from "./glsl-literal";

/** World height of the cloud layer (also where a cinematic bolt starts, CIN6). */
export const CLOUD_HEIGHT = 32;
/** Cloud field and projected shadow constants, shared with the WebGPU TSL lighting twin. */
export const CLOUD_FIELD = {
  driftScale: 0.012,
  /** Width of the cover's soft edge in fbm3 units. */
  edgeWidth: 0.22,
  noiseScale: 0.022,
  /** Lowest sun height used by the shadow projection (keeps grazing light finite). */
  shadowMinSunHeight: 0.2,
  /** Light left under a fully dense cloud. */
  shadowShade: 0.7
} as const;
/** CLOUD_FIELD as GLSL literals (the generated source is unchanged by the shared constants). */
const CLOUD = {
  driftScale: glslLiteral(CLOUD_FIELD.driftScale),
  edgeWidth: glslLiteral(CLOUD_FIELD.edgeWidth),
  noiseScale: glslLiteral(CLOUD_FIELD.noiseScale),
  shadowMinSunHeight: glslLiteral(CLOUD_FIELD.shadowMinSunHeight),
  shadowShade: glslLiteral(CLOUD_FIELD.shadowShade)
};

/** One weather/wind field shared by sky clouds and projected surface shadows. */
export const CLOUD_FIELD_GLSL = `
const float CLOUD_HEIGHT = ${CLOUD_HEIGHT.toFixed(1)};
float cloudDensity(vec2 xz) {
  float noise = fbm3(xz * ${CLOUD.noiseScale} + uCloudDrift * ${CLOUD.driftScale});
  float edge = 1.0 - uCloudCover;
  return smoothstep(edge, edge + ${CLOUD.edgeWidth}, noise);
}
float cloudShadow(vec2 xz) {
  vec2 projected = xz + uSunDirection.xz * CLOUD_HEIGHT / max(uSunDirection.y, ${CLOUD.shadowMinSunHeight});
  return mix(1.0, ${CLOUD.shadowShade}, cloudDensity(projected));
}
`;
