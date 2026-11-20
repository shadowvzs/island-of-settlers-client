import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  CustomBlending,
  GLSL3,
  HalfFloatType,
  type IUniform,
  LinearFilter,
  Mesh,
  OneFactor,
  OrthographicCamera,
  RawShaderMaterial,
  Scene,
  type Texture,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget
} from "three";

import type { BloomFrameValues } from "../../render-common/bloom-phases";
import { bloomMipSize } from "../../render-common/post-sizes";
import {
  BLOOM_DOWNSAMPLE_FRAGMENT_GLSL,
  BLOOM_PREFILTER_FRAGMENT_GLSL,
  BLOOM_TRIANGLE_VERTEX_GLSL,
  BLOOM_UPSAMPLE_FRAGMENT_GLSL,
  type BloomTuning
} from "../../render-common/shaders/frame-bloom-glsl";
import { pickColorDisplayUniforms } from "./color/color-output-control";

/** One fullscreen triangle, as in the compositor's output passes. */
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);

export interface FrameBloomOptions {
  /** rgba8 scene targets hold the graded display pixel too (COLOR_SCENE_GRADED). */
  graded: boolean;
  height: number;
  /** Mip levels of the chain: 3 for "low", 5 for "on". */
  mips: number;
  /** Read on every render, so a development override applies from the next frame. */
  tuning: FrameBloomTuning;
  width: number;
}

/** The chain's fixed share of BLOOM_TUNING: the Karis scale and the per-level tent. */
export type FrameBloomTuning = Pick<BloomTuning, "karisLuma" | "upsampleRadii" | "upsampleWeights">;

export interface FrameBloom {
  dispose: () => void;
  /** Mip levels of the chain (the number of half-float targets it owns). */
  levels: number;
  /** Sizes of every level for the current drawing buffer, smallest last (tests and stats). */
  mipSizes: () => readonly (readonly [number, number])[];
  /**
   * Builds the chain from this frame's scene colour with this frame's phase-blended values
   * (bloom-phases.ts) and returns the half-resolution bloom texture (a sum of every blurred level).
   */
  render: (scene: Texture, frame: BloomFrameValues) => Texture;
  /** Re-sizes every level from the drawing buffer (half, quarter, ...). */
  resize: (width: number, height: number) => void;
}

export { bloomMipSize };

const createBloomTarget = () => {
  const target = new WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    generateMipmaps: false,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    type: HalfFloatType
  });
  target.texture.wrapS = ClampToEdgeWrapping;
  target.texture.wrapT = ClampToEdgeWrapping;
  return target;
};

const createMaterial = (
  fragmentShader: string, uniforms: Record<string, IUniform>, defines: Record<string, number> = {}
) => new RawShaderMaterial({
  defines,
  depthTest: false,
  depthWrite: false,
  fragmentShader,
  glslVersion: GLSL3,
  uniforms,
  vertexShader: BLOOM_TRIANGLE_VERTEX_GLSL
});

/** The chain falls back to off when half-float colour buffers are unavailable. */
const supportsBloomTargets = (renderer: WebGLRenderer) =>
  renderer.extensions.has("EXT_color_buffer_float");

/**
 * R11b: the HDR bloom chain of the frame compositor. The prefilter reads the resolved scene
 * colour, recovers linear radiance and thresholds it; the downsample chain then spreads it, and
 * the tent upsamples add the coarser levels onto the half-resolution result. Every target is half
 * float: a restrained highlight keeps its value instead of clipping at 8 bits.
 */
export const createFrameBloom = (
  renderer: WebGLRenderer,
  sharedUniforms: Record<string, IUniform>,
  { graded, height, mips, tuning, width }: FrameBloomOptions
): FrameBloom | null => {
  if (mips <= 0 || !supportsBloomTargets(renderer)) return null;
  const targets = Array.from({ length: mips }, createBloomTarget);
  const prefilter = createMaterial(
    BLOOM_PREFILTER_FRAGMENT_GLSL,
    {
      ...pickColorDisplayUniforms(sharedUniforms),
      uBloomClippedBoost: { value: 0 },
      uBloomRamp: { value: new Vector3() },
      uBloomTint: { value: new Vector3(1, 1, 1) },
      uScene: { value: null }
    },
    graded ? { COLOR_SCENE_GRADED: 1 } : {}
  );
  const downsampleKaris = createMaterial(BLOOM_DOWNSAMPLE_FRAGMENT_GLSL,
    { uBloomKarisLuma: { value: 1 }, uScene: { value: null } }, { BLOOM_KARIS: 1 });
  const downsample = createMaterial(BLOOM_DOWNSAMPLE_FRAGMENT_GLSL, { uScene: { value: null } });
  const upsample = createMaterial(BLOOM_UPSAMPLE_FRAGMENT_GLSL, {
    uRadius: { value: 1 },
    uScene: { value: null },
    uWeight: { value: 1 }
  });
  // Additive: the tent result lands on the level's own downsample instead of replacing it.
  upsample.blending = CustomBlending;
  upsample.blendDst = OneFactor;
  upsample.blendEquation = AddEquation;
  upsample.blendSrc = OneFactor;
  upsample.transparent = true;
  const materials = [prefilter, downsampleKaris, downsample, upsample];

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(FULLSCREEN_TRIANGLE, 3));
  const mesh = new Mesh(geometry, prefilter);
  mesh.frustumCulled = false;
  const scene = new Scene().add(mesh);
  const camera = new OrthographicCamera();

  const resize = (nextWidth: number, nextHeight: number) => {
    targets.forEach((target, level) => {
      const [mipWidth, mipHeight] = bloomMipSize(nextWidth, nextHeight, level);
      target.setSize(mipWidth, mipHeight);
    });
  };
  resize(width, height);

  const draw = (material: RawShaderMaterial, source: Texture, destination: WebGLRenderTarget) => {
    material.uniforms.uScene!.value = source;
    mesh.material = material;
    renderer.setRenderTarget(destination);
    renderer.render(scene, camera);
  };

  return {
    dispose: () => {
      for (const target of targets) target.dispose();
      geometry.dispose();
      for (const material of materials) material.dispose();
    },
    levels: mips,
    mipSizes: () => targets.map(target => [target.width, target.height] as const),
    render: (sceneTexture, frame) => {
      // The upsample adds onto the previous level, so the renderer must not clear the targets.
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      try {
        prefilter.uniforms.uBloomClippedBoost!.value = frame.clippedBoost;
        prefilter.uniforms.uBloomRamp!.value.set(frame.threshold, frame.knee, frame.clipWhiteOnly);
        prefilter.uniforms.uBloomTint!.value.fromArray(frame.tint);
        downsampleKaris.uniforms.uBloomKarisLuma!.value = tuning.karisLuma;
        draw(prefilter, sceneTexture, targets[0]!);
        for (let level = 1; level < mips; level++)
          draw(level === 1 ? downsampleKaris : downsample, targets[level - 1]!.texture, targets[level]!);
        for (let level = mips - 1; level > 0; level--) {
          upsample.uniforms.uRadius!.value = (tuning.upsampleRadii[level] ?? 1) * frame.radiusScale;
          upsample.uniforms.uWeight!.value = tuning.upsampleWeights[level] ?? 1;
          draw(upsample, targets[level]!.texture, targets[level - 1]!);
        }
      } finally {
        renderer.autoClear = autoClear;
      }
      return targets[0]!.texture;
    },
    resize
  };
};
