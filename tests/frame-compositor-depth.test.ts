import {
  BufferGeometry,
  DepthFormat,
  DepthStencilFormat,
  DepthTexture,
  Group,
  type IUniform,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  type RawShaderMaterial,
  type Scene,
  UnsignedInt248Type,
  UnsignedIntType,
  Vector2,
  type WebGLRenderer
} from "three";
import { describe, expect, it } from "vitest";

import type {
  AmbientOcclusion,
  BloomQuality,
  ExposureMode,
  WaterReflections
} from "../src/render-common/quality";
import {
  AO_BLUR_FRAGMENT_GLSL,
  AO_DEPTH_FRAGMENT_GLSL,
  AO_GTAO_FRAGMENT_GLSL,
  AO_MASK_FRAGMENT_GLSL
} from "../src/render-common/shaders/frame-ao-glsl";
import {
  BLOOM_DOWNSAMPLE_FRAGMENT_GLSL,
  BLOOM_PREFILTER_FRAGMENT_GLSL,
  BLOOM_UPSAMPLE_FRAGMENT_GLSL
} from "../src/render-common/shaders/frame-bloom-glsl";
import {
  EXPOSURE_ADAPT_FRAGMENT_GLSL,
  EXPOSURE_LUMINANCE_FRAGMENT_GLSL,
  EXPOSURE_REDUCE_FRAGMENT_GLSL
} from "../src/render-common/shaders/frame-exposure-glsl";
import {
  FRAME_COPY_FRAGMENT_GLSL,
  FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL
} from "../src/render-common/shaders/frame-output-glsl";
import { WATER_REFLECTION_BLUR_FRAGMENT_GLSL } from "../src/render-common/shaders/frame-water-reflection-glsl";
import { createFrameCompositor, type FrameCompositorOptions } from "../src/renderers/three/frame-compositor";
import { SUN_SHADOW_UNIFORM_NAMES } from "../src/renderers/three/sun-shadow-glsl";

/** The GL enums and entry points the compositor touches; a fake context records the resolve. */
const GL = {
  COLOR_ATTACHMENT0: 0x8ce0,
  COLOR_BUFFER_BIT: 0x4000,
  DEPTH24_STENCIL8: 0x88f0,
  DEPTH_ATTACHMENT: 0x8d00,
  DEPTH_BUFFER_BIT: 0x0100,
  DEPTH_COMPONENT24: 0x81a6,
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  DRAW_FRAMEBUFFER: 0x8ca9,
  FRAMEBUFFER: 0x8d40,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  NEAREST: 0x2600,
  NO_ERROR: 0,
  READ_FRAMEBUFFER: 0x8ca8,
  RENDERBUFFER: 0x8d41,
  SAMPLES: 0x8d57
} as const;

interface Resolve {
  destination: unknown;
  filter: number;
  mask: number;
}

