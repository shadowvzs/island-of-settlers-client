import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  ClampToEdgeWrapping,
  GLSL3,
  HalfFloatType,
  type IUniform,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RawShaderMaterial,
  RGFormat,
  Scene,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget
} from "three";

import { AO_TRIANGLE_VERTEX_GLSL } from "../../render-common/shaders/frame-ao-glsl";
import {
  createGodRayMarchFragmentGlsl,
  GOD_RAY_BLUR_FRAGMENT_GLSL
} from "../../render-common/shaders/frame-god-rays-glsl";
import {
  createVolumetricLightTuning,
  type VolumetricLightTuning,
  volumetricLightStrength
} from "../../render-common/volumetric-light";
import { ambientOcclusionSize } from "./frame-ao";
import { SUN_SHADOW_GLSL, SUN_SHADOW_UNIFORM_NAMES } from "./sun-shadow-glsl";

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
/** Idle frames (strategic view, night, overcast) after which the targets give their memory back. */
const RELEASE_IDLE_FRAMES = 600;

/** The shared shading values the pass reads besides the shadow map (fades, sun, R06a colour). */
const SCENE_UNIFORM_NAMES = [
  "uAtmosphereSunTint",
  "uCloudCover",
  "uDaylight",
  "uExplorationFog",
  "uRain",
  "uSunDirection"
] as const;

type ActiveSwitch = (active?: boolean) => boolean;

declare global {
  interface Window {
    /**
     * Development only: `__godRays(false)` skips the R06c sun shafts from the next frame,
     * `__godRays()` reads whether they may run (same-frame A/B captures).
     */
    __godRays?: ActiveSwitch;
    /** Development only: live R06c tuning, `__godRaysTuning({ intensity: 0.1 })`; returns the values. */
    __godRaysTuning?: (patch?: Partial<VolumetricLightTuning>) => VolumetricLightTuning;
  }
}

export interface FrameGodRays {
  dispose: () => void;
  /** The linear output pass's uniforms (FRAME_GOD_RAYS_APPLY_GLSL); `prepare` and `render` fill them. */
  outputUniforms: Record<string, IUniform>;
  /**
   * The frame's strength from the shared uniforms (possession, sun, weather); true when the pass
   * runs this frame. False zeroes the output colour, so the output pass skips every fetch.
   */
  prepare: () => boolean;
  /** March, then the two blur axes, at half resolution from the resolved depth. */
  render: (depth: Texture, camera: Camera) => void;
  resize: (width: number, height: number) => void;
  /** 1 when the pass ran on the last prepared frame. */
  stats: () => number;
}

/** RG16F (in-scattered light, view depth), nearest sampled; GPU storage only once rendered into. */
const createHalfTarget = () => {
  const target = new WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    format: RGFormat,
    generateMipmaps: false,
    magFilter: NearestFilter,
    minFilter: NearestFilter,
    type: HalfFloatType
  });
  target.texture.wrapS = ClampToEdgeWrapping;
  target.texture.wrapT = ClampToEdgeWrapping;
  return target;
};

const createPassMaterial = (fragmentShader: string, uniforms: Record<string, IUniform>) => new RawShaderMaterial({
  depthTest: false,
  depthWrite: false,
  fragmentShader,
  glslVersion: GLSL3,
  uniforms,
  vertexShader: AO_TRIANGLE_VERTEX_GLSL
});

const numberOf = (uniform: IUniform | undefined) => (uniform?.value as number | undefined) ?? 0;

/** Development console switch and live tuning; returns their remover. */
const exposeDevHooks = (setActive: ActiveSwitch, tuning: VolumetricLightTuning) => {
  if (!import.meta.env.DEV || typeof window === "undefined") return () => {};
  const tune = (patch?: Partial<VolumetricLightTuning>) => Object.assign(tuning, patch ?? {});
  window.__godRays = setActive;
  window.__godRaysTuning = tune;
  return () => {
    if (window.__godRays === setActive) delete window.__godRays;
    if (window.__godRaysTuning === tune) delete window.__godRaysTuning;
  };
};

/**
 * R06c: half-resolution volumetric sun shafts of the possessed view. The march reads the frame's
 * resolved depth and the shared sun shadow map (`shading`, the renderer's uniforms), the blur
 * removes its jitter and the compositor's linear output pass adds it before tonemapping in the
 * R06a sun lobe colour. Null without half-float colour buffers or without the sun shadow map.
 * The targets are allocated on the first frame that runs and released after a long idle spell.
 * `strength` is the Sun rays slider (1 = the R06c intensity); 0 never gets here (no pass at all).
 */
