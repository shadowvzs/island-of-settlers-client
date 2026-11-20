import { screenCoordinate } from "three/tsl";

import { exposureForWeight } from "../../../../render-common/color-output";
import {
  colorFinishDisplay,
  colorSrgbDecode,
  colorSrgbEncode,
  colorToneMap
} from "../color-output";
import {
  bindComputed,
  bindScalar,
  type UniformBindings
} from "../uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/**
 * The shared colour contract tail of a raw sky shader: COLOR_MODE_GLSL and COLOR_OUTPUT_GLSL.
 * `uColorOutputMode` 0 displays, 1 is the linear refraction capture and 2 the HDR scene target.
 * The node renderer encodes the canvas, so the finished display colour goes back as linear light.
 */
export const createSkyColorTail = (bindings: UniformBindings) => {
  const mode = bindScalar(bindings, "uColorOutputMode", 0) as TslNode;
  const toneWeight = bindScalar(bindings, "uColorToneMapper", 0) as TslNode;
  const gradeRain = bindScalar(bindings, "uColorGradeRain", 0) as TslNode;
  const vividBoost = bindScalar(bindings, "uColorVividBoost", 0) as TslNode;
  const exposure = bindComputed(bindings, () =>
    exposureForWeight(Number(bindings.source.uColorToneMapper?.value ?? 0))) as TslNode;
  const sceneTarget = mode.greaterThan(1.5);
  const linearCapture = mode.greaterThan(0.5).and(mode.lessThanEqual(1.5));

  const finishOutput = (display: TslNode): TslNode => sceneTarget.select(display,
    colorFinishDisplay(display, screenCoordinate.xy, gradeRain, vividBoost, toneWeight));

  /** COLOR_OUTPUT_GLSL colorOutput: linear radiance to the final pixel, then to node linear. */
  const output = (radiance: TslNode): TslNode => {
    const display = colorSrgbEncode(colorToneMap(radiance, exposure, toneWeight));
    return linearCapture.select(radiance.max(0), colorSrgbDecode(finishOutput(display)));
  };

  return { exposure, finishOutput, linearCapture, output, toneWeight };
};

export type SkyColorTail = ReturnType<typeof createSkyColorTail>;
