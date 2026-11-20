import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  DepthFormat,
  DepthStencilFormat,
  DepthTexture,
  GLSL3,
  HalfFloatType,
  type IUniform,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RawShaderMaterial,
  Scene,
  SRGBColorSpace,
  type Texture,
  type TextureDataType,
  UnsignedByteType,
  UnsignedInt248Type,
  UnsignedIntType,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget
} from "three";

import {
  type BloomRuntimeTuning,
  createBloomFrameValues,
  createBloomRuntimeTuning,
  resolveBloomFrame
} from "../../render-common/bloom-phases";
import { COLOR_OUTPUT_MODE, type ColorOutputMode } from "../../render-common/color-output";
import { markRenderPass } from "../../render-common/frame-profiler";
import { NEUTRAL_HIGHLIGHTS } from "../../render-common/highlights";
import type {
  AmbientOcclusion,
  BloomQuality,
  ExposureMode,
  SceneTarget,
  VolumetricLight,
  WaterReflections
} from "../../render-common/quality";
import { BLOOM_TUNING } from "../../render-common/shaders/frame-bloom-glsl";
import {
  FRAME_COPY_FRAGMENT_GLSL,
  FRAME_OUTPUT_FRAGMENT_GLSL,
  FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL,
  FRAME_TRIANGLE_VERTEX_GLSL
} from "../../render-common/shaders/frame-output-glsl";
import type { WaterReflectionTuning } from "../../render-common/shaders/frame-water-reflection-glsl";
import { type AmbientOcclusionRuntimeTuning, createFrameAmbientOcclusion } from "./frame-ao";
import { createFrameBloom } from "./frame-bloom";
import { createEyeAdaptationControl } from "./frame-eye-adaptation";
import { createFrameGodRays } from "./frame-god-rays";
import { createFrameWaterReflection, type ReflectiveWater } from "./frame-water-reflection";

/** MSAA samples of the scene target: the antialiased canvas it replaces has 4 in Chrome. */
const SCENE_SAMPLES = 4;
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
const RGBA8 = 0x8058;
const RGBA16F = 0x881a;

type SceneFormat = Exclude<SceneTarget, "off">;

interface SceneFormatSpec {
  /** The target holds final canvas pixels: the resolve blits straight into the canvas. */
  blitsToCanvas: boolean;
  /** Renderbuffer internal format; the resolved texture's type must match it for the blit. */
  internalFormat: number;
  /** What the materials write during the scene pass. */
  mode: ColorOutputMode;
  outputFragment: string;
  /** Float colour buffers need EXT_color_buffer_float. */
  requiresFloat: boolean;
  /** The target holds the graded display pixel too: the linear pass undoes the grade first. */
  sceneGraded: boolean;
  type: TextureDataType;
}

/**
 * rgba8: every material's final display pixel, exactly what the canvas held; the single resolve
 * blits into the canvas (the resolve an antialiased canvas did anyway), a copy pass only as fallback.
 * rgba16f: the tonemapped colour before the grade with HDR headroom (graded output pass).
 */
const SCENE_FORMATS: Readonly<Record<SceneFormat, SceneFormatSpec>> = {
  rgba16f: { blitsToCanvas: false, internalFormat: RGBA16F, mode: COLOR_OUTPUT_MODE.scene,
    outputFragment: FRAME_OUTPUT_FRAGMENT_GLSL, requiresFloat: true, sceneGraded: false, type: HalfFloatType },
  rgba8: { blitsToCanvas: true, internalFormat: RGBA8, mode: COLOR_OUTPUT_MODE.display,
    outputFragment: FRAME_COPY_FRAGMENT_GLSL, requiresFloat: false, sceneGraded: true, type: UnsignedByteType }
};