const createHarness = (
  format: "rgba8" | "rgba16f", width = 800, height = 600, bloom: BloomQuality = "off",
  ambientOcclusion: AmbientOcclusion = "off",
  shading: Record<string, IUniform> = {},
  waterReflections: WaterReflections = "off",
  exposureMode: ExposureMode = "fixed",
  strengths: Pick<FrameCompositorOptions, "exposureStrength" | "volumetricLight" | "volumetricLightStrength"> = {}
) => {
  const resolves: Resolve[] = [];
  const renders: string[] = [];
  const outputDefines: Record<string, unknown>[] = [];
  /** The linear output's exposure weight per draw (undefined for passes without one). */
  const exposureWeights: unknown[] = [];
  const attachments: number[] = [];
  const storageFormats: number[] = [];
  let drawFramebuffer: unknown = null;
  const gl = {
    ...GL,
    bindRenderbuffer: () => {},
    blitFramebuffer: (...args: number[]) => {
      resolves.push({ destination: drawFramebuffer, filter: args[9]!, mask: args[8]! });
    },
    checkFramebufferStatus: () => GL.FRAMEBUFFER_COMPLETE,
    createFramebuffer: () => ({}),
    createRenderbuffer: () => ({}),
    deleteFramebuffer: () => {},
    deleteRenderbuffer: () => {},
    framebufferRenderbuffer: (_target: number, attachment: number) => { attachments.push(attachment); },
    getError: () => GL.NO_ERROR,
    getInternalformatParameter: () => new Int32Array([4]),
    renderbufferStorageMultisample: (_target: number, _samples: number, internalFormat: number) => {
      storageFormats.push(internalFormat);
    }
  };
  const targets = new Map<object, { __webglFramebuffer?: object }>();
  const renderer = {
    clear: () => {},
    domElement: { addEventListener: () => {}, removeEventListener: () => {} },
    extensions: { has: () => true },
    getContext: () => gl,
    getClearAlpha: () => 1,
    getClearColor: (target: object) => target,
    getDrawingBufferSize: (target: Vector2) => target.set(width, height),
    initRenderTarget: (target: object) => {
      const entry = targets.get(target) ?? {};
      entry.__webglFramebuffer ??= {};
      targets.set(target, entry);
    },
    properties: { get: (target: object) => targets.get(target) ?? {} },
    render: (scene: Scene) => {
      const mesh = scene.children[0] as Mesh;
      const material = mesh.material as RawShaderMaterial;
      renders.push(material.fragmentShader);
      outputDefines.push(material.defines);
      exposureWeights.push(material.uniforms.uExposureWeight?.value);
    },
    setClearColor: () => {},
    setRenderTarget: () => {},
    setRenderTargetFramebuffer: () => {},
    state: {
      bindFramebuffer: (target: number, framebuffer: unknown) => {
        if (target === GL.DRAW_FRAMEBUFFER) drawFramebuffer = framebuffer;
      }
    }
  };
  const uniforms = {
    uColorGradeRain: { value: 0 },
    uColorOutputMode: { value: 0 },
    uColorToneMapper: { value: 0 },
    uColorVividBoost: { value: 0 },
    ...shading
  };
  const compositor = createFrameCompositor(
    renderer as unknown as WebGLRenderer,
    uniforms,
    { ambientOcclusion, antialias: true, bloom, exposureMode, format, waterReflections, ...strengths }
  );
  expect(compositor).not.toBeNull();
  return {
    attachments, compositor: compositor!, exposureWeights, outputDefines, renders, resolves, storageFormats
  };
};

