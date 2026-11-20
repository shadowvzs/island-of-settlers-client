import { type IUniform, MeshBasicMaterial, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";

import { readDevParams } from "../src/app/dev-params";
import { COLOR_GRADE, COLOR_OUTPUT_MODE } from "../src/render-common/color-output";
import {
  BLOOM_QUALITIES,
  QUALITY_PRESETS,
  readBloomQuality,
  readSceneTarget
} from "../src/render-common/quality";
import {
  getBloomChoice,
  parseQualityOverrides,
  resolveQualityPreset,
  setBloomChoice
} from "../src/render-common/quality-overrides";
import {
  BLOOM_DOWNSAMPLE_FRAGMENT_GLSL,
  BLOOM_PREFILTER_FRAGMENT_GLSL,
  BLOOM_TUNING,
  BLOOM_UPSAMPLE_FRAGMENT_GLSL
} from "../src/render-common/shaders/frame-bloom-glsl";
import {
  COLOR_AGX_MATRICES,
  COLOR_DISPLAY_UNIFORM_NAMES,
  COLOR_MODE_GLSL,
  COLOR_OUTPUT_GLSL,
  COLOR_TONE_MAP_INVERSE_GLSL,
  COLOR_TRANSFORM_GLSL,
  type Columns3,
  columns3ToGlsl,
  DISPLAY_COLOR_OUTPUT_GLSL,
  invertColumns3
} from "../src/render-common/shaders/color-output-glsl";
import {
  FRAME_COPY_FRAGMENT_GLSL,
  FRAME_OUTPUT_FRAGMENT_GLSL,
  FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL
} from "../src/render-common/shaders/frame-output-glsl";
import { applyStandardAtmosphereShader } from "../src/renderers/three/atmosphere/standard-atmosphere-shader";
import {
  pickColorDisplayUniforms,
  withColorOutputMode
} from "../src/renderers/three/color/color-output-control";
import { EXPLORATION_SUN_GLSL } from "../src/renderers/three/exploration-weather/exploration-sun-glsl";
import { bloomMipSize, createFrameBloom } from "../src/renderers/three/frame-bloom";
import { createFrameCompositor } from "../src/renderers/three/frame-compositor";

const LUMA = [0.299, 0.587, 0.114] as const;
type Rgb = [number, number, number];

/** The GLSL AgX constants, mirrored for the inverse tonemapper round trip (R11a). */
const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;
const BAR_COLORS: Rgb[] = [[0.82, 0.15, 0.055], [0.95, 0.78, 0.35], [0.26, 0.72, 0.24]];

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const channel = (values: readonly number[], at: number) => values[at]!;

/** Column-major matrix product: column j of the result is `a` applied to column j of `b`. */
const applyColumns3 = (columns: Columns3, vector: Rgb): Rgb => {
  const [x, y, z] = vector;
  const [c0, c1, c2] = columns;
  return [
    channel(c0, 0) * x + channel(c1, 0) * y + channel(c2, 0) * z,
    channel(c0, 1) * x + channel(c1, 1) * y + channel(c2, 1) * z,
    channel(c0, 2) * x + channel(c1, 2) * y + channel(c2, 2) * z
  ];
};
const multiplyColumns3 = (left: Columns3, right: Columns3): Columns3 => [
  applyColumns3(left, [channel(right[0], 0), channel(right[0], 1), channel(right[0], 2)]),
  applyColumns3(left, [channel(right[1], 0), channel(right[1], 1), channel(right[1], 2)]),
  applyColumns3(left, [channel(right[2], 0), channel(right[2], 1), channel(right[2], 2)])
];
const channelError = (actual: Rgb, expected: Rgb) =>
  Math.max(...actual.map((value, index) => Math.abs(value - expected[index]!)));
const pair = (actual: Rgb, expected: Rgb): [Rgb, Rgb] => [actual, expected];
/** The largest channel difference of a list of actual/expected pairs: one assertion per round trip. */
const maxError = (pairs: Array<[Rgb, Rgb]>) =>
  Math.max(...pairs.map(([actual, expected]) => channelError(actual, expected)));

/** Deterministic random colours: a fixed sequence cannot flake. */
const randomColors = (count: number): Rgb[] => {
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  return Array.from({ length: count }, () => [next(), next(), next()] as Rgb);
};

const neutralToneMap = (color: Rgb): Rgb => {
  const peak = Math.max(...color);
  if (peak < 0.76) return color;
  const newPeak = 1 - 0.24 * 0.24 / (peak - 0.52);
  const scaled = color.map(value => value * newPeak / peak);
  const blend = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return scaled.map(value => value * (1 - blend) + newPeak * blend) as Rgb;
};
const neutralToneMapInverse = (mapped: Rgb): Rgb => {
  const newPeak = Math.min(Math.max(...mapped), 0.9999);
  if (newPeak < 0.76) return mapped;
  const peak = 0.24 * 0.24 / (1 - newPeak) - 0.24 + 0.76;
  const blend = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  const scaled = mapped.map(value => (Math.min(value, newPeak) - blend * newPeak) /
    Math.max(1 - blend, 1e-4));
  return scaled.map(value => value * peak / newPeak) as Rgb;
};

/** The GLSL polynomial with its exact operation order (x2/x4 factoring). */
const agxContrast = (value: number) => {
  const x2 = value * value;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * value + 31.96 * x4 - 6.868 * x2 * value +
    0.4298 * x2 + 0.1191 * value - 0.00232;
};
const agxContrastInverse = (value: number) => {
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 16; iteration++) {
    const middle = 0.5 * (lower + upper);
    if (agxContrast(middle) < value) lower = middle;
    else upper = middle;
  }
  return 0.5 * (lower + upper);
};
const agxToneMap = (color: Rgb): Rgb => {
  const inset = applyColumns3(COLOR_AGX_MATRICES.inset,
    applyColumns3(COLOR_AGX_MATRICES.srgbToRec2020, color));
  const logEv = inset.map(value => Math.log2(Math.max(value, 1e-10)));
  const normalized = logEv.map(value => clamp01((value - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV)));
  const contrasted = applyColumns3(COLOR_AGX_MATRICES.outset, normalized.map(agxContrast) as Rgb);
  const powered = contrasted.map(value => Math.max(value, 0) ** 2.2);
  return applyColumns3(COLOR_AGX_MATRICES.rec2020ToSrgb, powered as Rgb).map(clamp01) as Rgb;
};
const agxToneMapInverse = (mapped: Rgb): Rgb => {
  const srgb = applyColumns3(invertColumns3(COLOR_AGX_MATRICES.rec2020ToSrgb), mapped);
  const powered = srgb.map(value => Math.max(value, 0) ** (1 / 2.2));
  const outset = applyColumns3(invertColumns3(COLOR_AGX_MATRICES.outset), powered as Rgb);
  const contrast = outset.map(agxContrastInverse) as Rgb;
  const ev = contrast.map(value => 2 ** (value * (AGX_MAX_EV - AGX_MIN_EV) + AGX_MIN_EV));
  const inset = applyColumns3(invertColumns3(COLOR_AGX_MATRICES.inset), ev as Rgb);
  return applyColumns3(invertColumns3(COLOR_AGX_MATRICES.srgbToRec2020), inset);
};
const toneMapInverse = (mapped: Rgb, weight: number, exposure = 1): Rgb => {
  let radiance = neutralToneMapInverse(mapped);
  if (weight > 0.999) radiance = agxToneMapInverse(mapped);
  else if (weight >= 0.001) {
    const agx = agxToneMapInverse(mapped);
    radiance = radiance.map((value, index) => value + (agx[index]! - value) * weight) as Rgb;
  }
  return radiance.map(value => value / Math.max(exposure, 1e-4)) as Rgb;
};

