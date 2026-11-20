import { createElement } from "react";
import { MeshStandardMaterial, ShaderChunk } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { settingsStorage } from "../src/app/settings/graphics-settings";
import { GraphicsSection } from "../src/app/settings/sections/graphics-section";
import {
  clampHighlights,
  DEFAULT_HIGHLIGHTS,
  FOAM_GLARE_FLOOR,
  formatHighlights,
  NEUTRAL_HIGHLIGHTS,
  parseHighlights,
  scaleBloomByHighlights
} from "../src/render-common/highlights";
import {
  createSharedUniformValues,
  SCALAR_UNIFORMS
} from "../src/render-common/shader-uniforms";
import { COMMON_UNIFORMS_GLSL, LIGHTING_GLSL } from "../src/render-common/shaders/common-glsl";
import { LEAF_LIGHT_GLSL } from "../src/render-common/shaders/leaf-glsl";
import { WATER_FOAM_GLSL, WATER_GLSL } from "../src/render-common/shaders/water-glsl";
import { applyStandardAtmosphereShader } from "../src/renderers/three/atmosphere/standard-atmosphere-shader";
import { createThreeUniforms } from "../src/renderers/three/three-materials";
import { renderWithI18n } from "./helpers/render-with-i18n";

const HIGHLIGHTS_KEY = "island-of-settlers.graphics.highlights";

const stubStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  return values;
};

afterEach(() => vi.unstubAllGlobals());

describe("highlights strength", () => {
  it("defaults to the owner's 75 % for missing or invalid values", () => {
    expect(DEFAULT_HIGHLIGHTS).toBe(0.75);
    expect(parseHighlights(null)).toBe(0.75);
    expect(parseHighlights("")).toBe(0.75);
    expect(parseHighlights("bright")).toBe(0.75);
    expect(clampHighlights(Number.NaN)).toBe(0.75);
  });

  it("reads stored percents and clamps them to 0..1", () => {
    expect(parseHighlights("60")).toBeCloseTo(0.6);
    expect(parseHighlights("0")).toBe(0);
    expect(parseHighlights("140")).toBe(1);
    expect(parseHighlights("-5")).toBe(0);
  });

  it("stores whole percents", () => {
    expect(formatHighlights(0.3)).toBe("30");
    expect(formatHighlights(0.604)).toBe("60");
    expect(formatHighlights(2)).toBe("100");
  });

  it("persists through the settings storage", () => {
    const values = stubStorage();
    expect(settingsStorage.readHighlights()).toBe(0.75);
    settingsStorage.writeHighlights(0.3);
    expect(values.get(HIGHLIGHTS_KEY)).toBe("30");
    expect(settingsStorage.readHighlights()).toBeCloseTo(0.3);
  });

  it("keeps an explicitly stored value, 100 % included", () => {
    stubStorage({ [HIGHLIGHTS_KEY]: "100" });
    expect(settingsStorage.readHighlights()).toBe(1);
  });

  it("scales the bloom share linearly and leaves 100 % untouched", () => {
    expect(scaleBloomByHighlights(0.18, 1)).toBe(0.18);
    expect(scaleBloomByHighlights(0.18, 0.5)).toBeCloseTo(0.09);
    expect(scaleBloomByHighlights(0.18, 0)).toBe(0);
  });
});

describe("highlights uniform", () => {
  it("is a shared scalar uniform, neutral (1) outside the game and bound by every shared material", () => {
    const values = createSharedUniformValues();
    expect(NEUTRAL_HIGHLIGHTS).toBe(1);
    expect(values.uHighlight).toBe(1);
    expect(SCALAR_UNIFORMS).toContain("uHighlight");
    expect(createThreeUniforms(values).uHighlight?.value).toBe(1);
    expect(COMMON_UNIFORMS_GLSL).toContain("uniform float uHighlight;");
  });

  it("scales glints, rain sheen and leaf sheen and dims the foam only down to its floor", () => {
    expect(WATER_GLSL.match(/glint \/ \(0\.\d \+ glint\)\) \* uHighlight/g)).toHaveLength(2);
    expect(WATER_FOAM_GLSL).toContain(`FOAM_GLARE_FLOOR = ${FOAM_GLARE_FLOOR.toFixed(2)}`);
    expect(WATER_FOAM_GLSL).toContain("mix(FOAM_GLARE_FLOOR, 1.0, uHighlight)");
    expect(WATER_GLSL).toContain("* foamGlare(), foamCover)");
    expect(LIGHTING_GLSL).toContain("sheen * uRain * uHighlight");
    expect(LEAF_LIGHT_GLSL).toContain("sheen * 0.05 * uHighlight");
  });

  it("scales the direct specular of built-in materials and falls back to 1 without the setting", () => {
    const shader = {
      fragmentShader: ShaderChunk.meshphysical_frag,
      uniforms: {},
      vertexShader: ShaderChunk.meshphysical_vert
    };
    applyStandardAtmosphereShader(new MeshStandardMaterial(), {}, shader as never);
    expect(shader.fragmentShader).toContain("uniform float uHighlight;");
    expect(shader.fragmentShader).toMatch(
      /#include <aomap_fragment>\s*reflectedLight\.directSpecular \*= uHighlight;/
    );
    expect((shader.uniforms as Record<string, { value: number }>).uHighlight?.value).toBe(1);
  });

  it("binds the shared uniform object, so a slider move needs no recompile", () => {
    const uniforms = createThreeUniforms(createSharedUniformValues());
    const shader = {
      fragmentShader: ShaderChunk.meshphysical_frag,
      uniforms: {},
      vertexShader: ShaderChunk.meshphysical_vert
    };
    applyStandardAtmosphereShader(new MeshStandardMaterial(), uniforms, shader as never);
    expect((shader.uniforms as Record<string, unknown>).uHighlight).toBe(uniforms.uHighlight);
  });
});

describe("highlights slider", () => {
  const renderSection = (highlights: number, locale?: "hu") => renderWithI18n(createElement(GraphicsSection, {
    applyResolution: vi.fn(),
    characterDetail: "auto",
    detail: "minimal",
    highlights,
    recommended: null,
    resolution: "auto",
    setHighlights: vi.fn(),
    setTone: vi.fn(),
    tone: "auto"
  }), locale);

  it("shows the live percent slider with its description, Minimal included", () => {
    stubStorage();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const markup = renderSection(0.6);
    expect(markup).toContain("<span>Highlights / glare: 60 %</span>");
    expect(markup).toMatch(/<input max="100" min="0" step="1" type="range" value="60"\/>/);
    expect(markup).toContain("no performance cost");
    expect(markup).not.toContain('aria-label="Apply highlights');
  });

  it("is translated to Hungarian", () => {
    stubStorage();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const markup = renderSection(1, "hu");
    expect(markup).toContain("<span>Csillogás / vakító fény: 100 %</span>");
  });
});
