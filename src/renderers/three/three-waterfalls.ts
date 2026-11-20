import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  GLSL3,
  Group,
  type IUniform,
  Mesh,
  NormalBlending,
  Points,
  RawShaderMaterial} from "three";

import { COLOR_OUTPUT_GLSL, SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import { WATERFALL_GLARE_GLSL, WATERFALL_GLSL } from "../../render-common/shaders/waterfall-glsl";
import type { WaterfallMeshData } from "../../render-common/water/waterfall-mesh";
import type { Waterfall } from "../../shared/world/world-data";
import { excludeFromAmbientOcclusion } from "./ambient-occlusion-exclusion";

/** Mist particles per fall: a base count plus more for taller and wider falls. */
const MIST_BASE = 18;
const MIST_PER_HEIGHT = 10;
const MIST_PER_WIDTH = 6;
const GOLDEN_RATIO = 0.618_034;
const SILVER_RATIO = 0.414_214;
/**
 * Mist puffs fade in between these view distances (world units), so a possessed camera at the
 * foot sees through the spray instead of into it; a puff never covers more than this share of
 * the screen height. Normal blending at this opacity: overlapping puffs converge on the mist
 * colour instead of adding up to clipped white (RC-0, owner 2026-11-13).
 */
const MIST_NEAR_FADE = [1.5, 5] as const;
const MIST_MAX_SCREEN = 0.12;
const MIST_OPACITY = 0.16;

const SHEET_VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec2 uv;
in vec4 extra;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec2 vUv;
out vec4 vExtra;

void main() {
  vWorld = position;
  vUv = uv;
  vExtra = extra;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const SHEET_FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec2 vUv;
in vec4 vExtra;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${WATERFALL_GLSL}

void main() {
  fragColor = shadeWaterfall(vUv, vExtra, vWorld);
}
`;

/**
 * Mist: every particle loops on its own phase, rising and drifting outwards from the foot of
 * its fall while it grows and fades (no CPU update). Puffs fade out close to the camera and
 * their sprites stay a small share of the screen, so a possessed view at the foot never looks
 * into a wall of spray (RC-0).
 */
const MIST_VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec4 seed;
in vec4 fall;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform vec2 uWind;
uniform vec2 uViewport;
out float vFade;
const vec2 MIST_NEAR_FADE = vec2(${MIST_NEAR_FADE[0].toFixed(1)}, ${MIST_NEAR_FADE[1].toFixed(1)});
const float MIST_MAX_SCREEN = ${MIST_MAX_SCREEN.toFixed(2)};

void main() {
  float life = fract(uTime * (0.22 + seed.z * 0.18) + seed.x);
  float angle = seed.y * 6.2832;
  float spread = fall.y * (0.35 + life * 0.9);
  vec3 drift = vec3(cos(angle) * spread, life * (0.5 + fall.x * 0.45), sin(angle) * spread);
  drift.xz += fall.zw * life * 0.6 + uWind * life * 0.4;
  vec4 view = viewMatrix * vec4(position + drift, 1.0);
  gl_Position = projectionMatrix * view;
  float size = (0.5 + seed.w * 0.6) * (0.6 + life * 0.9);
  float pixels = size * projectionMatrix[1][1] * uViewport.y * 0.5 / gl_Position.w;
  gl_PointSize = min(pixels, uViewport.y * MIST_MAX_SCREEN);
  float near = smoothstep(MIST_NEAR_FADE.x, MIST_NEAR_FADE.y, -view.z);
  vFade = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.45, 1.0, life)) * near;
}
`;

const MIST_FRAGMENT_GLSL = `
precision highp float;
in float vFade;
out vec4 fragColor;
uniform vec3 uSunColor;
uniform vec3 uAmbientSky;
${COLOR_OUTPUT_GLSL}
${WATERFALL_GLARE_GLSL}

void main() {
  vec2 centred = gl_PointCoord * 2.0 - 1.0;
  float puff = 1.0 - smoothstep(0.2, 1.0, dot(centred, centred));
  vec3 light = uSunColor * 0.45 + uAmbientSky * 0.55;
  vec3 mist = capFallGlare(colorOutputDisplayAuthored(light * 0.8));
  fragColor = vec4(mist, puff * vFade * ${MIST_OPACITY.toFixed(2)});
}
`;

const createSheetMesh = (data: WaterfallMeshData, uniforms: Record<string, IUniform>) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(data.uvs, 2));
  geometry.setAttribute("extra", new BufferAttribute(data.extra, 4));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  const material = new RawShaderMaterial({
    blending: NormalBlending,
    depthWrite: false,
    fragmentShader: SHEET_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    transparent: true,
    uniforms,
    vertexShader: SHEET_VERTEX_GLSL
  });
  excludeFromAmbientOcclusion(material);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
};

const getMistCount = (fall: Waterfall) =>
  Math.round(MIST_BASE + (fall.top - fall.bottom) * MIST_PER_HEIGHT + fall.width * MIST_PER_WIDTH);

/** Mist particles at the foot of every fall (attributes only; the shader animates them). */
const createMistPoints = (waterfalls: Waterfall[], uniforms: Record<string, IUniform>) => {
  const origins: number[] = [];
  const seeds: number[] = [];
  const falls: number[] = [];
  let particle = 0;
  for (const fall of waterfalls) {
    const footX = fall.x + fall.directionX * 0.5;
    const footZ = fall.z + fall.directionZ * 0.5;
    for (let index = 0; index < getMistCount(fall); index += 1) {
      particle += 1;
      origins.push(footX, fall.bottom + 0.1, footZ);
      seeds.push(
        (particle * GOLDEN_RATIO) % 1,
        (particle * SILVER_RATIO) % 1,
        (particle * 0.137) % 1,
        (particle * 0.291) % 1
      );
      falls.push(fall.top - fall.bottom, fall.width * 0.5, fall.directionX, fall.directionZ);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from(origins), 3));
  geometry.setAttribute("seed", new BufferAttribute(Float32Array.from(seeds), 4));
  geometry.setAttribute("fall", new BufferAttribute(Float32Array.from(falls), 4));
  const material = new RawShaderMaterial({
    blending: NormalBlending,
    depthWrite: false,
    fragmentShader: MIST_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    transparent: true,
    uniforms,
    vertexShader: MIST_VERTEX_GLSL
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return { count: particle, points };
};

/**
 * Waterfalls: the shared sheet and foam mesh (scrolling streak shader) plus rising
 * spray mist at every foot, in one group drawn after the opaque scene.
 */
export const createThreeWaterfalls = (
  data: WaterfallMeshData,
  waterfalls: Waterfall[],
  uniforms: Record<string, IUniform>
) => {
  const group = new Group();
  const mist = createMistPoints(waterfalls, uniforms);
  group.add(createSheetMesh(data, uniforms), mist.points);
  group.visible = waterfalls.length > 0;
  return { group, mistParticles: mist.count, triangles: data.triangles };
};