/** The GLSL grade (colorGrade without its clamp) and its inverse, mirrored for the algebra. */
const grade = (color: Rgb, saturation: number): Rgb => {
  const luma = color.reduce((sum, value, index) => sum + value * LUMA[index]!, 0);
  return color.map(value => ((luma + (value - luma) * saturation) - 0.5) * COLOR_GRADE.contrast + 0.5) as Rgb;
};
const gradeInverse = (graded: Rgb, saturation: number): Rgb => {
  const saturated = graded.map(value => (value - 0.5) / COLOR_GRADE.contrast + 0.5);
  const luma = saturated.reduce((sum, value, index) => sum + value * LUMA[index]!, 0);
  return saturated.map(value => luma + (value - luma) / saturation) as Rgb;
};

describe("scene target settings", () => {
  it("is a Medium/High feature at no extra bandwidth; Low and Minimal keep the direct canvas path", () => {
    expect(QUALITY_PRESETS.high.sceneTarget).toBe("rgba8");
    expect(QUALITY_PRESETS.medium.sceneTarget).toBe("rgba8");
    expect(QUALITY_PRESETS.low.sceneTarget).toBe("off");
    expect(QUALITY_PRESETS.minimal.sceneTarget).toBe("off");
  });

  it("reads the development A/B switch", () => {
    expect(readSceneTarget("rgba16f")).toBe("rgba16f");
    expect(readSceneTarget("1")).toBe("rgba16f");
    expect(readSceneTarget("0")).toBe("off");
    expect(readSceneTarget("rgba8")).toBe("rgba8");
    expect(readSceneTarget("toString")).toBeNull();
    expect(readSceneTarget(null)).toBeNull();
    expect(readDevParams("?hdr=rgba8")).toEqual({ sceneTarget: "rgba8" });
    expect(readDevParams("?hdr=bogus")).toEqual({ sceneTarget: null });
  });

  it("keeps display output as the unbound default mode", () => {
    expect(COLOR_OUTPUT_MODE).toEqual({ display: 0, linearCapture: 1, scene: 2 });
  });
});

