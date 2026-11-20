import {
  BufferAttribute,
  BufferGeometry,
  DataUtils,
  GLSL3,
  HalfFloatType,
  type IUniform,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  RawShaderMaterial,
  Scene,
  type Texture,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget
} from "three";

import {
  adaptationRate,
  type EyeAdaptationLimits,
  type EyeAdaptationTuning
} from "../../render-common/eye-adaptation";
import {
  EXPOSURE_ADAPT_FRAGMENT_GLSL,
  EXPOSURE_GRID,
  EXPOSURE_LUMINANCE_FRAGMENT_GLSL,
  EXPOSURE_REDUCE_BLOCK,
  EXPOSURE_REDUCE_FRAGMENT_GLSL
} from "../../render-common/shaders/frame-exposure-glsl";
import { FRAME_TRIANGLE_VERTEX_GLSL } from "../../render-common/shaders/frame-output-glsl";
import { pickColorDisplayUniforms } from "./color/color-output-control";

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);

export interface FrameExposureOptions {
  /** rgba8 scene targets hold the graded display pixel too (COLOR_SCENE_GRADED). */
  graded: boolean;
  /** Read on every render, so a development override applies from the next frame. */
  tuning: EyeAdaptationTuning;
}

/** This frame's adaptation inputs. */
export interface FrameExposureStep {
  /** Seconds since the previous adapted frame. */
  dtSeconds: number;
  limits: EyeAdaptationLimits;
  /** The first possessed frame: the exposure jumps to its target (the view fades in by weight). */
  reset: boolean;
}

/** The two development readings of the exposure (the 1 × 1 targets, read back only on request). */
export interface FrameExposureProbe {
  ev: number;
  meanLog2: number;
}

export interface FrameExposure {
  dispose: () => void;
  /** Development only: reads the mean log2 luminance and the current EV back (stalls the GPU). */
  probe: () => FrameExposureProbe;
  /** Measures `scene`, adapts, and returns the 1 × 1 texture whose red channel holds the EV. */
  render: (scene: Texture, step: FrameExposureStep) => Texture;
}

const createTarget = (width: number, height: number) => new WebGLRenderTarget(width, height, {
  depthBuffer: false,
  generateMipmaps: false,
  magFilter: NearestFilter,
  minFilter: NearestFilter,
  type: HalfFloatType
});

const createMaterial = (
  fragmentShader: string, uniforms: Record<string, IUniform>, defines: Record<string, number> = {}
) => new RawShaderMaterial({
  defines,
  depthTest: false,
  depthWrite: false,
  fragmentShader,
  glslVersion: GLSL3,
  uniforms,
  vertexShader: FRAME_TRIANGLE_VERTEX_GLSL
});

/** Half-float targets read back as half floats (Uint16Array) with EXT_color_buffer_float. */
const readRed = (renderer: WebGLRenderer, target: WebGLRenderTarget, pixel: Uint16Array) => {
  renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
  return DataUtils.fromHalfFloat(pixel[0]!);
};

/**
 * R11c: the possessed eye's exposure. Four tiny draws per frame: the 64 × 36 log-luminance grid,
 * two exact block reductions to one texel and the adaptation step into one of two 1 × 1 targets
 * (ping-pong, the other holds the previous EV). Null without half-float colour buffers.
 */
export const createFrameExposure = (
  renderer: WebGLRenderer,
  sharedUniforms: Record<string, IUniform>,
  { graded, tuning }: FrameExposureOptions
): FrameExposure | null => {
  if (!renderer.extensions.has("EXT_color_buffer_float")) return null;
  const grid = createTarget(EXPOSURE_GRID.width, EXPOSURE_GRID.height);
  const reduced = createTarget(
    EXPOSURE_GRID.width / EXPOSURE_REDUCE_BLOCK.width, EXPOSURE_GRID.height / EXPOSURE_REDUCE_BLOCK.height
  );
  const mean = createTarget(1, 1);
  const adapted = [createTarget(1, 1), createTarget(1, 1)] as const;
  const targets = [grid, reduced, mean, ...adapted];
  let current = 0;

  const luminance = createMaterial(EXPOSURE_LUMINANCE_FRAGMENT_GLSL,
    { ...pickColorDisplayUniforms(sharedUniforms), uScene: { value: null } },
    graded ? { COLOR_SCENE_GRADED: 1 } : {});
  const reduce = createMaterial(EXPOSURE_REDUCE_FRAGMENT_GLSL,
    { uBlock: { value: new Vector2() }, uSource: { value: null } });
  const adapt = createMaterial(EXPOSURE_ADAPT_FRAGMENT_GLSL, {
    uExposureCompensation: { value: new Vector2() },
    uExposureRates: { value: new Vector2() },
    uExposureTarget: { value: new Vector3() },
    uMean: { value: mean.texture },
    uPrevious: { value: null }
  });
  const materials = [luminance, reduce, adapt];
  const blocks = [
    new Vector2(EXPOSURE_REDUCE_BLOCK.width, EXPOSURE_REDUCE_BLOCK.height),
    new Vector2(reduced.width, reduced.height)
  ] as const;

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(FULLSCREEN_TRIANGLE, 3));
  const mesh = new Mesh(geometry, luminance);
  mesh.frustumCulled = false;
  const scene = new Scene().add(mesh);
  const camera = new OrthographicCamera();
  const pixel = new Uint16Array(4);

  const draw = (material: RawShaderMaterial, destination: WebGLRenderTarget) => {
    mesh.material = material;
    renderer.setRenderTarget(destination);
    renderer.render(scene, camera);
  };

  const reduceInto = (source: WebGLRenderTarget, block: Vector2, destination: WebGLRenderTarget) => {
    reduce.uniforms.uSource!.value = source.texture;
    (reduce.uniforms.uBlock!.value as Vector2).copy(block);
    draw(reduce, destination);
  };

  const adaptInto = ({ dtSeconds, limits, reset }: FrameExposureStep) => {
    const previous = adapted[current]!;
    current = 1 - current;
    (adapt.uniforms.uExposureTarget!.value as Vector3).set(limits.minEv, limits.maxEv, limits.keyLog2);
    (adapt.uniforms.uExposureCompensation!.value as Vector2)
      .set(tuning.brightenCompensation, tuning.darkenCompensation);
    (adapt.uniforms.uExposureRates!.value as Vector2).set(
      reset ? 1 : adaptationRate(dtSeconds, tuning.brightenSeconds),
      reset ? 1 : adaptationRate(dtSeconds, tuning.darkenSeconds)
    );
    adapt.uniforms.uPrevious!.value = previous.texture;
    draw(adapt, adapted[current]!);
  };

  return {
    dispose: () => {
      for (const target of targets) target.dispose();
      for (const material of materials) material.dispose();
      geometry.dispose();
    },
    probe: () => ({
      ev: readRed(renderer, adapted[current]!, pixel),
      meanLog2: readRed(renderer, mean, pixel)
    }),
    render: (sceneTexture, step) => {
      luminance.uniforms.uScene!.value = sceneTexture;
      draw(luminance, grid);
      reduceInto(grid, blocks[0], reduced);
      reduceInto(reduced, blocks[1], mean);
      adaptInto(step);
      return adapted[current]!.texture;
    }
  };
};
