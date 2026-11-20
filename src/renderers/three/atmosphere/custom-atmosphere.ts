import type { IUniform, RawShaderMaterial, ShaderMaterial } from "three";

import { ATMOSPHERE_GLSL, ATMOSPHERE_UNIFORMS_GLSL } from "../../../render-common/atmosphere/atmosphere-glsl";
import { CONCEALMENT_GLSL, CONCEALMENT_UNIFORMS_GLSL } from "../../../render-common/atmosphere/concealment-glsl";
import { ATMOSPHERE_VIEW_LIMIT_GLSL } from "../../../render-common/atmosphere/view-limit-glsl";
import { AIR_COLOR_OUTPUT_GLSL } from "../../../render-common/shaders/color-output-glsl";

/**
 * Opt-in custom effects already provide their final, deformed world position. Their display-
 * authored colour then gets camera air and the shared colour output (tonemapper, grade, dither);
 * additive light is attenuated by the air instead of blended towards it.
 */
export const connectCustomAtmosphere = <T extends RawShaderMaterial | ShaderMaterial>(
  material: T,
  uniforms: Record<string, IUniform>,
  output = "gl_FragColor",
  additive = false
): T => {
  // Isolated previews keep their existing shaders and do not capture an island's uniforms.
  if (!uniforms.uAtmosphereProfile) return material;
  Object.assign(material.uniforms, uniforms);
  // The shared output brings its own tonemapper: Three must not add its chunk a second time.
  material.toneMapped = false;
  const original = material.fragmentShader.replace("void main()", "void atmosphereEffectMain()");
  const composite = `finishColor(${output}.rgb, tau)`;
  const attenuated = `colorOutput(colorSrgbDecode(${output}.rgb) * exp(-tau))`;
  material.fragmentShader = `
precision highp float;
${ATMOSPHERE_UNIFORMS_GLSL}
${CONCEALMENT_UNIFORMS_GLSL}
${ATMOSPHERE_GLSL}
${CONCEALMENT_GLSL}
${ATMOSPHERE_VIEW_LIMIT_GLSL}
${AIR_COLOR_OUTPUT_GLSL}
${original}
void main() {
  atmosphereEffectMain();
  float tau = 0.0;
  if (uAtmospherePass >= 0.5 && (uAtmosphereProfile.x > 0.0 || uExplorationFog >= 0.5)) {
    AtmosphereRay ray = atmosphereSurfaceRay(vWorld);
    tau = atmosphereOpticalDepth(ray) + concealmentOpticalDepth(ray)
      + atmosphereViewLimitOpticalDepth(vWorld);
  }
  ${output}.rgb = ${additive ? attenuated : composite};
}`;
  return material;
};