describe("resolved depth texture (R12a)", () => {
  it("resolves colour only while no consumer asks for depth", () => {
    const { compositor, resolves } = createHarness("rgba8");
    compositor.finish(new OrthographicCamera());
    expect(resolves).toHaveLength(1);
    expect(resolves[0]).toMatchObject({
      destination: null,
      filter: GL.NEAREST,
      mask: GL.COLOR_BUFFER_BIT
    });
  });

  it("creates the DepthFormat texture once on first request and resolves it too", () => {
    const { compositor, resolves } = createHarness("rgba8");
    const depth = compositor.useDepth();
    expect(depth).toBeInstanceOf(DepthTexture);
    expect(depth.format).toBe(DepthFormat);
    expect(depth.type).toBe(UnsignedIntType);
    expect([depth.image.width, depth.image.height]).toEqual([800, 600]);
    expect(compositor.useDepth()).toBe(depth);
    compositor.finish(new OrthographicCamera());
    expect(resolves).toHaveLength(1);
    expect(resolves[0]).toMatchObject({
      filter: GL.NEAREST,
      mask: GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT
    });
    expect(resolves[0]!.destination).not.toBeNull();
  });

  it("keeps the depth texture at the drawing buffer size after a resize", () => {
    const { compositor } = createHarness("rgba8");
    const depth = compositor.useDepth();
    const version = depth.version;
    compositor.resize(1024, 768);
    expect([depth.image.width, depth.image.height]).toEqual([1024, 768]);
    expect(depth.version).toBeGreaterThan(version);
  });

  it("adds depth after the resolved target already ran without it", () => {
    const { compositor, resolves } = createHarness("rgba16f");
    compositor.finish(new OrthographicCamera());
    expect(resolves.at(-1)!.mask).toBe(GL.COLOR_BUFFER_BIT);
    compositor.useDepth();
    compositor.finish(new OrthographicCamera());
    expect(resolves.at(-1)!.mask).toBe(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
  });

  it("runs the bloom mip chain before the linear output pass (R11b)", () => {
    const { compositor, renders, resolves } = createHarness("rgba8", 800, 600, "on");
    expect(compositor.stats().bloom).toBe(5);
    compositor.finish(new OrthographicCamera());
    expect(resolves).toHaveLength(1);
    expect(resolves[0]!.destination).not.toBeNull();
    expect(renders).toEqual([
      BLOOM_PREFILTER_FRAGMENT_GLSL,
      ...Array(4).fill(BLOOM_DOWNSAMPLE_FRAGMENT_GLSL),
      ...Array(4).fill(BLOOM_UPSAMPLE_FRAGMENT_GLSL),
      FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL
    ]);
    expect(compositor.stats()).toMatchObject({ bloom: 5, linearOutput: 1 });
  });

  it("drops the bloom chain again without touching the plain path", () => {
    const { compositor, renders } = createHarness("rgba8", 800, 600, "low");
    expect(compositor.stats().bloom).toBe(3);
    compositor.setBloom(false);
    expect(compositor.stats()).toMatchObject({ bloom: 0, linearOutput: 0 });
    compositor.finish(new OrthographicCamera());
    expect(renders).toEqual([]);
  });

  it("resolves depth into the linear output pass when both features are on (R11a + R12a)", () => {
    const { compositor, renders, resolves } = createHarness("rgba8");
    compositor.useDepth();
    compositor.setLinearOutput(true);
    compositor.finish(new OrthographicCamera());
    expect(resolves).toHaveLength(1);
    expect(resolves[0]!.destination).not.toBeNull();
    expect(resolves[0]!.mask).toBe(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
    expect(compositor.stats().linearOutput).toBe(1);
    expect(renders).toHaveLength(1);
    expect(renders[0]).toContain("colorSceneToLinear");
  });
});

/** Mask (two draws), view-depth prepass, GTAO and the two blur axes, in this order. */
const AO_PASSES = [
  AO_MASK_FRAGMENT_GLSL, AO_MASK_FRAGMENT_GLSL, AO_DEPTH_FRAGMENT_GLSL, AO_GTAO_FRAGMENT_GLSL,
  AO_BLUR_FRAGMENT_GLSL, AO_BLUR_FRAGMENT_GLSL
];

describe("half-resolution ambient occlusion (R12b)", () => {
  it("keeps the plain depth buffer and no AO pass when off", () => {
    const { attachments, compositor, renders, resolves, storageFormats } = createHarness("rgba8");
    compositor.finish(new OrthographicCamera());
    expect(storageFormats).toContain(GL.DEPTH_COMPONENT24);
    expect(storageFormats).not.toContain(GL.DEPTH24_STENCIL8);
    expect(attachments).toContain(GL.DEPTH_ATTACHMENT);
    expect(renders).toEqual([]);
    expect(resolves[0]).toMatchObject({ destination: null, mask: GL.COLOR_BUFFER_BIT });
    expect(compositor.stats().ambientOcclusion).toBe(0);
  });

  it("masks, resolves depth, runs GTAO and its blur, then the AO copy pass", () => {
    const harness = createHarness("rgba8", 800, 600, "off", "soft");
    const { attachments, compositor, outputDefines, renders, resolves, storageFormats } = harness;
    const depth = compositor.useDepth();
    expect(depth.format).toBe(DepthStencilFormat);
    expect(depth.type).toBe(UnsignedInt248Type);
    expect(storageFormats).toContain(GL.DEPTH24_STENCIL8);
    expect(attachments).toContain(GL.DEPTH_STENCIL_ATTACHMENT);
    compositor.finish(new OrthographicCamera());
    expect(renders).toEqual([...AO_PASSES, FRAME_COPY_FRAGMENT_GLSL]);
    expect(outputDefines.at(-1)).toMatchObject({ FRAME_AO: 1 });
    expect(resolves).toHaveLength(1);
    expect(resolves[0]!.mask).toBe(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
    expect(compositor.stats().ambientOcclusion).toBe(1);
  });

  it("applies the occlusion in the linear pass when bloom runs", () => {
    const { compositor, renders } = createHarness("rgba8", 800, 600, "on", "strong");
    compositor.finish(new OrthographicCamera());
    expect(renders.slice(0, AO_PASSES.length)).toEqual(AO_PASSES);
    expect(renders.at(-1)).toBe(FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL);
  });

  it("weighs the occlusion by the direct sun share when the shading has the sun map and sky", () => {
    const names = [...SUN_SHADOW_UNIFORM_NAMES, "uSkyIrradiance", "uSunColor", "uSunDirection"];
    const shading = Object.fromEntries(names.map(name => [name, { value: null }]));
    const { compositor, renders } = createHarness("rgba8", 800, 600, "off", "soft", shading);
    compositor.finish(new OrthographicCamera());
    const gtao = renders[AO_PASSES.indexOf(AO_GTAO_FRAGMENT_GLSL)]!;
    expect(gtao).not.toBe(AO_GTAO_FRAGMENT_GLSL);
    expect(gtao).toContain("#define AO_DIRECT_SHARE");
    expect(gtao).toContain("sampleSunShadowRaw");
    expect(renders.at(-1)).toBe(FRAME_COPY_FRAGMENT_GLSL);
  });

  it("keeps the plain GTAO pass when the sun shadow map is not among the uniforms", () => {
    const shading = { uSkyIrradiance: { value: null }, uSunColor: { value: null } };
    const { compositor, renders } = createHarness("rgba8", 800, 600, "off", "soft", shading);
    compositor.finish(new OrthographicCamera());
    expect(renders.slice(0, AO_PASSES.length)).toEqual(AO_PASSES);
  });

  it("skips every AO pass while switched off and keeps the unoccluded output", () => {
    const { compositor, renders } = createHarness("rgba8", 800, 600, "off", "soft");
    compositor.setAmbientOcclusion(false);
    compositor.finish(new OrthographicCamera());
    expect(renders).toEqual([FRAME_COPY_FRAGMENT_GLSL]);
    expect(compositor.stats().ambientOcclusion).toBe(0);
  });
});

describe("half-resolution water reflections (R18b)", () => {
  const createWater = (visible = true) => {
    const material = new MeshBasicMaterial();
    const water = new Group().add(new Mesh(new BufferGeometry(), material));
    return { material, source: { hasVisibleWater: () => visible, water } };
  };

  it("adds no pass, no define and no depth resolve when off", () => {
    const { compositor, outputDefines, renders, resolves } = createHarness("rgba8");
    compositor.setReflectiveWater(createWater().source);
    compositor.finish(new OrthographicCamera());
    expect(renders).toEqual([]);
    expect(outputDefines).toEqual([]);
    expect(resolves[0]).toMatchObject({ destination: null, mask: GL.COLOR_BUFFER_BIT });
    expect(compositor.stats().waterReflections).toBe(0);
  });

  it("resolves depth, redraws the water with the reflection pass, then the reflecting output", () => {
    const harness = createHarness("rgba8", 800, 600, "off", "off", {}, "on");
    const { compositor, outputDefines, renders, resolves } = harness;
    const { material, source } = createWater();
    compositor.setReflectiveWater(source);
    compositor.finish(new OrthographicCamera());
    expect(resolves[0]!.mask).toBe(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);
    expect(renders).toHaveLength(4);
    expect(renders[0]).toContain("traceReflection");
    expect(renders.slice(1, 3)).toEqual([WATER_REFLECTION_BLUR_FRAGMENT_GLSL, WATER_REFLECTION_BLUR_FRAGMENT_GLSL]);
    expect(renders[3]).toBe(FRAME_COPY_FRAGMENT_GLSL);
    expect(outputDefines.at(-1)).toMatchObject({ FRAME_WATER_REFLECTION: 1 });
    // The scene's own water material is back after the pass.
    expect((source.water.children[0] as Mesh).material).toBe(material);
    expect(compositor.stats().waterReflections).toBe(1);
  });

  it("skips the redraw without water in view and while switched off", () => {
    const { compositor, renders } = createHarness("rgba8", 800, 600, "on", "soft", {}, "on");
    compositor.setReflectiveWater(createWater(false).source);
    compositor.finish(new OrthographicCamera());
    expect(renders.some(shader => shader.includes("traceReflection"))).toBe(false);
    compositor.setReflectiveWater(createWater().source);
    compositor.setWaterReflections(false);
    compositor.finish(new OrthographicCamera());
    expect(renders.some(shader => shader.includes("traceReflection"))).toBe(false);
    expect(renders.at(-1)).toBe(FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL);
    expect(compositor.stats().waterReflections).toBe(0);
  });
});

/** Luminance grid, the two block reductions and the adaptation step, in this order. */
const EXPOSURE_PASSES = [
  EXPOSURE_LUMINANCE_FRAGMENT_GLSL, EXPOSURE_REDUCE_FRAGMENT_GLSL, EXPOSURE_REDUCE_FRAGMENT_GLSL,
  EXPOSURE_ADAPT_FRAGMENT_GLSL
];

describe("possessed auto-exposure (R11c)", () => {
  const createExposureHarness = (bloom: BloomQuality = "off", exposureMode: ExposureMode = "fps-auto") =>
    createHarness("rgba8", 800, 600, bloom, "off", {}, "off", exposureMode);

  it("leaves the strategic frame on the plain canvas blit (weight 0)", () => {
    const { compositor, renders, resolves } = createExposureHarness();
    compositor.setEyeAdaptation(0);
    compositor.finish(new OrthographicCamera());
    expect(renders).toEqual([]);
    expect(resolves[0]).toMatchObject({ destination: null });
    expect(compositor.stats()).toMatchObject({ exposure: 0, linearOutput: 0 });
  });

  it("binds weight 0 in the strategic linear output while bloom runs", () => {
    const { compositor, exposureWeights, renders } = createExposureHarness("low");
    compositor.finish(new OrthographicCamera());
    expect(renders.some(shader => EXPOSURE_PASSES.includes(shader))).toBe(false);
    expect(renders.at(-1)).toBe(FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL);
    expect(exposureWeights.at(-1)).toBe(0);
  });

  it("measures, adapts and draws the linear output in the possessed eye, even with bloom off", () => {
    const { compositor, exposureWeights, renders } = createExposureHarness();
    compositor.setEyeAdaptation(0.6);
    compositor.finish(new OrthographicCamera());
    expect(renders).toEqual([...EXPOSURE_PASSES, FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL]);
    expect(exposureWeights.at(-1)).toBe(0.6);
    expect(compositor.stats()).toMatchObject({ exposure: 1, linearOutput: 1 });
  });

  it("runs the exposure after the bloom chain and before the output", () => {
    const { compositor, renders } = createExposureHarness("low");
    compositor.setEyeAdaptation(1);
    compositor.finish(new OrthographicCamera());
    expect(renders.slice(-5)).toEqual([...EXPOSURE_PASSES, FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL]);
    expect(renders[0]).toBe(BLOOM_PREFILTER_FRAGMENT_GLSL);
  });

  it("creates no pass on fixed levels and returns to the canvas blit after possession", () => {
    const fixed = createExposureHarness("off", "fixed");
    fixed.compositor.setEyeAdaptation(1);
    fixed.compositor.finish(new OrthographicCamera());
    expect(fixed.renders).toEqual([]);
    expect(fixed.compositor.stats().exposure).toBe(0);
    const auto = createExposureHarness();
    auto.compositor.setEyeAdaptation(1);
    auto.compositor.finish(new OrthographicCamera());
    auto.compositor.setEyeAdaptation(0);
    auto.compositor.finish(new OrthographicCamera());
    expect(auto.renders).toHaveLength(EXPOSURE_PASSES.length + 1);
    expect(auto.resolves.at(-1)).toMatchObject({ destination: null });
  });
});

describe("strength sliders at 0 % (no pass, no target)", () => {
  it("keeps the fixed exposure at Eye adaptation 0 % on an auto level", () => {
    const { compositor, renders, resolves } =
      createHarness("rgba8", 800, 600, "off", "off", {}, "off", "fps-auto", { exposureStrength: 0 });
    compositor.setEyeAdaptation(1);
    compositor.finish(new OrthographicCamera());
    expect(renders).toEqual([]);
    expect(resolves[0]).toMatchObject({ destination: null });
    expect(compositor.stats()).toMatchObject({ exposure: 0, linearOutput: 0 });
  });

  it("compiles the sun shafts into the output only above Sun rays 0 %", () => {
    const shading = Object.fromEntries(
      [...SUN_SHADOW_UNIFORM_NAMES, "uAtmosphereSunTint", "uCloudCover", "uDaylight", "uExplorationFog", "uRain"]
        .map(name => [name, { value: 0 }]));
    const outputDefinesAt = (volumetricLightStrength: number) => {
      const { compositor, outputDefines } = createHarness("rgba8", 800, 600, "low", "off",
        { ...shading, uSunDirection: { value: [0, 1, 0] } }, "off", "fixed",
        { volumetricLight: "fps-half", volumetricLightStrength });
      compositor.finish(new OrthographicCamera());
      expect(compositor.stats().volumetricLight).toBe(0);
      return outputDefines.at(-1);
    };
    expect(outputDefinesAt(1)).toMatchObject({ FRAME_GOD_RAYS: 1 });
    expect(outputDefinesAt(0)).not.toHaveProperty("FRAME_GOD_RAYS");
  });
});