export interface FrameCompositorOptions {
  /** R12b half-resolution GTAO: "off" creates no pass, no target and no stencil bits; "soft" and
   * "strong" pick the tuning (AO_LEVEL_TUNING). */
  ambientOcclusion: AmbientOcclusion;
  antialias: boolean;
  /** HDR bloom level (R11b): "off" draws no extra pass. */
  bloom: BloomQuality;
  /** R11c possessed auto-exposure: "fixed" creates no pass; the strategic view is fixed either way. */
  exposureMode?: ExposureMode;
  /** The Auto-exposure slider (0..1, default 1): how strongly the possessed eye adapts. */
  exposureStrength?: number;
  format: SceneFormat;
  /** R06c possessed sun shafts: "off" creates no pass, no target and no depth resolve for them. */
  volumetricLight?: VolumetricLight;
  /** The Sun rays slider (0..2, default 1): scales the shaft intensity. */
  volumetricLightStrength?: number;
  /**
   * R18b half-resolution screen-space water reflections: "off" creates no pass, no target and no
   * depth resolve for them.
   */
  waterReflections?: WaterReflections;
  /** Winter palette of the water shader (the reflection pass shares its surface functions). */
  winter?: boolean;
  /** The scene builds ice floes: the reflection mirrors their low walls from the calm waterline. */
  iceFloes?: boolean;
}

/** Three r186 API for an externally managed framebuffer (WebXR uses it); missing from its types. */
interface ExternalFramebufferRenderer {
  setRenderTargetFramebuffer: (target: WebGLRenderTarget, framebuffer?: WebGLFramebuffer) => void;
}

export interface FrameCompositorStats {
  /** 1 when the R12b ambient occlusion passes run this frame. */
  ambientOcclusion: number;
  /** Bloom mip levels running this frame (0: no bloom pass). */
  bloom: number;
  /** 1 while the possessed eye's adapted exposure (R11c) applies. */
  exposure: number;
  /** 1 when the linear output pass (R11a) draws this frame instead of the plain output/canvas blit. */
  linearOutput: number;
  sceneSamples: number;
  sceneTarget: string;
  /** 1 when the R06c sun shafts ran this frame. */
  volumetricLight: number;
  /** 1 when the R18b water reflection pass may run this frame (water in view decides the rest). */
  waterReflections: number;
}

/**
 * R10: one MSAA scene target for every world layer of the frame, one resolve and one output pass to
 * the canvas (SCENE_FORMATS). Materials keep tonemapping per fragment before the resolve, so MSAA
 * edges and blending match the canvas exactly. Later passes (R11 bloom and exposure, R12 GTAO, R13
 * upscaling) hook in between `resolve` and the output pass.
 */
export interface FrameCompositor {
  /** Binds and clears the scene target and switches every shader to the format's output mode. */
  beginScene: () => void;
  dispose: () => void;
  /**
   * The single MSAA resolve, into the canvas (rgba8) or through the output pass; `camera` is the
   * frame's view (the ambient occlusion rebuilds view positions from its projection).
   */
  finish: (camera: Camera) => void;
  resize: (width: number, height: number) => void;
  /** R12b: runs (true) or skips (false) the ambient occlusion from the next frame (A/B captures). */
  setAmbientOcclusion: (active: boolean) => void;
  /**
   * R11b: enables or drops the bloom chain for the next frame (a development A/B and the quality
   * gate); bloom implies the linear output pass because it is added in linear radiance.
   */
  setBloom: (active: boolean) => void;
  /**
   * R11c: the possessed weight of the coming frames (0 strategic/cinematic: fixed exposure, no
   * pass). A weight above 0 adapts the exposure and draws the linear output pass.
   */
  setEyeAdaptation: (weight: number) => void;
  /**
   * R11a: draws the linear output pass, so post passes can read linear radiance; a material switch
   * on the next finish, no per-frame recompile and no visible change while intensity stays 0.
   */
  setLinearOutput: (active: boolean) => void;
  /** R18b: the water surface the reflection pass redraws (null: none, the pass skips). */
  setReflectiveWater: (water: ReflectiveWater | null) => void;
  /** R18b: runs (true) or skips (false) the water reflections from the next frame (A/B captures). */
  setWaterReflections: (active: boolean) => void;
  stats: () => FrameCompositorStats;
  /**
   * The frame's resolved depth for post passes (R12 GTAO, contact shadows, god rays), created on
   * the first call and resolved into from then on; no texture, no depth blit and no extra cost
   * while no consumer asks for it. A depth consumer resolves through the resolved target even in
   * rgba8, where the plain frame would blit straight into the canvas.
   */
  useDepth: () => DepthTexture;
}

