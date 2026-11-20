import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { int, ivec2, screenCoordinate, texture, textureLoad, uniform, uv, vec2, vec4 } from "three/tsl";
import {
  type Camera,
  DataTexture,
  FloatType,
  NearestFilter,
  RedFormat,
  type RenderTarget,
  UnsignedByteType,
  Vector2,
  WebGPURenderer
} from "three/webgpu";

import {
  type BloomFrameValues,
  type BloomRuntimeTuning,
  createBloomFrameValues,
  createBloomRuntimeTuning,
  resolveBloomFrame
} from "../../../../render-common/bloom-phases";
import {
  EYE_ADAPTATION_TUNING,
  type EyeAdaptationLimits,
  eyeAdaptationLimits,
  type EyeAdaptationTuning,
  scaleEyeAdaptationTuning
} from "../../../../render-common/eye-adaptation";
import { NEUTRAL_HIGHLIGHTS } from "../../../../render-common/highlights";
import type { ActiveAmbientOcclusion, BloomQuality } from "../../../../render-common/quality";
import { BLOOM_TUNING } from "../../../../render-common/shaders/frame-bloom-glsl";
import {
  colorRadianceToDisplay,
  colorSceneToRadiance,
  colorSrgbDecode
} from "../color-output";
import { syncUniformBindings } from "../uniform-bindings";
import { createTslAmbientOcclusion, type TslAmbientOcclusion } from "./ao";
import { createTslBloom, type TslBloom } from "./bloom";
import { createPostNodes } from "./colour-nodes";
import { createTslExposure, type TslExposure } from "./exposure";
import { createPassMaterial, createQuadPass, type QuadPass } from "./quad-pass";
import { createTslSceneTarget, type TslSceneTarget } from "./scene-target";
import { createPostTarget, resizePostTarget } from "./targets";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

export interface TslPostSettings {
  ambientOcclusion: ActiveAmbientOcclusion | "off";
  bloom: BloomQuality;
  /** Auto-exposure runs only while the possessed eye is active. */
  exposure: boolean;
  /** The Auto-exposure slider (0..1). */
  exposureStrength: number;
  /**
   * FXAA on the display pixels: the scene target has no MSAA (its depth feeds the AO), so this pass
   * stands in for the WebGL canvas's 4x MSAA on sub-pixel grass blades and edges.
   */
  antialias: boolean;
}

export interface TslPostChain {
  /** The half-float scene colour and sampleable depth every world layer draws into. */
  readonly scene: TslSceneTarget;
  beginScene: () => void;
  dispose: () => void;
  finish: (camera: Camera) => void;
  resize: (width: number, height: number) => void;
  setAmbientOcclusion: (active: boolean) => void;
  setBloom: (active: boolean) => void;
  setEyeAdaptation: (weight: number) => void;
  stats: () => { ambientOcclusion: number; bloom: number; exposure: number };
}

/** DEV A/B: `?wgAa=0` turns the FXAA pass off. */
export const isPostAntialiasOptOut = () => import.meta.env.DEV && typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("wgAa") === "0";

/** The finished display pixel as the linear light the node renderer encodes into the canvas. */
const displayToCanvas = (display: TslNode): TslNode => {
  const decoded = colorSrgbDecode(display) as TslNode;
  return vec4(decoded.x, decoded.y, decoded.z, 1);
};

/** FXAA over the display pixels (an RGBA8 target), decoded into the canvas. */
const createAntialiasPass = (size: Vector2) => {
  const target: RenderTarget = createPostTarget(size.x, size.y, { type: UnsignedByteType });
  target.texture.name = "tsl:post-display";
  const smoothed = fxaa(texture(target.texture)) as TslNode;
  const material = createPassMaterial("tsl:post-fxaa", displayToCanvas(smoothed.rgb));
  return {
    dispose: () => {
      target.dispose();
      material.dispose();
    },
    material,
    resize: (width: number, height: number) => resizePostTarget(target, width, height),
    target
  };
};

const createCpuTexture = () => {
  const data = new Float32Array([0, 0, 0, 1]);
  const texture = new DataTexture(data, 1, 1, RedFormat, FloatType);
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
};

/**
 * TSL twin of the frame compositor's post chain: a half-float scene target, the possessed eye's
 * exposure, the R11b bloom chain, the R12b ambient occlusion and one linear output pass. The
 * material tails still tonemap and grade per fragment (the target holds graded display pixels, as
 * the WebGL rgba8 path), so the output pass recovers radiance before it adds light and tonemaps
 * once at the end.
 */
