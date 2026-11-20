import { GLSL3, type IUniform,RawShaderMaterial, Vector3 } from "three";

import { DEFAULT_PLAYER_COLOR } from "../../../render-common/settlement/player-color";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../../render-common/shaders/prop-glsl";
import { getDepthOnlyDefines, SUN_SHADOW_GLSL } from "../three-shadows";

const VERTEX = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec3 color;
in float playerTint;
in mat4 instanceMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vPlayerTint;
void main() {
  vWorld = (instanceMatrix * vec4(position, 1.0)).xyz;
  vNormal = mat3(instanceMatrix) * normal;
  vColor = color;
  vPlayerTint = playerTint;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vPlayerTint;
uniform vec3 uPlayerColor;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
void main() {
  float fog = sampleLiveFog(1.0, vWorld.xz);
  if (isHiddenByFog(fog, vWorld.xz)) discard;
#ifdef DEPTH_ONLY
  fragColor = vec4(1.0);
#else
  vec3 albedo = mix(vColor, uPlayerColor, vPlayerTint);
#ifdef STONE_DETAIL
  float grit = valueNoise(vWorld.xz * 91.0 + vWorld.y * vec2(33.0, 57.0));
  float patches = valueNoise(vWorld.xz * 12.0 + vWorld.y * 17.0);
  albedo *= 0.88 + grit * 0.17 + patches * 0.08;
#endif
  vec3 lit = lightSurface(albedo, normalize(vNormal), sampleSunShadow(vWorld), 0.94, vWorld.xz);
  fragColor = vec4(finishSurface(applyFogOfWar(lit, fog, vWorld.xz), vWorld), 1.0);
#endif
}
`;

export const createTerritoryMarkerMaterial = (
  uniforms: Record<string, IUniform>,
  detailed: boolean,
  depthOnly = false
) =>
  new RawShaderMaterial({
    defines: { ...getDepthOnlyDefines(depthOnly), ...(detailed ? { STONE_DETAIL: "1" } : {}) },
    userData: { territoryMarker: true },
    fragmentShader: FRAGMENT,
    glslVersion: GLSL3,
    uniforms: { ...uniforms, uPlayerColor: { value: new Vector3(...DEFAULT_PLAYER_COLOR) } },
    vertexShader: VERTEX
  });