type ActiveSwitch = (active?: boolean) => boolean;

declare global {
  interface Window {
    /**
     * Development only: `__ao(false)` skips the R12b ambient occlusion from the next frame, `__ao()`
     * reads whether it runs (same-frame A/B captures); needs the AO compositor.
     */
    __ao?: ActiveSwitch;
    /** Development only: live AO tuning, `view: 1` shows the occlusion alone (exposeTuningDevHook). */
    __aoTuning?: (patch?: Partial<AmbientOcclusionRuntimeTuning>) => AmbientOcclusionRuntimeTuning;
    /**
     * Development only: `__bloom(false)` drops the R11b bloom chain for the next frame, `__bloom()`
     * reads whether it runs (same-frame A/B captures); needs the scene target active.
     */
    __bloom?: ActiveSwitch;
    /** Development only: live bloom tuning (exposeTuningDevHook). */
    __bloomTuning?: (patch?: Partial<BloomRuntimeTuning>) => BloomRuntimeTuning;
    /**
     * Development only: `__linearOutput(true)` forces the R11a linear output pass, `__linearOutput()`
     * reads (same-frame A/B captures); needs the scene target active.
     */
    __linearOutput?: ActiveSwitch;
    /**
     * Development only: `__sceneTarget(false)` draws straight to the canvas, `__sceneTarget(true)`
     * through the scene target again, `__sceneTarget()` reads (same-frame A/B captures).
     */
    __sceneTarget?: ActiveSwitch;
    /** Development only: live R18b reflection tuning, `debugView: 1` shows the mirror share (exposeTuningDevHook). */
    __ssrTuning?: (patch?: Partial<WaterReflectionTuning>) => WaterReflectionTuning;
    /**
     * Development only: `__ssr(false)` skips the R18b water reflections from the next frame, `__ssr()`
     * reads whether they run (same-frame A/B captures); needs the reflection pass.
     */
    __ssr?: ActiveSwitch;
  }
}

const exposeDevSwitch = (
  key: "__ao" | "__bloom" | "__linearOutput" | "__sceneTarget" | "__ssr", set: ActiveSwitch
): (() => void) => {
  if (!import.meta.env.DEV || typeof window === "undefined") return () => {};
  window[key] = set;
  return () => {
    if (window[key] === set) delete window[key];
  };
};

/** Development console switch of the scene target; returns its remover. */
export const exposeFrameCompositorDevHook = (setActive: ActiveSwitch) =>
  exposeDevSwitch("__sceneTarget", setActive);

/** Development console switch of the linear output pass (R11a A/B); returns its remover. */
export const exposeLinearOutputDevHook = (setLinear: ActiveSwitch) =>
  exposeDevSwitch("__linearOutput", setLinear);

/** Development console switch of the bloom chain (R11b A/B); returns its remover. */
export const exposeBloomDevHook = (setBloom: ActiveSwitch) =>
  exposeDevSwitch("__bloom", setBloom);

/** Development console switch of the ambient occlusion (R12b A/B); returns its remover. */
export const exposeAmbientOcclusionDevHook = (setActive: ActiveSwitch) =>
  exposeDevSwitch("__ao", setActive);

/** Development console switch of the water reflections (R18b A/B); returns its remover. */
export const exposeWaterReflectionDevHook = (setActive: ActiveSwitch) =>
  exposeDevSwitch("__ssr", setActive);

type TuningHookKey = "__aoTuning" | "__bloomTuning" | "__ssrTuning";

/**
 * Development only: `window[key]({ ... })` overrides the given live values from the next frame,
 * `window[key]()` reads them (`__aoTuning`, `__bloomTuning`, `__ssrTuning`). Returns its remover.
 */
const exposeTuningDevHook = <T extends object>(key: TuningHookKey, tuning: T): (() => void) => {
  if (!import.meta.env.DEV || typeof window === "undefined") return () => {};
  const hook = (patch?: Partial<T>) => Object.assign(tuning, patch ?? {});
  (window as unknown as Record<TuningHookKey, unknown>)[key] = hook;
  return () => {
    const hooks = window as unknown as Record<TuningHookKey, unknown>;
    if (hooks[key] === hook) delete hooks[key];
  };
};

