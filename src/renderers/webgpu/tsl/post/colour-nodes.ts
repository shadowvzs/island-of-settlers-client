import type { IUniform } from "three";

import { exposureForWeight } from "../../../../render-common/color-output";
import { bindComputed, bindScalar, createUniformBindings, type UniformBindings } from "../uniform-bindings";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/** The shared colour-contract values every post pass reads (uColorToneMapper and friends). */
export interface PostColourNodes {
  /** `exposureForWeight(uColorToneMapper)`: the same fitted exposure the material tails apply. */
  exposure: TslNode;
  rain: TslNode;
  /** 0 Vivid/Neutral .. 1 Filmic/AgX. */
  toneWeight: TslNode;
  vivid: TslNode;
}

/** The scene light the bloom phase blend follows. */
export interface PostLightNodes {
  daylight: TslNode;
  /** 1 while Highlights/glare applies; the bloom is skipped at 0. */
  highlight: TslNode;
  /** Height (y) of the shared sun direction vector. */
  sunHeight: TslNode;
}

const readNumber = (uniforms: Record<string, IUniform>, name: string, fallback: number) => {
  const value = uniforms[name]?.value;
  return typeof value === "number" ? value : fallback;
};

/**
 * Binds the shared post values from the WebGL materials' uniform record. The record is the same
 * object every ported material syncs from, so the post chain sees the live time-of-day, tone and
 * grade values without a second copy.
 */
export const createPostNodes = (source: Record<string, IUniform> | undefined) => {
  const uniforms = source ?? {};
  const bindings: UniformBindings = createUniformBindings("tsl:post", uniforms);
  const toneWeight = bindScalar(bindings, "uColorToneMapper", 0);
  const exposure = bindComputed(bindings, () =>
    exposureForWeight(readNumber(uniforms, "uColorToneMapper", 0)));
  const colour: PostColourNodes = {
    exposure,
    rain: bindScalar(bindings, "uColorGradeRain", 0),
    toneWeight,
    vivid: bindScalar(bindings, "uColorVividBoost", 0)
  };
  const light: PostLightNodes = {
    daylight: bindScalar(bindings, "uDaylight", 1),
    highlight: bindComputed(bindings, () => readNumber(uniforms, "uHighlight", 1)),
    sunHeight: bindComputed(bindings, () => {
      const direction = uniforms.uSunDirection?.value as ArrayLike<number> | undefined;
      return typeof direction?.[1] === "number" ? direction[1] : 1;
    })
  };
  return { bindings, colour, light };
};
