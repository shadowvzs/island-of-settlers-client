/**
 * River bed by flow speed (RC-1, render only; needs NOISE_GLSL). Fast water washes the fines out of
 * its bed (pool-riffle, plane bed and step-pool channels; Montgomery & Buffington 1997): under the
 * water, sand and soil turn to gravel above speed 1.0 and to cobble and bedrock (the rock layer)
 * above 1.8. The speed is the ground's flow varying (vWater.zw: 0 on sea and lakes, 0.6 .. 2.6 in
 * rivers), so sea and lake beds keep their splat. The borders wander with one noise fetch (river
 * pixels only); the full ground blends them by layer height like every other edge, while the lite
 * ground (Minimal) switches whole layers, so a river pixel never samples more layers than before.
 * The saved splat, navigation and editor data stay unchanged.
 */
import { MATERIAL } from "../../shared/world/world-data";
import { splatOf } from "./shore-wetness-glsl";

export const RIVER_BED_GLSL = `
/** Flow speed where the bed turns from sand to gravel and from gravel to cobble and bedrock. */
const vec2 RIVER_BED_SPEED = vec2(1.0, 1.8);
/** Speed the noise moves those borders by (either way), so they meander instead of following the flow. */
const float RIVER_BED_WANDER = 0.45;
/** Half width (speed) of the full ground's blend band around each border. */
const float RIVER_BED_BLEND = 0.25;
/** Water depth where the scoured bed starts and is complete: banks and the swash keep their soil. */
const vec2 RIVER_BED_DEPTH = vec2(0.03, 0.14);
/**
 * Noise cells per world unit of the border wander (patches of about 0.9 units): fine enough that a
 * speed step between two carved profile samples breaks into lobes instead of a clean curve.
 */
const float RIVER_BED_NOISE_SCALE = 1.1;

/** 0 .. 1 share past a border: a height-blended band on the full ground, a hard switch on the lite. */
float riverBedStep(float border, float value, float band) {
#ifdef RIVER_BED_BLEND_BAND
  return smoothstep(border - band, border + band, value);
#else
  return step(border, value);
#endif
}

/**
 * Moves the submerged sand and soil of fast river water to gravel and rock (call after
 * shedOntoCliffs, which turns gentle rock into the apron gravel). depth is the signed water depth.
 */
void shapeRiverBed(inout vec4 splatA, inout vec4 splatB, vec2 flow, float depth, vec2 xz) {
  float speed = length(flow);
  if (speed < RIVER_BED_SPEED.x - RIVER_BED_WANDER || depth <= RIVER_BED_DEPTH.x) return;
  float wander = valueNoise(xz * RIVER_BED_NOISE_SCALE + 23.7) * 2.0 - 1.0;
  float scoured = speed + wander * RIVER_BED_WANDER;
  float depthBorder = mix(RIVER_BED_DEPTH.x, RIVER_BED_DEPTH.y, 0.5);
  float depthBand = (RIVER_BED_DEPTH.y - RIVER_BED_DEPTH.x) * 0.5;
  float submerged = riverBedStep(depthBorder, depth + wander * depthBand, depthBand);
  float coarse = riverBedStep(RIVER_BED_SPEED.x, scoured, RIVER_BED_BLEND) * submerged;
  float boulder = riverBedStep(RIVER_BED_SPEED.y, scoured, RIVER_BED_BLEND);
  float fines = (${splatOf(MATERIAL.sand)} + ${splatOf(MATERIAL.dirt)}) * coarse;
  ${splatOf(MATERIAL.sand)} *= 1.0 - coarse;
  ${splatOf(MATERIAL.dirt)} *= 1.0 - coarse;
  ${splatOf(MATERIAL.gravel)} += fines * (1.0 - boulder);
  ${splatOf(MATERIAL.rock)} += fines * boulder;
}
`;