/** The scene light the bloom phases follow: shared daylight and the sun vector's height. */
const bloomLight = { daylight: 1, sunHeight: 1 };
const readBloomLight = (uniforms: Record<string, IUniform>) => {
  bloomLight.daylight = (uniforms.uDaylight?.value as number | undefined) ?? 1;
  bloomLight.sunHeight = (uniforms.uSunDirection?.value as ArrayLike<number> | undefined)?.[1] ?? 1;
  return bloomLight;
};

interface SceneBuffers {
  color: WebGLRenderbuffer;
  depth: WebGLRenderbuffer;
  /** DEPTH24_STENCIL8 when the AO mask needs stencil bits, DEPTH_COMPONENT24 otherwise. */
  depthFormat: number;
  format: number;
  framebuffer: WebGLFramebuffer;
}

/** The colour and (when a consumer asked for it) depth bits of the single resolve blit. */
const resolveMask = (gl: WebGL2RenderingContext, withDepth: boolean) =>
  withDepth ? gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT : gl.COLOR_BUFFER_BIT;

/** The largest supported sample count of `format` not above `wanted` (0 without antialiasing). */
const pickSamples = (gl: WebGL2RenderingContext, format: number, wanted: number) => {
  if (wanted <= 0) return 0;
  const supported = gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES) as
    Int32Array | null;
  return Array.from(supported ?? []).filter(count => count <= wanted)
    .reduce((best, count) => Math.max(best, count), 0);
};

const storeRenderbuffer = (
  gl: WebGL2RenderingContext, buffer: WebGLRenderbuffer, samples: number, format: number, size: Vector2
) => {
  gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, size.x, size.y);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
};

const storeSceneBuffers = (gl: WebGL2RenderingContext, buffers: SceneBuffers, samples: number, size: Vector2) => {
  storeRenderbuffer(gl, buffers.color, samples, buffers.format, size);
  storeRenderbuffer(gl, buffers.depth, samples, buffers.depthFormat, size);
};

const deleteSceneBuffers = (gl: WebGL2RenderingContext, buffers: SceneBuffers) => {
  gl.deleteFramebuffer(buffers.framebuffer);
  gl.deleteRenderbuffer(buffers.color);
  gl.deleteRenderbuffer(buffers.depth);
};

/** Raw MSAA buffers: Three never resolves a target it does not own, so N layers cost one resolve. */
const createSceneBuffers = (
  renderer: WebGLRenderer, format: number, samples: number, size: Vector2, stencil: boolean
): SceneBuffers | null => {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const buffers = {
    color: gl.createRenderbuffer(),
    depth: gl.createRenderbuffer(),
    depthFormat: stencil ? gl.DEPTH24_STENCIL8 : gl.DEPTH_COMPONENT24,
    format,
    framebuffer: gl.createFramebuffer()
  };
  storeSceneBuffers(gl, buffers, samples, size);
  renderer.state.bindFramebuffer(gl.FRAMEBUFFER, buffers.framebuffer);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, buffers.color);
  const depthAttachment = stencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, depthAttachment, gl.RENDERBUFFER, buffers.depth);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  renderer.state.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (complete) return buffers;
  deleteSceneBuffers(gl, buffers);
  return null;
};

/**
 * The scene target as Three sees it: flagged like the canvas (screen programs with TONE_MAPPING
 * and sRGB output, display clear colour), so no program differs from the direct path. It owns no
 * GL objects: its framebuffer is the raw MSAA one, and it is never resized or disposed by Three.
 */
