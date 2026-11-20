import { max, normalize, screenCoordinate, uniform, vec3 } from "three/tsl";

import { exposureForWeight } from "../../../render-common/color-output";
import { colorFinishDisplay, colorSrgbDecode, colorSrgbEncode, colorToneMap } from "./color-output";
import { createAtmosphereNodes } from "./sky/atmosphere";
import { bindComputed, bindScalar, type UniformBindings } from "./uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/** The camera air of a surface, applied to its linear radiance before the tone map. */
export type SurfaceAir = (linear: TslNode) => TslNode;

/**
 * GLSL colorIsLinearCapture: 1 while the presenter renders the seabed refraction capture, so the
 * surfaces write ungraded linear radiance and the water grades the bed once (not twice).
 */
export const surfaceLinearCapture = uniform(0);

/**
 * SURFACE_COLOR_OUTPUT_GLSL `finishSurface` / AIR_COLOR_OUTPUT_GLSL `finishColor`: display colour ->
 * linear -> camera air (optional) -> exposure + tonemap -> sRGB -> grade + dither. The node renderer
 * encodes the canvas, so the finished display colour is handed over in linear light. Build the
 * colour inside an `Fn` when it carries camera air (the air's gates are `If` statements).
 */
export const createSurfaceColorTail = (bindings: UniformBindings) => {
  const toneWeight = bindScalar(bindings, "uColorToneMapper", 0);
  const exposure = bindComputed(bindings, () =>
    exposureForWeight(Number(bindings.source.uColorToneMapper?.value ?? 0)));
  const gradeRain = bindScalar(bindings, "uColorGradeRain", 0);
  const vividBoost = bindScalar(bindings, "uColorVividBoost", 0);
  return (color: TslNode, air?: SurfaceAir): TslNode => {
    const linear = colorSrgbDecode(color);
    const radiance = air ? air(linear) : linear;
    const display = colorSrgbEncode(colorToneMap(radiance, exposure, toneWeight));
    const finished = colorSrgbDecode(
      colorFinishDisplay(display, screenCoordinate.xy, gradeRain, vividBoost, toneWeight)
    );
    return surfaceLinearCapture.greaterThan(0.5).select(max(radiance, vec3(0)), finished);
  };
};

/**
 * Camera air of world surfaces (the material's atmosphere uniforms): `toward` is `finishSurface`'s
 * blend along the view ray to `world`; `forward` is `finishColor`'s along the camera forward with a
 * caller's optical depth (the terrain, whose submerged ground leaves the air to the water).
 */
export const createSurfaceAir = (bindings: UniformBindings) => {
  const atmosphere = createAtmosphereNodes(bindings);
  return {
    forward: (tau: TslNode): SurfaceAir => linear =>
      atmosphere.compose(linear, tau, normalize(atmosphere.forward)),
    surfaceTau: atmosphere.surfaceTau,
    toward: (world: TslNode): SurfaceAir => linear =>
      atmosphere.compose(linear, atmosphere.surfaceTau(world), atmosphere.viewDirection(world))
  };
};
