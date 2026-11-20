import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CustomToneMapping,
  type IUniform,
  MeshStandardMaterial,
  NoToneMapping,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer
} from "three";
import { describe, expect, it } from "vitest";

import { readDevParams } from "../src/app/dev-params";
import {
  readColorExposure,
  readColorToneMapper,
  resolveColorOutput
} from "../src/render-common/color-output";
import { createSharedUniformValues } from "../src/render-common/shader-uniforms";
import { COLOR_OUTPUT_GLSL } from "../src/render-common/shaders/color-output-glsl";
import { installStandardAtmosphere } from "../src/renderers/three/atmosphere/standard-atmosphere";
import {
  createColorOutputControl,
  withLinearColorCapture
} from "../src/renderers/three/color/color-output-control";

const MESH_VERTEX = `
void main() {
  #include <begin_vertex>
  #include <project_vertex>
}`;

const MESH_FRAGMENT = `
void main() {
  vec3 outgoingLight = vec3( 1.0 );
  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}`;

const atmosphereUniforms = (): Record<string, IUniform> => ({
  uAtmosphereProfile: { value: [0, 0, 0, 0] },
  uColorGradeRain: { value: 0 },
  uColorToneMapper: { value: 0 }
});

const compileStandard = (toneMapping: number) => {
  const renderer = { render: () => {}, toneMapping } as unknown as WebGLRenderer;
  const material = new MeshStandardMaterial();
  installStandardAtmosphere(material, atmosphereUniforms(), renderer);
  const shader = {
    fragmentShader: MESH_FRAGMENT,
    uniforms: {},
    vertexShader: MESH_VERTEX
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, renderer);
  return shader.fragmentShader;
};

const listSources = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return listSources(path);
    return path.endsWith(".ts") ? [path] : [];
  });

describe("colour contract settings", () => {
  it("parses the development tonemapper and exposure switches", () => {
    expect(readColorToneMapper("agx")).toBe("agx");
    expect(readColorToneMapper("aces")).toBeNull();
    expect(readColorExposure("1.25")).toBe(1.25);
    expect(readColorExposure("0")).toBeNull();
    expect(readColorExposure("")).toBeNull();
    expect(readDevParams("?tonemap=agx&exposure=1.3")).toEqual({
      colorOutput: { exposure: 1.3, toneMapper: "agx" }
    });
    expect(readDevParams("?tonemap=bogus")).toEqual({ colorOutput: null });
  });

  it("defaults to Neutral at its fitted exposure", () => {
    expect(resolveColorOutput(null)).toEqual({ exposure: 1, toneMapper: "neutral" });
    expect(resolveColorOutput("agx", 1.4)).toEqual({ exposure: 1.4, toneMapper: "agx" });
  });

  it("drives both material families from one renderer setting and one uniform", () => {
    const renderer = { toneMapping: NoToneMapping, toneMappingExposure: 1 } as WebGLRenderer;
    const values = createSharedUniformValues();
    const control = createColorOutputControl(renderer, values, { toneMapper: "agx" });
    expect(renderer.toneMapping).toBe(CustomToneMapping);
    expect(values.uColorToneMapper).toBe(1);
    expect(control.set({ exposure: 1.2 })).toEqual({ exposure: 1.2, toneMapper: "agx" });
    expect(renderer.toneMappingExposure).toBe(1.2);
    expect(control.set({ toneMapper: "neutral" })).toEqual({ exposure: 1, toneMapper: "neutral" });
    expect(values.uColorToneMapper).toBe(0);
    expect(control.set({})).toEqual(control.settings());
  });

  it("restores display output after a linear capture, also when it throws", () => {
    const uniforms = { uColorOutputMode: { value: 0 } };
    const seen: number[] = [];
    expect(() => withLinearColorCapture(uniforms, () => {
      seen.push(uniforms.uColorOutputMode.value);
      throw new Error("capture failed");
    })).toThrow("capture failed");
    expect(seen).toEqual([1]);
    expect(uniforms.uColorOutputMode.value).toBe(0);
  });
});

describe("colour contract shader wiring", () => {
  it("keeps linear radiance in captures and grades display output once", () => {
    expect(COLOR_OUTPUT_GLSL).toContain("if (colorIsLinearCapture()) return max(radiance, vec3(0.0));");
    expect(COLOR_OUTPUT_GLSL).toContain(
      "return colorFinishOutput(colorSrgbEncode(colorToneMap(radiance)));"
    );
    expect(COLOR_OUTPUT_GLSL).toContain("const float COLOR_NEUTRAL_TOE_F0 = 0.0000;");
  });

  it("appends the shared tail to built-in screen programs of a contract renderer only", () => {
    const contract = compileStandard(CustomToneMapping);
    const toneTail = contract.indexOf("gl_FragColor.rgb = colorToneMap( gl_FragColor.rgb );");
    const gradeTail = contract.indexOf("gl_FragColor.rgb = colorFinishOutput( gl_FragColor.rgb );");
    expect(toneTail).toBeGreaterThan(contract.indexOf("#include <tonemapping_fragment>"));
    expect(gradeTail).toBeGreaterThan(contract.indexOf("#include <colorspace_fragment>"));
    expect(gradeTail).toBeLessThan(contract.indexOf("#include <premultiplied_alpha_fragment>"));
    expect(contract).toContain("#if defined( TONE_MAPPING )");
    const legacy = compileStandard(NoToneMapping);
    expect(legacy).not.toContain("colorToneMap");
    expect(legacy).toContain("composeAtmosphereLinear");
  });

  it("leaves no second grade or display-space fog anywhere in the renderer", () => {
    const sources = listSources(fileURLToPath(new URL("../src", import.meta.url)))
      .map((path) => readFileSync(path, "utf8"));
    const legacyNames = [/\bgradeColor\(/, /\bGRADE_GLSL\b/, /composeAtmosphereLegacy/, /\buAtmosphereAirlight;/];
    for (const legacy of legacyNames)
      expect(sources.filter((source) => legacy.test(source))).toEqual([]);
  });
});