const createSceneTarget = (
  renderer: WebGLRenderer, framebuffer: WebGLFramebuffer, size: Vector2, type: TextureDataType
) => {
  const target = new WebGLRenderTarget(size.x, size.y, { depthBuffer: true, type });
  (target as WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  target.texture.colorSpace = SRGBColorSpace;
  (renderer as unknown as ExternalFramebufferRenderer).setRenderTargetFramebuffer(target, framebuffer);
  return target;
};

interface OutputPass {
  camera: OrthographicCamera;
  material: RawShaderMaterial;
  mesh: Mesh;
  scene: Scene;
}

interface OutputPassOptions {
  defines?: Record<string, number>;
  /** Pass-specific uniforms (the linear pass's bloom slot until R11b fills it). */
  extraUniforms?: Record<string, IUniform>;
  fragment: string;
}

const createOutputPass = (
  uniforms: Record<string, IUniform>, scene: WebGLRenderTarget, options: OutputPassOptions
): OutputPass => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(FULLSCREEN_TRIANGLE, 3));
  const material = new RawShaderMaterial({
    defines: options.defines ?? {},
    depthTest: false,
    depthWrite: false,
    fragmentShader: options.fragment,
    glslVersion: GLSL3,
    uniforms: {
      ...options.extraUniforms,
      uColorGradeRain: uniforms.uColorGradeRain!,
      uColorToneMapper: uniforms.uColorToneMapper!,
      uColorVividBoost: uniforms.uColorVividBoost!,
      uScene: { value: scene.texture }
    },
    vertexShader: FRAME_TRIANGLE_VERTEX_GLSL
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { camera: new OrthographicCamera(), material, mesh, scene: new Scene().add(mesh) };
};

/** The two output passes over the resolved texture and the bloom slot of the linear one. */
interface OutputStage {
  linear: OutputPass;
  plain: OutputPass;
  resolved: WebGLRenderTarget;
}

const framebufferOf = (renderer: WebGLRenderer, target: WebGLRenderTarget) => {
  renderer.initRenderTarget(target);
  return (renderer.properties.get(target) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer
    ?? null;
};

/**
 * The frame compositor of a WebGL2 context, or null (no float colour buffers for rgba16f, or an
 * incomplete MSAA framebuffer): the renderer then keeps its direct canvas path.
 */
export const createFrameCompositor = (
  renderer: WebGLRenderer,
  uniforms: Record<string, IUniform>,
  {
    ambientOcclusion: aoQuality, antialias, bloom: bloomQuality, exposureMode = "fixed", exposureStrength,
    format, iceFloes = false, volumetricLight = "off", volumetricLightStrength,
    waterReflections = "off", winter = false
  }: FrameCompositorOptions
): FrameCompositor | null => {
  const spec = SCENE_FORMATS[format];
  const outputMode = uniforms.uColorOutputMode;
  if (!outputMode || (spec.requiresFloat && !renderer.extensions.has("EXT_color_buffer_float"))) return null;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const samples = pickSamples(gl, spec.internalFormat, antialias ? SCENE_SAMPLES : 0);
  const size = renderer.getDrawingBufferSize(new Vector2());
  const drawingBuffer = new Vector2();
  /** The AO mask needs stencil bits in the scene's depth buffer (and so in the resolved depth). */
  const depthStencil = aoQuality !== "off";
  let buffers = createSceneBuffers(renderer, spec.internalFormat, samples, size, depthStencil);
  if (!buffers) return null;
  const sceneTarget = createSceneTarget(renderer, buffers.framebuffer, size, spec.type);
  /** The resolved texture and both output passes: created on first use (rgba8 normally blits instead). */
  let stage: OutputStage | null = null;
  /** The resolved depth texture once a consumer asks for it; null keeps the frame depth-blind. */
  let depthTexture: DepthTexture | null = null;
  /** The linear output pass's bloom inputs: intensity 0 and a null texture while no chain runs. */
  const bloomUniforms: {
    uBloom: IUniform<number>;
    uBloomTexture: IUniform<Texture | null>;
  } = { uBloom: { value: 0 }, uBloomTexture: { value: null } };
  /** This preset's bloom values; a development override (`__bloomTuning`) edits this copy. */
  const bloomTuning = createBloomRuntimeTuning(bloomQuality);
  /** This frame's time-of-day blend of the bloom phases (written in place every frame). */
  const bloomFrame = createBloomFrameValues();
  /** The R11b chain, or null on "off" levels and GPUs without half-float colour buffers. */
  const bloom = createFrameBloom(renderer, uniforms, {
    graded: spec.sceneGraded,
    height: size.y,
    mips: BLOOM_TUNING.mipCounts[bloomQuality],
    tuning: bloomTuning,
    width: size.x
  });
  const removeBloomTuningHook = bloom ? exposeTuningDevHook("__bloomTuning", bloomTuning) : () => {};
  /** The R12b passes, or null when off (and on GPUs without half-float colour buffers). */
  const ambientOcclusion = aoQuality === "off"
    ? null
    : createFrameAmbientOcclusion(renderer, uniforms, { height: size.y, level: aoQuality, width: size.x });
  const removeAoTuningHook = ambientOcclusion ? exposeTuningDevHook("__aoTuning", ambientOcclusion.tuning) : () => {};
  let aoActive = ambientOcclusion !== null;
  /** FRAME_AO output variants read the AO uniforms; without AO the passes are the plain R10/R11 ones. */
  /** The R18b pass, or null when off (and on GPUs without half-float colour buffers). */
  const waterReflection = waterReflections === "off"
    ? null
    : createFrameWaterReflection(renderer, uniforms, { height: size.y, iceFloes, width: size.x, winter });
  const removeSsrTuningHook = waterReflection ? exposeTuningDevHook("__ssrTuning", waterReflection.tuning) : () => {};
  let waterReflectionActive = waterReflection !== null;
  /** The R06c pass (targets allocated on its first possessed frame), or null when off. */
  const godRays = volumetricLight === "off" || volumetricLightStrength === 0
    ? null
    : createFrameGodRays(renderer, uniforms,
      { height: size.y, strength: volumetricLightStrength, width: size.x });
  /** FRAME_AO / FRAME_WATER_REFLECTION variants; without both the passes are the plain R10/R11 ones. */
  const postDefines: Record<string, number> = {
    ...(ambientOcclusion ? { FRAME_AO: 1 } : {}),
    ...(waterReflection ? { FRAME_WATER_REFLECTION: 1 } : {})
  };
  const postUniforms = { ...ambientOcclusion?.outputUniforms, ...waterReflection?.outputUniforms };
  let bloomActive = bloom !== null;
  let linearOutput = false;
  const eyeAdaptation = createEyeAdaptationControl(renderer, uniforms,
    { graded: spec.sceneGraded, mode: exposureMode, strength: exposureStrength });
  const outputStage = () => {
    if (stage) return stage;
    const resolved = new WebGLRenderTarget(size.x, size.y, { depthBuffer: false, generateMipmaps: false,
      magFilter: NearestFilter, minFilter: NearestFilter, type: spec.type });
    stage = {
      linear: createOutputPass(uniforms, resolved, {
        defines: { ...postDefines, ...(spec.sceneGraded ? { COLOR_SCENE_GRADED: 1 } : {}),
          ...(godRays ? { FRAME_GOD_RAYS: 1 } : {}) },
        extraUniforms: { ...postUniforms, ...bloomUniforms, ...eyeAdaptation.outputUniforms,
          ...godRays?.outputUniforms },
        fragment: FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL
      }),
      plain: createOutputPass(uniforms, resolved, {
        defines: postDefines,
        extraUniforms: postUniforms,
        fragment: spec.outputFragment
      }),
      resolved
    };
    return stage;
  };

  /**
   * Attaches the resolved depth texture to the resolved target (DepthFormat matches the scene
   * target's DEPTH_COMPONENT24 renderbuffer, DepthStencilFormat its DEPTH24_STENCIL8 one with AO) and
   * switches the resolve to include depth. The target may already own a framebuffer without a depth
   * attachment, so it is disposed for rebuild.
   */
  const useDepth = () => {
    if (depthTexture) return depthTexture;
    const { resolved } = outputStage();
    depthTexture = new DepthTexture(size.x, size.y, depthStencil ? UnsignedInt248Type : UnsignedIntType);
    depthTexture.format = depthStencil ? DepthStencilFormat : DepthFormat;
    resolved.depthBuffer = true;
    resolved.stencilBuffer = depthStencil;
    resolved.depthTexture = depthTexture;
    resolved.dispose();
    return depthTexture;
  };
  if (ambientOcclusion || waterReflection) useDepth();

  let blitsToCanvas = spec.blitsToCanvas;
  let canvasBlitChecked = false;

  const resize = (width: number, height: number) => {
    if (width === size.x && height === size.y) return;
    size.set(width, height);
    if (buffers) storeSceneBuffers(gl, buffers, samples, size);
    sceneTarget.width = width;
    sceneTarget.height = height;
    sceneTarget.viewport.set(0, 0, width, height);
    sceneTarget.scissor.set(0, 0, width, height);
    stage?.resolved.setSize(width, height);
    bloom?.resize(width, height);
    ambientOcclusion?.resize(width, height);
    waterReflection?.resize(width, height);
    godRays?.resize(width, height);
    if (depthTexture) {
      depthTexture.image.width = width;
      depthTexture.image.height = height;
      depthTexture.needsUpdate = true;
    }
  };

  /** A restored context lost every GL object: rebuild the raw buffers and register them again. */
  const restore = () => {
    buffers = createSceneBuffers(renderer, spec.internalFormat, samples, size, depthStencil);
    if (!buffers) return;
    (renderer as unknown as ExternalFramebufferRenderer).setRenderTargetFramebuffer(sceneTarget, buffers.framebuffer);
  };
  renderer.domElement.addEventListener("webglcontextrestored", restore);

  /** The frame's single MSAA resolve into `destination` (null: the canvas); depth only when asked. */
  const resolveInto = (destination: WebGLFramebuffer | null, withDepth: boolean) => {
    if (!buffers) return;
    renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, buffers.framebuffer);
    renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
    gl.blitFramebuffer(0, 0, size.x, size.y, 0, 0, size.x, size.y, resolveMask(gl, withDepth), gl.NEAREST);
    renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  };

  /**
   * Blits into the canvas; the first time it checks the blit was legal (the canvas format must match
   * the target's), otherwise the copy pass takes over for good. True when the frame is finished.
   */
  const finishByCanvasBlit = () => {
    if (canvasBlitChecked) {
      resolveInto(null, false);
      return true;
    }
    canvasBlitChecked = true;
    while (gl.getError() !== gl.NO_ERROR) { /* drop errors raised before this check */ }
    resolveInto(null, false);
    blitsToCanvas = gl.getError() === gl.NO_ERROR;
    return blitsToCanvas;
  };

  /** The AO weight mask into the scene target's alpha, before the resolve averages its samples. */
  const writeAmbientOcclusionMask = () => {
    if (!ambientOcclusion || !aoActive) return;
    markRenderPass("aoMask");
    renderer.setRenderTarget(sceneTarget);
    ambientOcclusion.writeMask();
    markRenderPass("output");
  };

  /** GTAO from the resolved depth (after the resolve, before the output pass reads it). */
  const renderAmbientOcclusion = (camera: Camera) => {
    if (!ambientOcclusion || !depthTexture) return;
    markRenderPass("aoPasses");
    ambientOcclusion.render(depthTexture, camera);
    markRenderPass("output");
  };

  /** The water reflections from the resolved colour and depth (before the output pass reads them). */
  const renderWaterReflection = (camera: Camera, resolved: WebGLRenderTarget) => {
    if (!waterReflection || !depthTexture) return;
    markRenderPass("waterReflection");
    waterReflection.render(resolved.texture, depthTexture, camera);
    markRenderPass("output");
  };

  /** Resolves into the stage's texture and draws the plain output pass over it (depth only when asked). */
  const finishByOutputPass = (camera: Camera) => {
    const { plain, resolved } = outputStage();
    resolveInto(framebufferOf(renderer, resolved), depthTexture !== null);
    renderAmbientOcclusion(camera);
    renderWaterReflection(camera, resolved);
    renderer.setRenderTarget(null);
    renderer.render(plain.scene, plain.camera);
  };

  /** Resolves the frame, runs the bloom chain on the resolved colour, then the linear output. */
  const finishByLinearOutput = (camera: Camera) => {
    const { linear, resolved } = outputStage();
    resolveInto(framebufferOf(renderer, resolved), depthTexture !== null);
    renderAmbientOcclusion(camera);
    renderWaterReflection(camera, resolved);
    if (godRays?.stats() && depthTexture) {
      markRenderPass("godRays");
      godRays.render(depthTexture, camera);
      markRenderPass("output");
    }
    // Highlights / glare at 0 removes the glow: the chain is skipped too (no wasted passes).
    const highlights = (uniforms.uHighlight?.value as number | undefined) ?? NEUTRAL_HIGHLIGHTS;
    const runsBloom = bloomActive && bloom !== null && highlights > 0;
    if (runsBloom) resolveBloomFrame(bloomTuning, readBloomLight(uniforms), highlights, bloomFrame);
    const bloomTexture = runsBloom ? bloom.render(resolved.texture, bloomFrame) : null;
    bloomUniforms.uBloom.value = bloomTexture ? bloomFrame.intensity : 0;
    bloomUniforms.uBloomTexture.value = bloomTexture;
    eyeAdaptation.render(resolved.texture);
    renderer.setRenderTarget(null);
    renderer.render(linear.scene, linear.camera);
  };

  return {
    beginScene: () => {
      // Pixel ratio changes reach the drawing buffer without a resize call too.
      renderer.getDrawingBufferSize(drawingBuffer);
      resize(drawingBuffer.x, drawingBuffer.y);
      renderer.setRenderTarget(sceneTarget);
      renderer.clear();
      outputMode.value = spec.mode;
    },
    dispose: () => {
      renderer.domElement.removeEventListener("webglcontextrestored", restore);
      removeBloomTuningHook();
      removeAoTuningHook();
      removeSsrTuningHook();
      if (buffers) deleteSceneBuffers(gl, buffers);
      buffers = null;
      bloom?.dispose();
      eyeAdaptation.dispose();
      ambientOcclusion?.dispose();
      waterReflection?.dispose();
      godRays?.dispose();
      if (stage) {
        for (const pass of [stage.linear, stage.plain]) {
          pass.mesh.geometry.dispose();
          pass.material.dispose();
        }
        stage.resolved.dispose();
      }
    },
    finish: camera => {
      writeAmbientOcclusionMask();
      outputMode.value = COLOR_OUTPUT_MODE.display;
      // R06c: the possessed sun shafts need the resolved depth (asked for on their first frame).
      const godRaysRun = godRays?.prepare() ?? false;
      if (godRaysRun) useDepth();
      // Bloom, the shafts and the possessed exposure work in linear radiance: the R11a linear pass.
      if (linearOutput || (bloomActive && bloom !== null) || eyeAdaptation.wanted() || godRaysRun) {
        finishByLinearOutput(camera);
        return;
      }
      // A depth consumer needs the resolved target: the canvas itself has no depth attachment.
      if (!depthTexture && blitsToCanvas && finishByCanvasBlit()) {
        renderer.setRenderTarget(null);
        return;
      }
      finishByOutputPass(camera);
    },
    resize,
    setAmbientOcclusion: active => {
      aoActive = ambientOcclusion !== null && active;
      ambientOcclusion?.setActive(aoActive);
    },
    setBloom: active => { bloomActive = bloom !== null && active; },
    setEyeAdaptation: weight => eyeAdaptation.setWeight(weight),
    setLinearOutput: active => { linearOutput = active; },
    setReflectiveWater: water => waterReflection?.setWater(water),
    setWaterReflections: active => {
      waterReflectionActive = waterReflection !== null && active;
      waterReflection?.setActive(waterReflectionActive);
    },
    stats: () => ({ ambientOcclusion: aoActive ? 1 : 0, bloom: bloomActive && bloom ? bloom.levels : 0,
      exposure: eyeAdaptation.stats(),
      linearOutput: linearOutput || (bloomActive && bloom !== null) || eyeAdaptation.wanted() ? 1 : 0,
      sceneSamples: samples,
      sceneTarget: buffers ? format : "lost", volumetricLight: godRays?.stats() ?? 0,
      waterReflections: waterReflectionActive ? 1 : 0 }),
    useDepth
  };
};