describe("HDR scene target shaders", () => {
  it("tonemaps per fragment and leaves the grade to the output pass", () => {
    expect(COLOR_OUTPUT_GLSL).toContain("return colorFinishOutput(colorSrgbEncode(colorToneMap(radiance)));");
    expect(COLOR_MODE_GLSL).toContain("return colorIsSceneTarget() ? display : colorFinishDisplay(display);");
    expect(COLOR_MODE_GLSL).toContain("return colorIsSceneTarget() ? colorGradeInverse(display) : display;");
  });

  it("grades and dithers rgba16f once in the output pass, without a second tonemapper", () => {
    const main = FRAME_OUTPUT_FRAGMENT_GLSL.slice(FRAME_OUTPUT_FRAGMENT_GLSL.indexOf("void main()"));
    expect(main).toContain("fragColor = vec4(colorFinishDisplay(scene.rgb), scene.a);");
    expect(main).not.toContain("colorToneMap");
  });

  it("copies the rgba8 target (display pixels and canvas alpha as before)", () => {
    expect(FRAME_COPY_FRAGMENT_GLSL).toContain("fragColor = fetchScene(ivec2(gl_FragCoord.xy));");
    // Without FRAME_WATER_REFLECTION (R18b) the fetch is the plain texel.
    expect(FRAME_COPY_FRAGMENT_GLSL).toContain("vec4 scene = texelFetch(uScene, pixel, 0);");
  });

  it("keeps the post-tonemap sun and the linear refraction capture", () => {
    const output = EXPLORATION_SUN_GLSL.slice(EXPLORATION_SUN_GLSL.indexOf("vec3 explorationSunOutput("));
    const linearCapture = output.indexOf(
      "if (colorIsLinearCapture()) return max(skyRadiance + sunRadiance + glowRadiance, vec3(0.0));"
    );
    // The capture returns plain linear sky + sun + cloud glow before any tonemap, shoulder or display cap,
    // so water refraction never sees the capped dusk rims (cloud-redo 2026-11-16).
    expect(linearCapture).toBeGreaterThan(-1);
    for (const displayStep of ["colorToneMap(", "headroom * sun / (sun + knee)", "SUN_CLOUD_GLOW_PEAK"])
      expect(output.indexOf(displayStep)).toBeGreaterThan(linearCapture);
    expect(output).toContain("vec3 lit = sky + headroom * sun / (sun + knee);");
    expect(output).toContain("return colorFinishOutput(colorSrgbEncode(lit));");
  });

  it("ends built-in programs with the scene-aware tail, display colours with their inverse", () => {
    const shader = {
      fragmentShader: `void main() {
  vec3 outgoingLight = vec3( 1.0 );
  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      uniforms: {},
      vertexShader: "void main() {\n  #include <project_vertex>\n}"
    };
    applyStandardAtmosphereShader(new MeshBasicMaterial(), {}, shader as never, true);
    expect(shader.fragmentShader).toContain("gl_FragColor.rgb = colorFinishOutput( gl_FragColor.rgb );");
    expect(shader.fragmentShader).toContain("gl_FragColor.rgb = colorDisplayOutput( gl_FragColor.rgb );");
    expect(shader.fragmentShader).toContain("uniform float uColorOutputMode;");
  });

  it("restores a feedback colour exactly through the output pass's grade", () => {
    for (const saturation of [1.12 * 1.1, 1.12, 1.12 - 0.3]) {
      for (const color of [[0.82, 0.15, 0.055], [0.95, 0.78, 0.35], [0.26, 0.72, 0.24]] as Rgb[]) {
        const restored = grade(gradeInverse(color, saturation), saturation);
        restored.forEach((value, index) => expect(value).toBeCloseTo(color[index]!, 6));
      }
    }
    expect(DISPLAY_COLOR_OUTPUT_GLSL).toContain("vec3 colorGradeInverse(vec3 graded)");
  });
});

describe("linear radiance from the scene target (R11a)", () => {
  it("inverts the four AgX matrices by cofactors", () => {
    const identity: Columns3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const matrix of Object.values(COLOR_AGX_MATRICES)) {
      const product = multiplyColumns3(invertColumns3(matrix), matrix);
      product.forEach((column, index) =>
        expect(channelError(column as Rgb, identity[index] as Rgb)).toBeLessThanOrEqual(1e-12));
    }
  });

  it("generates the forward and inverse matrix GLSL from the same column numbers", () => {
    const glsl = columns3ToGlsl(COLOR_AGX_MATRICES.srgbToRec2020);
    expect(glsl.startsWith("mat3(\n")).toBe(true);
    expect(glsl).toContain("vec3(0.6274, 0.0691, 0.0164)");
    expect(glsl).toContain("vec3(0.0433, 0.0113, 0.8956)");
    expect(COLOR_TRANSFORM_GLSL).toContain("const mat3 COLOR_AGX_INSET = mat3(");
    expect(COLOR_TONE_MAP_INVERSE_GLSL).toContain("const mat3 COLOR_AGX_INSET_INVERSE = mat3(");
    expect(COLOR_TONE_MAP_INVERSE_GLSL).toContain("const mat3 COLOR_AGX_OUTSET_INVERSE = mat3(");
  });

  it("writes matrices as GLSL floats, also when a value is an integer", () => {
    expect(columns3ToGlsl([[1, 0, 0], [0, 1, 0], [0, 0, 1]]))
      .toBe("mat3(\n  vec3(1.0, 0.0, 0.0),\n  vec3(0.0, 1.0, 0.0),\n  vec3(0.0, 0.0, 1.0)\n)");
  });

  it("round-trips the Neutral inverse exactly", () => {
    const colors = [...randomColors(300), ...BAR_COLORS];
    expect(maxError(colors.map(color => pair(neutralToneMapInverse(neutralToneMap(color)), color))))
      .toBeLessThanOrEqual(1e-12);
    expect(maxError(colors.map(color => pair(neutralToneMap(neutralToneMapInverse(color)), color))))
      .toBeLessThanOrEqual(1e-12);
  });

  it("round-trips the AgX inverse within the bisection tolerance", () => {
    const colors = [...randomColors(300), ...BAR_COLORS];
    expect(maxError(colors.map(color => pair(agxToneMapInverse(agxToneMap(color)), color))))
      .toBeLessThanOrEqual(3e-4);
    expect(maxError(colors.map(color => pair(agxToneMap(agxToneMapInverse(color)), color))))
      .toBeLessThanOrEqual(3e-4);
  });

  it("inverts the tone weight endpoints and undoes the exposure", () => {
    expect(maxError(BAR_COLORS.map(color => pair(toneMapInverse(neutralToneMap(color), 0), color))))
      .toBeLessThanOrEqual(1e-12);
    expect(maxError(BAR_COLORS.map(color => pair(toneMapInverse(agxToneMap(color), 1), color))))
      .toBeLessThanOrEqual(3e-4);
    expect(maxError(BAR_COLORS.map(color => {
      const exposed = color.map(value => value * 1.7) as Rgb;
      return pair(toneMapInverse(neutralToneMap(exposed), 0, 1.7), color);
    }))).toBeLessThanOrEqual(1e-12);
  });

  it("lets the linear output pass read radiance, add bloom and tonemap again", () => {
    expect(FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL).toContain("vec3 linear = colorSceneToLinear(scene.rgb);");
    expect(FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL).toContain(
      "linear += uBloom * texture(uBloomTexture, gl_FragCoord.xy / vec2(textureSize(uScene, 0))).rgb;"
    );
    expect(FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL).toContain(
      "fragColor = vec4(colorFinishDisplay(colorSrgbEncode(colorToneMap(linear))), scene.a);"
    );
    expect(COLOR_TONE_MAP_INVERSE_GLSL).toContain("#ifdef COLOR_SCENE_GRADED");
    expect(COLOR_TONE_MAP_INVERSE_GLSL).toContain("for (int iteration = 0; iteration < 16; iteration++)");
    expect(COLOR_TONE_MAP_INVERSE_GLSL).toContain(
      "return radiance / max(toneMappingExposure, 1e-4);"
    );
  });
});

describe("HDR bloom (R11b)", () => {
  it("is a High/Medium feature: 5 mips on High, 3 on Medium, off on Low and Minimal", () => {
    expect(QUALITY_PRESETS.high.bloom).toBe("on");
    expect(QUALITY_PRESETS.medium.bloom).toBe("low");
    expect(QUALITY_PRESETS.low.bloom).toBe("off");
    expect(QUALITY_PRESETS.minimal.bloom).toBe("off");
    expect(BLOOM_QUALITIES).toEqual(["off", "low", "on"]);
    expect(BLOOM_TUNING.mipCounts).toEqual({ low: 3, off: 0, on: 5 });
  });

  it("reads the development A/B switch", () => {
    expect(readBloomQuality("on")).toBe("on");
    expect(readBloomQuality("low")).toBe("low");
    expect(readBloomQuality("off")).toBe("off");
    expect(readBloomQuality("bogus")).toBeNull();
    expect(readBloomQuality(null)).toBeNull();
    expect(readDevParams("?bloom=low")).toEqual({ bloom: "low" });
  });

  it("stores only a bloom choice that differs from the level default", () => {
    expect(getBloomChoice("high", {})).toBe("on");
    expect(getBloomChoice("minimal", { bloom: "low" })).toBe("low");
    expect(setBloomChoice("high", {}, "off")).toEqual({ bloom: "off" });
    expect(setBloomChoice("high", { bloom: "off" }, "on")).toEqual({});
    expect(resolveQualityPreset("high", { bloom: "off" }).bloom).toBe("off");
    expect(parseQualityOverrides('{"bloom":"low"}')).toEqual({ bloom: "low" });
    expect(parseQualityOverrides('{"bloom":"bogus"}')).toEqual({});
  });

  it("selects bright texels by display brightness and keeps Karis on the first downsample only", () => {
    expect(BLOOM_PREFILTER_FRAGMENT_GLSL).toContain(
      "float selected = smoothstep(threshold, threshold + uBloomRamp.y, brightness);"
    );
    expect(BLOOM_PREFILTER_FRAGMENT_GLSL).toContain("if (selected <= 0.0) return vec3(0.0);");
    // The threshold is blended per frame on the CPU (bloom-phases.ts); the tint is one multiply.
    expect(BLOOM_PREFILTER_FRAGMENT_GLSL).toContain("float threshold = uBloomRamp.x;");
    expect(BLOOM_PREFILTER_FRAGMENT_GLSL).toContain("fragColor = vec4(sum * (0.25 * uBloomTint), 1.0);");
    expect(BLOOM_PREFILTER_FRAGMENT_GLSL).not.toContain("uDaylight");
    expect(BLOOM_PREFILTER_FRAGMENT_GLSL).toContain("#ifdef COLOR_SCENE_GRADED");
    expect(BLOOM_PREFILTER_FRAGMENT_GLSL).not.toContain("BLOOM_TAPS");
    expect(BLOOM_PREFILTER_FRAGMENT_GLSL).not.toContain("bloomKarisWeight");
    expect(BLOOM_DOWNSAMPLE_FRAGMENT_GLSL).toContain("BLOOM_TAPS[13]");
    expect(BLOOM_DOWNSAMPLE_FRAGMENT_GLSL).toContain("#ifdef BLOOM_KARIS");
    expect(BLOOM_DOWNSAMPLE_FRAGMENT_GLSL).toContain("float tapWeight = bloomKarisWeight(tap);");
    expect(BLOOM_DOWNSAMPLE_FRAGMENT_GLSL).toContain("/ uBloomKarisLuma");
    expect(BLOOM_UPSAMPLE_FRAGMENT_GLSL).not.toContain("bloomKarisWeight");
    expect(BLOOM_UPSAMPLE_FRAGMENT_GLSL).toContain("uniform float uRadius;");
    expect(BLOOM_UPSAMPLE_FRAGMENT_GLSL).toContain("uniform float uWeight;");
  });

  it("keeps the night threshold below the sunlit ones and every tent level tuned", () => {
    const { phaseRamp, phases, upsampleRadii, upsampleWeights } = BLOOM_TUNING;
    expect(phases.night.threshold).toBeLessThan(phases.golden.threshold);
    expect(phases.golden.threshold).toBeLessThanOrEqual(phases.day.threshold);
    expect(phaseRamp.daylightFull).toBeGreaterThan(0);
    expect(upsampleRadii).toHaveLength(BLOOM_TUNING.mipCounts.on);
    expect(upsampleWeights).toHaveLength(BLOOM_TUNING.mipCounts.on);
  });

  it("wires the bloom texture into the linear output pass", () => {
    expect(FRAME_OUTPUT_LINEAR_FRAGMENT_GLSL).toContain(
      "linear += uBloom * texture(uBloomTexture, gl_FragCoord.xy / vec2(textureSize(uScene, 0))).rgb;"
    );
  });

  it("sizes the mip chain at half, quarter and smaller of the drawing buffer", () => {
    expect([0, 1, 2, 3, 4].map(level => bloomMipSize(1920, 1080, level))).toEqual([
      [960, 540], [480, 270], [240, 135], [120, 67], [60, 33]
    ]);
    expect(bloomMipSize(8, 8, 9)).toEqual([1, 1]);
  });

  it("creates the half-float chain only for a real mip count on float-capable GPUs", () => {
    const renderer = { extensions: { has: () => true } } as unknown as WebGLRenderer;
    const tuning = BLOOM_TUNING;
    expect(createFrameBloom(renderer, {}, { graded: true, height: 1080, mips: 0, tuning,
      width: 1920 })).toBeNull();
    const chain = createFrameBloom(renderer, {}, { graded: true, height: 1080, mips: 5, tuning,
      width: 1920 })!;
    expect(chain.levels).toBe(5);
    expect(chain.mipSizes()).toEqual([[960, 540], [480, 270], [240, 135], [120, 67], [60, 33]]);
    chain.dispose();
    const noFloat = { extensions: { has: () => false } } as unknown as WebGLRenderer;
    expect(createFrameBloom(noFloat, {}, { graded: true, height: 1080, mips: 3, tuning,
      width: 1920 })).toBeNull();
  });
});

describe("HDR scene target binding", () => {
  it("restores the previous output mode after a scene pass, also when it throws", () => {
    const uniforms = { uColorOutputMode: { value: COLOR_OUTPUT_MODE.display } };
    expect(() => withColorOutputMode(uniforms, COLOR_OUTPUT_MODE.scene, () => {
      expect(uniforms.uColorOutputMode.value).toBe(COLOR_OUTPUT_MODE.scene);
      throw new Error("layer failed");
    })).toThrow("layer failed");
    expect(uniforms.uColorOutputMode.value).toBe(COLOR_OUTPUT_MODE.display);
  });

  it("binds the shared colour uniforms of feedback shaders by identity", () => {
    const shared: Record<string, IUniform> = Object.fromEntries(
      [...COLOR_DISPLAY_UNIFORM_NAMES, "uTime"].map(name => [name, { value: 0 }])
    );
    const picked = pickColorDisplayUniforms(shared);
    expect(Object.keys(picked).sort()).toEqual([...COLOR_DISPLAY_UNIFORM_NAMES].sort());
    for (const name of COLOR_DISPLAY_UNIFORM_NAMES) expect(picked[name]).toBe(shared[name]);
    expect(pickColorDisplayUniforms({})).toEqual({});
  });

  it("falls back to the direct canvas path without float colour buffers for rgba16f", () => {
    const renderer = { extensions: { has: () => false } } as unknown as WebGLRenderer;
    const uniforms = { uColorOutputMode: { value: 0 } };
    expect(createFrameCompositor(renderer, uniforms, { ambientOcclusion: "off", antialias: true, bloom: "off", format: "rgba16f" }))
      .toBeNull();
    expect(createFrameCompositor(renderer, {}, { ambientOcclusion: "off", antialias: true, bloom: "off", format: "rgba8" }))
      .toBeNull();
  });
});
