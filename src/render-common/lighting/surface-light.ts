/**
 * Constants of the shared surface light (`lightSurface` in common-glsl's LIGHTING_GLSL), imported by
 * the GLSL template and the WebGPU TSL twin (renderers/webgpu/tsl/lighting.ts).
 */
export const SURFACE_LIGHT = {
  /** Rain darkening of the albedo (wet surfaces). */
  rainDarkening: 0.25,
  /** Rain sheen: sun share, sky share, specular power and the upward-face band. */
  sheenPower: 36,
  sheenSky: 0.25,
  sheenSlopeEnd: 0.9,
  sheenSlopeStart: 0.4,
  sheenSun: 0.35,
  /** Share of the SH9 sky irradiance against the sun. */
  skyShare: 0.8,
  /** Wrapped Lambert: (n·l + wrap) / (1 + wrap). */
  sunWrap: 0.2
} as const;
