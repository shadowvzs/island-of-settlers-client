/**
 * Volumetric clouds of the possessed sky (Medium/High) at half resolution: one march draw with a
 * per-pixel, per-frame jitter, then a temporal resolve that reprojects last frame's clouds by the
 * camera rotation (clouds are kilometres away; eye translation is negligible) and the wind drift,
 * clamps them to the current neighbourhood and blends with a frame-rate independent weight. The
 * sky pass upsamples the resolved texture. Three half-float targets (~12 MB at 1080p) live only
 * while the possessed sky renders clouds.
 */
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  GLSL3,
  HalfFloatType,
  type IUniform,
  LinearFilter,
  Matrix4,
  Mesh,
  NoBlending,
  RawShaderMaterial,
  Scene,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget
} from "three";

import {
  EXPLORATION_CLOUD,
  EXPLORATION_CLOUD_JITTER_HASH
} from "../../../render-common/atmosphere/exploration-sky-constants";
import { advanceCloudDrift, cloudHistoryWeight } from "./exploration-cloud-history";
import { EXPLORATION_CLOUD_RESOLVE_GLSL } from "./exploration-cloud-resolve-glsl";
import { EXPLORATION_CLOUD_GLSL } from "./exploration-sky-cloud-glsl";
import { EXPLORATION_CLOUD_UNIFORMS_GLSL, EXPLORATION_VIEW_RAY_GLSL } from "./exploration-sky-shader";

const RESOLUTION_SCALE = EXPLORATION_CLOUD.resolutionScale;

const FULLSCREEN_VERTEX_GLSL = `precision highp float;
in vec3 position;
out vec2 vScreen;
void main() {
  vScreen = position.xy;
  gl_Position = vec4(position, 1.0);
}
`;

export const EXPLORATION_CLOUD_MARCH_GLSL = `precision highp float;
in vec2 vScreen;
out vec4 fragColor;
uniform mat4 uInverseProjection;
uniform float uFrameIndex;
const float CLOUD_SHOULDER_START = ${EXPLORATION_CLOUD.shoulderStart.toFixed(2)};
const float CLOUD_SHOULDER_RANGE = ${EXPLORATION_CLOUD.shoulderRange.toFixed(2)};
${EXPLORATION_CLOUD_UNIFORMS_GLSL}
${EXPLORATION_VIEW_RAY_GLSL}
${EXPLORATION_CLOUD_GLSL}

/** White per-pixel, per-frame hash: no structured cross-hatch where the history is rejected. */
float pixelFrameHash(vec2 pixel, float frame) {
  uvec3 value = uvec3(uvec2(pixel), uint(frame));
  value = value * ${EXPLORATION_CLOUD_JITTER_HASH.multiplier}u + ${EXPLORATION_CLOUD_JITTER_HASH.increment}u;
  value.x += value.y * value.z;
  value.y += value.z * value.x;
  value.z += value.x * value.y;
  value ^= value >> 16u;
  value.x += value.y * value.z;
  return float(value.x & 0xffffffu) / 16777216.0;
}

void main() {
  vec3 rayOrigin;
  vec3 direction = explorationViewRay(vScreen, rayOrigin);
  float jitter = pixelFrameHash(gl_FragCoord.xy, uFrameIndex);
  vec4 cloud = explorationCloudMarch(direction, max(rayOrigin.y, 0.0), jitter);
  // The sky composites in display space: store premultiplied display colour and opacity. A soft
  // shoulder caps sunlit tops at ~0.85 display (owner 2026-11-10; just above the 0.8 daytime bloom threshold),
  // so the bloom does not halo every cloud and the glare slider keeps its meaning.
  vec3 color = pow(cloud.rgb / max(cloud.a, 0.0001), vec3(1.0 / 2.2));
  vec3 over = max(color - CLOUD_SHOULDER_START, 0.0);
  color = min(color, vec3(CLOUD_SHOULDER_START)) + over / (1.0 + over / CLOUD_SHOULDER_RANGE);
  fragColor = vec4(color * cloud.a, cloud.a);
}
`;

const createTarget = () => new WebGLRenderTarget(1, 1, {
  depthBuffer: false,
  magFilter: LinearFilter,
  minFilter: LinearFilter,
  type: HalfFloatType
});

const createFullscreenScene = (material: RawShaderMaterial) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  return { geometry, scene };
};

const createFullscreenMaterial = (fragmentShader: string, uniforms: Record<string, IUniform>) =>
  new RawShaderMaterial({
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    fragmentShader,
    glslVersion: GLSL3,
    uniforms,
    vertexShader: FULLSCREEN_VERTEX_GLSL
  });

/** Projection times the rotation-only view: maps a world direction to last frame's clip space. */
const writeRotationViewProjection = (camera: Camera, target: Matrix4) => {
  target.copy(camera.matrixWorldInverse);
  target.elements[12] = target.elements[13] = target.elements[14] = 0;
  return target.premultiply(camera.projectionMatrix);
};