export const createFrameGodRays = (
  renderer: WebGLRenderer,
  shading: Record<string, IUniform>,
  { height, strength = 1, width }: { height: number; strength?: number; width: number }
): FrameGodRays | null => {
  if (!renderer.extensions.has("EXT_color_buffer_float")) return null;
  const names = [...SUN_SHADOW_UNIFORM_NAMES, ...SCENE_UNIFORM_NAMES];
  if (names.some(name => !shading[name])) return null;
  const tuning = createVolumetricLightTuning(strength);
  const marched = createHalfTarget();
  const blurredAlongX = createHalfTarget();
  const targets = [marched, blurredAlongX];
  const shadowUniforms = Object.fromEntries(SUN_SHADOW_UNIFORM_NAMES.map(name => [name, shading[name]!]));
  const march = createPassMaterial(createGodRayMarchFragmentGlsl(SUN_SHADOW_GLSL), {
    ...shadowUniforms,
    uDepth: { value: null },
    uGodRayClipToWorld: { value: new Matrix4() },
    uGodRayDepthToView: { value: new Vector4(0, -1, 0, 1) },
    uGodRayEye: { value: new Vector3() },
    uGodRayFullSize: { value: new Vector2(width, height) },
    uGodRayMedium: { value: new Vector4() },
    uGodRayPivot: { value: 0 },
    uGodRaySun: { value: new Vector3(0, 1, 0) }
  });
  const blur = createPassMaterial(GOD_RAY_BLUR_FRAGMENT_GLSL, {
    uGodRayAxis: { value: [1, 0] },
    uGodRayTolerance: { value: new Vector2() },
    uGodRays: { value: null }
  });
  const outputUniforms: Record<string, IUniform> = {
    uGodRayApplyDepthToView: march.uniforms.uGodRayDepthToView!,
    uGodRayApplyTolerance: { value: new Vector2() },
    uGodRayColor: { value: new Vector3() },
    uGodRayDepth: { value: null },
    uGodRayTexture: { value: marched.texture }
  };
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(FULLSCREEN_TRIANGLE, 3));
  const mesh = new Mesh(geometry, march);
  mesh.frustumCulled = false;
  const scene = new Scene().add(mesh);
  const quadCamera = new OrthographicCamera();
  const fullSize: Vector2 = march.uniforms.uGodRayFullSize!.value;
  const color: Vector3 = outputUniforms.uGodRayColor!.value;
  let active = true;
  let running = false;
  let idleFrames = 0;
  let allocated = false;

  const draw = (material: RawShaderMaterial, destination: WebGLRenderTarget) => {
    mesh.material = material;
    renderer.setRenderTarget(destination);
    renderer.render(scene, quadCamera);
  };

  const blurAlong = (axis: readonly [number, number], source: WebGLRenderTarget, destination: WebGLRenderTarget) => {
    blur.uniforms.uGodRays!.value = source.texture;
    blur.uniforms.uGodRayAxis!.value = axis;
    draw(blur, destination);
  };

  const resize = (nextWidth: number, nextHeight: number) => {
    fullSize.set(nextWidth, nextHeight);
    if (!allocated) return;
    const [halfWidth, halfHeight] = ambientOcclusionSize(nextWidth, nextHeight);
    for (const target of targets) target.setSize(halfWidth, halfHeight);
  };

  const allocate = () => {
    if (allocated) return;
    allocated = true;
    resize(fullSize.x, fullSize.y);
  };

  const releaseWhenIdle = () => {
    idleFrames++;
    if (!allocated || idleFrames < RELEASE_IDLE_FRAMES) return;
    for (const target of targets) {
      target.dispose();
      target.setSize(1, 1);
    }
    allocated = false;
  };

  const readStrength = () => volumetricLightStrength({
    cloudCover: numberOf(shading.uCloudCover),
    daylight: numberOf(shading.uDaylight),
    possession: numberOf(shading.uExplorationFog),
    rain: numberOf(shading.uRain),
    shadowWeight: numberOf(shading.uSunShadows) > 0.5 ? numberOf(shading.uSunShadowWeight) : 0,
    sunHeight: (shading.uSunDirection!.value as ArrayLike<number>)[1] ?? 0
  }, tuning.noonShare);

  /** The R06a sun lobe colour (linear, at the airlight's luminance) × strength × intensity. */
  const updateColor = (strength: number) => {
    const tint = shading.uAtmosphereSunTint!.value as ArrayLike<number>;
    const scale = strength * tuning.intensity;
    color.set(tint[0]! * scale, tint[1]! * scale, tint[2]! * scale);
  };

  const updateView = (camera: Camera) => {
    const { uniforms } = march;
    (uniforms.uGodRayClipToWorld!.value as Matrix4)
      .multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    (uniforms.uGodRayEye!.value as Vector3).setFromMatrixPosition(camera.matrixWorld);
    const inverse = camera.projectionMatrixInverse.elements;
    (uniforms.uGodRayDepthToView!.value as Vector4).set(inverse[10]!, inverse[14]!, inverse[11]!, inverse[15]!);
    const sun = shading.uSunDirection!.value as ArrayLike<number>;
    (uniforms.uGodRaySun!.value as Vector3).set(sun[0]!, sun[1]!, sun[2]!).normalize();
    const lobeG = (shading.uAtmosphereSunTint!.value as ArrayLike<number>)[3] ?? 0;
    (uniforms.uGodRayMedium!.value as Vector4).set(tuning.maxDistance, tuning.extinction, lobeG, tuning.lobeShare);
    uniforms.uGodRayPivot!.value = tuning.pivot;
    const { absolute, relative } = tuning.tolerance;
    (blur.uniforms.uGodRayTolerance!.value as Vector2).set(absolute, relative);
    (outputUniforms.uGodRayApplyTolerance!.value as Vector2).set(absolute, relative);
  };

  const removeDevHooks = exposeDevHooks(next => {
    if (next !== undefined) active = next;
    return active;
  }, tuning);

  return {
    dispose: () => {
      removeDevHooks();
      for (const target of targets) target.dispose();
      geometry.dispose();
      march.dispose();
      blur.dispose();
    },
    outputUniforms,
    prepare: () => {
      const strength = active ? readStrength() : 0;
      running = strength > 0;
      updateColor(strength);
      if (running) idleFrames = 0;
      else releaseWhenIdle();
      return running;
    },
    render: (depth, camera) => {
      if (!running) return;
      allocate();
      updateView(camera);
      march.uniforms.uDepth!.value = depth;
      outputUniforms.uGodRayDepth!.value = depth;
      draw(march, marched);
      blurAlong([1, 0], marched, blurredAlongX);
      blurAlong([0, 1], blurredAlongX, marched);
    },
    resize,
    stats: () => running ? 1 : 0
  };
};