export const createTslPostChain = (
  renderer: WebGPURenderer,
  uniforms: Record<string, import("three").IUniform>,
  settings: TslPostSettings
): TslPostChain => {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const scene = createTslSceneTarget(size.x, size.y);
  const quad: QuadPass = createQuadPass(renderer);
  const { bindings, colour } = createPostNodes(uniforms);
  const emptyTexture = createCpuTexture();
  const bloomNode = texture(emptyTexture) as TslNode;
  const exposureNode = texture(emptyTexture) as TslNode;
  const bloomAmount = uniform(0);
  const eyeWeight = uniform(0);

  const bloomQuality = settings.bloom;
  const blevel = BLOOM_TUNING.mipCounts[bloomQuality];
  const bloomTuning: BloomRuntimeTuning = createBloomRuntimeTuning(bloomQuality);
  const bloomFrame: BloomFrameValues = createBloomFrameValues();
  const bloom: TslBloom | null = blevel > 0
    ? createTslBloom({ colour, mips: blevel, quad, sceneTexture: scene.target.texture,
      tuning: bloomTuning })
    : null;
  const ao: TslAmbientOcclusion | null = settings.ambientOcclusion === "off"
    ? null
    : createTslAmbientOcclusion({
      depthTexture: scene.depthTexture,
      level: settings.ambientOcclusion,
      quad
    });
  const exposureTuning: EyeAdaptationTuning = scaleEyeAdaptationTuning(
    EYE_ADAPTATION_TUNING, settings.exposureStrength);
  const exposure: TslExposure | null = settings.exposure
    ? createTslExposure({ colour, quad, sceneTexture: scene.target.texture, tuning: exposureTuning })
    : null;
  const limits: EyeAdaptationLimits = { keyLog2: 0, maxEv: 0, minEv: 0 };
  const step = { dtSeconds: 0, limits, reset: true };
  let lastFrameMs = 0;
  let eyeAdaptationWeight = 0;
  let bloomActive = bloom !== null;
  let aoActive = ao !== null;

  const sceneNode = texture(scene.target.texture) as TslNode;

  const finalMaterial = createPassMaterial("tsl:post-final", (() => {
    const scenePixel = textureLoad(sceneNode,
      ivec2(int(screenCoordinate.x), int(screenCoordinate.y))) as TslNode;
    let radiance: TslNode = colorSceneToRadiance(scenePixel.rgb, colour.exposure,
      colour.toneWeight, colour.rain, colour.vivid);
    if (ao !== null)
      radiance = radiance.mul(ao.visibility(screenCoordinate.xy, scenePixel.a));
    radiance = radiance.add(bloomNode.sample(uv()).rgb.mul(bloomAmount));
    radiance = radiance.mul(eyeWeight.mul(exposureNode.sample(vec2(0.5)).r).exp2());
    const display = colorRadianceToDisplay(radiance, screenCoordinate.xy, colour.exposure,
      colour.toneWeight, colour.rain, colour.vivid);
    // The node renderer encodes the canvas: hand the finished display pixel back as linear light.
    // The canvas is opaque; the scene alpha only masks AO. With FXAA the display pixel goes to
    // an 8-bit target first (FXAA works on display values) and the AA pass decodes it.
    return settings.antialias ? vec4(display, 1) : displayToCanvas(display);
  })());
  const antialias = settings.antialias ? createAntialiasPass(size) : null;

  const syncSize = () => {
    const drawing = renderer.getDrawingBufferSize(new Vector2());
    scene.resize(drawing.x, drawing.y);
    bloom?.resize(drawing.x, drawing.y);
    ao?.resize(drawing.x, drawing.y);
    exposure?.resize(drawing.x, drawing.y);
    antialias?.resize(drawing.x, drawing.y);
    return { height: drawing.y, width: drawing.x };
  };

  const readNumber = (name: string, fallback: number) => {
    const value = uniforms[name]?.value;
    return typeof value === "number" ? value : fallback;
  };
  const readSunHeight = () => {
    const direction = uniforms.uSunDirection?.value as ArrayLike<number> | undefined;
    return typeof direction?.[1] === "number" ? direction[1] : 1;
  };

  return {
    scene,
    beginScene: () => {
      syncSize();
      renderer.setRenderTarget(scene.target);
      renderer.clear();
    },
    dispose: () => {
      scene.dispose();
      quad.dispose();
      bloom?.dispose();
      ao?.dispose();
      exposure?.dispose();
      finalMaterial.dispose();
      antialias?.dispose();
      emptyTexture.dispose();
    },
    finish: camera => {
      const { height, width } = syncSize();
      syncUniformBindings(bindings);
      renderer.setRenderTarget(null);
      if (exposure !== null && eyeAdaptationWeight > 0) {
        const now = performance.now();
        step.dtSeconds = step.reset ? 0 : (now - lastFrameMs) / 1000;
        lastFrameMs = now;
        eyeAdaptationLimits(readNumber("uDaylight", 1), exposureTuning, limits);
        const result = exposure.render(step);
        exposureNode.value = result;
        eyeWeight.value = eyeAdaptationWeight;
        step.reset = false;
      } else {
        eyeWeight.value = 0;
        step.reset = true;
      }
      if (aoActive && ao !== null) ao.render(camera, width, height);
      if (bloomActive && bloom !== null) {
        resolveBloomFrame(bloomTuning, { daylight: readNumber("uDaylight", 1),
          sunHeight: readSunHeight() }, readNumber("uHighlight", NEUTRAL_HIGHLIGHTS), bloomFrame);
        bloomNode.value = bloom.render(bloomFrame);
        bloomAmount.value = bloomFrame.intensity;
      } else bloomAmount.value = 0;
      quad.draw(finalMaterial, antialias?.target ?? null);
      if (antialias !== null) quad.draw(antialias.material, null);
    },
    resize: (width, height) => {
      scene.resize(width, height);
      bloom?.resize(width, height);
      ao?.resize(width, height);
      exposure?.resize(width, height);
      antialias?.resize(width, height);
    },
    setAmbientOcclusion: active => { aoActive = active && ao !== null; },
    setBloom: active => { bloomActive = active && bloom !== null; },
    setEyeAdaptation: weight => { eyeAdaptationWeight = Math.min(1, Math.max(0, weight)); },
    stats: () => ({
      ambientOcclusion: aoActive && ao !== null ? 1 : 0,
      bloom: bloomActive && bloom !== null ? bloom.levels : 0,
      exposure: exposure !== null && eyeAdaptationWeight > 0 ? 1 : 0
    })
  };
};
