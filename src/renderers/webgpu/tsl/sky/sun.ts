import {
  clamp, dot, exp, float, Fn, fwidth, If, length, max, mix, smoothstep, sqrt, step, vec3
} from "three/tsl";

import {
  EXPLORATION_CLOUD_GLOW_LINEAR_PEAK,
  EXPLORATION_SUN,
  EXPLORATION_SUN_DISC_RADIUS
} from "../../../../render-common/atmosphere/exploration-sky-constants";
import { colorSrgbDecode, colorSrgbEncode, colorToneMap } from "../color-output";
import { bindScalar, bindVector, type UniformBindings } from "../uniform-bindings";
import type { SkyColorTail } from "./color-tail";
import { skyLightTangentOffset } from "./disc";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

/** GLSL sunDirectBeam: the direct beam through a cloud transmittance (fourth power). */
export const sunDirectBeam = Fn(([cloudTransmittance]: [TslNode]) =>
  clamp(cloudTransmittance, 0, 1).pow(EXPLORATION_SUN.cloudDirectPower));

/** GLSL sunPhase: unnormalized Henyey-Greenstein phase. */
export const sunPhase = Fn(([cosTheta, g]: [TslNode, TslNode]) => {
  const denominator = max(float(1).add(g.mul(g)).sub(g.mul(2).mul(cosTheta)), 0.0001);
  return float(1).sub(g.mul(g)).div(denominator.mul(sqrt(denominator)));
});

/** GLSL sunGlare: Gaussian core plus Lorentzian veil, in disc radii. */
export const sunGlare = Fn(([discRadii]: [TslNode]) => {
  const core = exp(discRadii.mul(discRadii).div(-EXPLORATION_SUN.glareCoreWidth));
  const veil = float(1).div(float(1)
    .add(discRadii.mul(discRadii).div(EXPLORATION_SUN.glareVeilWidth)));
  return core.mul(EXPLORATION_SUN.glareCore).add(veil.mul(EXPLORATION_SUN.glareVeil));
});

/** GLSL sunDiscProfile: limb-darkened disc with a feathered, anti-aliased edge. */
export const sunDiscProfile = Fn(([radial, forward]: [TslNode, TslNode]) => {
  const edgeWidth = max(fwidth(radial), 0.000012);
  const feather = max(edgeWidth, EXPLORATION_SUN_DISC_RADIUS * EXPLORATION_SUN.edgeFeather);
  const edge = forward.mul(float(1).sub(smoothstep(
    float(EXPLORATION_SUN_DISC_RADIUS).sub(feather),
    float(EXPLORATION_SUN_DISC_RADIUS).add(edgeWidth), radial)));
  const discRadii = radial.div(EXPLORATION_SUN_DISC_RADIUS).min(1);
  const mu = sqrt(max(float(1).sub(discRadii.mul(discRadii)), 0));
  return float(1).sub(float(EXPLORATION_SUN.limbDarkening).mul(float(1).sub(mu))).mul(edge);
});

export interface SunNodes {
  /** GLSL explorationCloudGlowRadiance: forward-scatter glow of cloud lit from behind. */
  cloudGlow: (direction: TslNode, lightDirection: TslNode, lowerTransmittance: TslNode,
    highOpacity: TslNode) => TslNode;
  radiance: (direction: TslNode, lightDirection: TslNode, localTransmittance: TslNode,
    sunDirectVisibility: TslNode) => TslNode;
  /** Final sky pixel after the sky tonemap, the additive sun shoulder and the capped cloud glow. */
  output: (skyRadiance: TslNode, sunRadiance: TslNode, glowRadiance: TslNode) => TslNode;
}

const maxChannel = (value: TslNode): TslNode => max(value.r, max(value.g, value.b));

/** TSL twin of EXPLORATION_SUN_GLSL: HDR sun disc, glare, aureole, cloud glow and the output. */
export const createSunNodes = (bindings: UniformBindings, colorTail: SkyColorTail): SunNodes => {
  const sunAureole = bindVector(bindings, "uSunAureole", 3) as TslNode;
  const sunDisc = bindVector(bindings, "uSunDisc", 3) as TslNode;
  const sunVisibility = bindScalar(bindings, "uSunVisibility", 1) as TslNode;

  const radiance = (direction: TslNode, lightDirection: TslNode, localTransmittance: TslNode,
    sunDirectVisibility: TslNode): TslNode => {
    const result = vec3(0).toVar();
    const aureolePeak = max(sunAureole.r, max(sunAureole.g, sunAureole.b));
    If(aureolePeak.greaterThan(0), () => {
      const cosTheta = dot(direction, lightDirection);
      const forward = step(0, cosTheta);
      const radial = length(skyLightTangentOffset(direction, lightDirection));
      const disc = sunDiscProfile(radial, forward).mul(sunDirectBeam(localTransmittance));
      const glare = sunGlare(radial.div(EXPLORATION_SUN_DISC_RADIUS)).mul(forward)
        .mul(sunVisibility).mul(sunDirectVisibility);
      const aureole = float(EXPLORATION_SUN.aureoleGain)
        .mul(sunPhase(cosTheta, EXPLORATION_SUN.aureoleAsymmetry))
        .mul(sunDirectVisibility)
        .mul(mix(localTransmittance, float(1), EXPLORATION_SUN.cloudForwardScatter));
      result.assign(sunDisc.mul(disc.add(glare)).add(sunAureole.mul(aureole)));
    });
    return result;
  };

  /**
   * Rims from the lower clouds (strongest at mid transmittance); the thin cirrus glows by its own
   * opacity only. Feeding the cirrus through the rim curve drew radial strokes (P17).
   */
  const cloudGlow = (direction: TslNode, lightDirection: TslNode, lowerTransmittance: TslNode,
    highOpacity: TslNode): TslNode => {
    const cosTheta = dot(direction, lightDirection);
    const rims = float(4).mul(lowerTransmittance).mul(float(1).sub(lowerTransmittance));
    return sunAureole.mul(EXPLORATION_SUN.cloudGlowGain)
      .mul(sunPhase(cosTheta, EXPLORATION_SUN.cloudGlowAsymmetry))
      .mul(rims.add(highOpacity.mul(lowerTransmittance)));
  };

  /**
   * GLSL explorationSunOutput: the tonemapped sky plus the photographic sun shoulder; the cloud
   * glow eases toward its own peak (hue kept), never clipped white.
   */
  const output = (skyRadiance: TslNode, sunRadiance: TslNode, glowRadiance: TslNode): TslNode => {
    const sky = colorToneMap(skyRadiance, colorTail.exposure, colorTail.toneWeight);
    const headroom = max(float(1).sub(sky), vec3(0.02));
    const sun = max(sunRadiance, 0).mul(colorTail.exposure);
    const knee = headroom.mul(EXPLORATION_SUN.highlightKnee);
    const lit = sky.add(headroom.mul(sun).div(sun.add(knee)));
    const glow = max(glowRadiance, 0).mul(colorTail.exposure);
    const glowRoom = max(float(EXPLORATION_CLOUD_GLOW_LINEAR_PEAK).sub(maxChannel(lit)), 0);
    const glowed = lit.add(glow.mul(glowRoom)
      .div(max(maxChannel(glow).add(glowRoom.mul(EXPLORATION_SUN.highlightKnee)), 0.0001)));
    const finished = colorTail.finishOutput(colorSrgbEncode(glowed));
    return colorTail.linearCapture.select(max(skyRadiance.add(sunRadiance).add(glowRadiance), 0),
      colorSrgbDecode(finished));
  };

  return { cloudGlow, output, radiance };
};