export interface ExplorationCloudPass {
  dispose: () => void;
  /** Compiles both programs behind loading, not on the first possessed frame. */
  prepare: (renderer: WebGLRenderer, camera: Camera) => Promise<void>;
  /** Marches and resolves this frame's clouds; the sky reads `texture` afterwards. */
  render: (renderer: WebGLRenderer, camera: Camera) => void;
  stats: () => { targets: number };
  /** The resolved cloud texture (premultiplied display colour, opacity) for the sky pass. */
  texture: IUniform;
}

/** `skyUniforms` are the sky material's own uniforms: wind, cover and light stay shared references. */
export const createExplorationCloudPass = (skyUniforms: Record<string, IUniform>): ExplorationCloudPass => {
  const frameIndex: IUniform = { value: 0 };
  const current = createTarget();
  const histories = [createTarget(), createTarget()];
  const previousViewProjection = new Matrix4();
  const historyWeight: IUniform = { value: 0 };
  const previousDrift = new Float32Array(2);
  const driftDelta = new Float32Array(2);
  const historyTexture: IUniform = { value: null };
  const texture: IUniform = { value: null };
  const drawingSize = new Vector2();
  const march = createFullscreenMaterial(EXPLORATION_CLOUD_MARCH_GLSL, { ...skyUniforms, uFrameIndex: frameIndex });
  const resolve = createFullscreenMaterial(EXPLORATION_CLOUD_RESOLVE_GLSL, {
    uCameraWorld: skyUniforms.uCameraWorld!,
    uCloudDriftDelta: { value: driftDelta },
    uCurrent: { value: current.texture },
    uHistory: historyTexture,
    uHistoryWeight: historyWeight,
    uInverseProjection: skyUniforms.uInverseProjection!,
    uPreviousViewProjection: { value: previousViewProjection }
  });
  const marchScene = createFullscreenScene(march);
  const resolveScene = createFullscreenScene(resolve);
  let allocated = false;
  let lastRenderMs = -Infinity;
  let historyIndex = 0;

  /** Half of the current target (the scene target when the compositor is active) or canvas. */
  const readHalfSize = (renderer: WebGLRenderer) => {
    const destination = renderer.getRenderTarget();
    if (destination) drawingSize.set(destination.width, destination.height);
    else renderer.getDrawingBufferSize(drawingSize);
    drawingSize.set(Math.max(1, Math.ceil(drawingSize.x * RESOLUTION_SCALE)),
      Math.max(1, Math.ceil(drawingSize.y * RESOLUTION_SCALE)));
  };

  /**
   * Sizes a target that is written this frame. The history keeps its size until it is written
   * again: the resolve samples it by screen UV, so a dynamic-resolution step keeps the history.
   */
  const fit = (target: WebGLRenderTarget) => {
    if (target.width === drawingSize.x && target.height === drawingSize.y) return;
    target.setSize(drawingSize.x, drawingSize.y);
  };

  const render = (renderer: WebGLRenderer, camera: Camera) => {
    const destination = renderer.getRenderTarget();
    const now = performance.now();
    historyWeight.value = cloudHistoryWeight(now - lastRenderMs);
    lastRenderMs = now;
    advanceCloudDrift(skyUniforms.uCloudDrift!.value as ArrayLike<number>, previousDrift, driftDelta);
    frameIndex.value = ((frameIndex.value as number) + 1) % EXPLORATION_CLOUD_JITTER_HASH.frameWrap;
    const output = histories[historyIndex]!, history = histories[1 - historyIndex]!;
    readHalfSize(renderer);
    fit(current);
    fit(output);
    allocated = true;
    historyTexture.value = history.texture;
    try {
      renderer.setRenderTarget(current);
      renderer.render(marchScene.scene, camera);
      renderer.setRenderTarget(output);
      renderer.render(resolveScene.scene, camera);
    } finally {
      renderer.setRenderTarget(destination);
    }
    writeRotationViewProjection(camera, previousViewProjection);
    texture.value = output.texture;
    historyIndex = 1 - historyIndex;
  };

  return {
    dispose: () => {
      current.dispose();
      for (const history of histories) history.dispose();
      for (const part of [marchScene, resolveScene]) part.geometry.dispose();
      march.dispose();
      resolve.dispose();
      allocated = false;
      lastRenderMs = -Infinity;
      texture.value = null;
    },
    prepare: async (renderer, camera) => {
      await Promise.all([renderer.compileAsync(marchScene.scene, camera),
        renderer.compileAsync(resolveScene.scene, camera)]);
    },
    render,
    stats: () => ({ targets: allocated ? 3 : 0 }),
    texture
  };
};
