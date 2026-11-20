import { afterEach, describe, expect, it, vi } from "vitest";

import { readAppParams } from "../src/app/app-params";
import { readDevParams } from "../src/app/dev-params";
import { formatExtensions, formatPrecision } from "../src/app/gl-debug/gl-debug-info";
import { getGlIssues, readShaderName } from "../src/render-common/gl-diagnostics";
import type { GlLimits } from "../src/render-common/gl-limits";
import {
  chooseGroundShader,
  createGroundShaderState,
  describeGround,
  findExceededLimits,
  FULL_GROUND_NEEDS,
  GROUND_SHADER_MARKER,
  readGroundShaderRequest
} from "../src/render-common/ground-shader-variant";
import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";

/** WebGL2 guaranteed minimums (a weak phone). */
const WEBGL2_MINIMUM: GlLimits = {
  maxFragmentUniformVectors: 224,
  maxTextureImageUnits: 16,
  maxTextureSize: 2048,
  maxVaryingVectors: 15,
  maxVertexAttribs: 16
};
const NEEDS = { ...FULL_GROUND_NEEDS, layerSize: 1728 };

describe("ground shader variant", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads ?ground=, auto otherwise", () => {
    expect(readGroundShaderRequest("lite")).toBe("lite");
    expect(readGroundShaderRequest("full")).toBe("full");
    expect(readGroundShaderRequest(null)).toBe("auto");
    expect(readGroundShaderRequest("x")).toBe("auto");
    expect(readDevParams("?ground=lite&gldebug=1")).toMatchObject({
      glDebug: true,
      ground: "lite"
    });
    expect(readAppParams("")).toMatchObject({ glDebug: false, glEmulate: null, ground: "auto" });
    expect(readDevParams("?glemulate=mali").glEmulate).toBe("mali");
  });

  it("the full ground fits the WebGL2 minimums", () => {
    expect(findExceededLimits(WEBGL2_MINIMUM, NEEDS)).toEqual([]);
    expect(chooseGroundShader("auto", WEBGL2_MINIMUM, NEEDS)).toEqual({
      reason: null,
      variant: "full"
    });
  });

  it("chooses lite when a limit is exceeded, naming it", () => {
    const weak = { ...WEBGL2_MINIMUM, maxTextureSize: 1024, maxVaryingVectors: 7 };
    expect(findExceededLimits(weak, NEEDS)).toEqual([
      "texture size 1728 > 1024",
      "varying vectors 9 > 7"
    ]);
    expect(chooseGroundShader("auto", weak, NEEDS).variant).toBe("lite");
  });

  it("follows a forced request", () => {
    expect(chooseGroundShader("lite", WEBGL2_MINIMUM, NEEDS).variant).toBe("lite");
    const weak = { ...WEBGL2_MINIMUM, maxTextureImageUnits: 4 };
    expect(chooseGroundShader("full", weak, NEEDS).variant).toBe("full");
  });

  it("steps down to lite once, then reports the ground as failed", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const state = createGroundShaderState({ reason: null, variant: "full" });
    expect(describeGround(state)).toEqual({});
    expect(state.fail("ERROR: too complex\0")).toBe("lite");
    expect(state.variant).toBe("lite");
    expect(describeGround(state)).toEqual({ ground: "lite (full shader failed)" });
    expect(state.fail("ERROR: still")).toBeNull();
    expect(state.describe()).toMatch(/FAILED/);
    const reported = getGlIssues().filter(({ kind }) => kind === "ground");
    expect(reported.map(({ log }) => log)).toEqual(["ERROR: too complex", "ERROR: still"]);
  });
});

describe("ground shader GLSL", () => {
  it("both variants define the marked sampleGround and lightGround", () => {
    for (const glsl of Object.values(GROUND_VARIANT_GLSL)) {
      expect(glsl).toContain(GROUND_SHADER_MARKER);
      expect(glsl).toContain("vec3 lightGround(");
    }
  });

  it("the lite ground has no loops, arrays or integer ops", () => {
    const lite = GROUND_VARIANT_GLSL.lite;
    expect(lite).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
    expect(lite).not.toMatch(/\[/);
    expect(lite).not.toMatch(/\bint\b/);
    expect(lite.match(/addLite(?:Rock)?Layer\(albedo/g)).toHaveLength(9);
  });
});

describe("GL diagnostics", () => {
  it("names shaders by SHADER_NAME, else by their first declaration", () => {
    expect(readShaderName("#define SHADER_NAME island-terrain-full\nvoid main(){}")).toBe(
      "island-terrain-full"
    );
    expect(readShaderName("precision highp float;\nin vec3 vWorld;")).toBe(
      'shader with "in vec3 vWorld"'
    );
    expect(readShaderName("void main(){}")).toBe("unnamed shader");
  });

  it("formats precision and extensions", () => {
    const highp = { precision: 23, rangeMax: 127, rangeMin: 127 } as WebGLShaderPrecisionFormat;
    expect(formatPrecision(highp)).toBe("2^-127..2^127, 23 bits");
    const none = { precision: 0, rangeMax: 0, rangeMin: 0 } as WebGLShaderPrecisionFormat;
    expect(formatPrecision(none)).toBe("not supported");
    expect(formatExtensions(["B"], ["A", "B"])).toBe("+B -A");
  });
});
