import { GLSL3, type IUniform,RawShaderMaterial } from "three";

import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import { COMMON_UNIFORMS_GLSL, FOG_OF_WAR_GLSL, HEADING_TURN_GLSL, LIGHTING_GLSL, NOISE_GLSL } from "../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import { WATER_FIELD_GLSL } from "../../render-common/water-field";
import { getDepthOnlyDefines, SUN_SHADOW_GLSL } from "./three-shadows";

/**
 * GPU skinned walk cycle: each vertex swings around its limb joint (rig.x = limb, rig.y = joint
 * height), then the unit is turned to its heading and placed. One instanced draw for all units,
 * the CPU only writes position, heading and walk phase.
 */
const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec3 color;
in vec2 rig;
in vec4 unitPose;
in vec4 unitStyle;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;

float limbSwing(float limb, float phase) {
  float swing = sin(phase);
  if (limb == 1.0) return swing * 0.6;
  if (limb == 2.0) return -swing * 0.6;
  if (limb == 3.0) return -swing * 0.5;
  if (limb == 4.0) return swing * 0.5;
  return 0.0;
}

${HEADING_TURN_GLSL}
void main() {
  float angle = limbSwing(rig.x, unitStyle.x);
  float c = cos(angle);
  float s = sin(angle);
  vec3 local = position - vec3(0.0, rig.y, 0.0);
  vec3 swung = vec3(local.x * c - local.y * s, local.x * s + local.y * c + rig.y, local.z);
  swung.y += abs(sin(unitStyle.x)) * 0.02;
  vec3 swungNormal = vec3(normal.x * c - normal.y * s, normal.x * s + normal.y * c, normal.z);
  vWorld = turn(swung, unitPose.w) + unitPose.xyz;
  vNormal = turn(swungNormal, unitPose.w);
  vColor = color * unitStyle.yzw;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}
${WATER_FIELD_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}

void main() {
  float fog = sampleWaterField(vWorld.xz).z;
  if (isHiddenByFog(fog, vWorld.xz)) discard;
#ifdef DEPTH_ONLY
  fragColor = vec4(1.0);
#else
  vec3 color = lightSurface(vColor, normalize(vNormal), sampleSunShadow(vWorld), 1.0, vWorld.xz);
  fragColor = vec4(finishSurface(applyFogOfWar(color, fog, vWorld.xz), vWorld), 1.0);
#endif
}
`;

export const createUnitMaterial = (uniforms: Record<string, IUniform>, depthOnly: boolean) =>
  new RawShaderMaterial({
    defines: getDepthOnlyDefines(depthOnly),
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    uniforms,
    vertexShader: VERTEX_GLSL
  });
