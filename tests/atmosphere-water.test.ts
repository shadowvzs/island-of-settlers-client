import {
  DataTexture,
  Group,
  RGBAFormat,
  UnsignedByteType
} from "three";
import { describe, expect, it, vi } from "vitest";

import { withoutAtmosphere } from "../src/renderers/three/atmosphere/atmosphere-state";
import {
  createTerrainMaterial,
  createWaterMaterial
} from "../src/renderers/three/three-materials";
import { createRefractionRenderer } from "../src/renderers/three/three-renderer-refraction";

type Rgb = readonly [number, number, number];
type RefractionOptions = Parameters<typeof createRefractionRenderer>[0];
type RefractionCamera = Parameters<ReturnType<typeof createRefractionRenderer>>[0];

const AIRLIGHT: Rgb = [0.62, 0.71, 0.82];
const BED: Rgb = [0.08, 0.22, 0.16];
const SOURCE: Rgb = [0.14, 0.38, 0.3];

const scaleRgb = (rgb: Rgb, scale: number): Rgb => [
  rgb[0] * scale,
  rgb[1] * scale,
  rgb[2] * scale
];

const addRgb = (first: Rgb, second: Rgb): Rgb => [
  first[0] + second[0],
  first[1] + second[1],
  first[2] + second[2]
];

const blendPremultiplied = (source: Rgb, alpha: number, destination: Rgb): Rgb =>
  addRgb(source, scaleRgb(destination, 1 - alpha));

const fogRgb = (rgb: Rgb, transmittance: number): Rgb =>
  addRgb(scaleRgb(rgb, transmittance), scaleRgb(AIRLIGHT, 1 - transmittance));

/**
 * Independent premultiplied-water oracle. `waterAlpha` is the old alpha over an unfogged bed:
 * its background transmission remains `1 - waterAlpha`.
 */
const composeBlendedWater = (
  source: Rgb,
  waterAlpha: number,
  bed: Rgb,
  transmittance: number
) => {
  const sourceRgb = fogRgb(source, transmittance);
  const sourceAlpha = 1 - transmittance * (1 - waterAlpha);
  return {
    sourceAlpha,
    sourceRgb,
    result: blendPremultiplied(sourceRgb, sourceAlpha, bed)
  };
};

const expectRgbClose = (actual: Rgb, expected: Rgb, precision = 10) => {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
};

describe("blended water atmosphere compositing", () => {
  it("retains the original premultiplied source and alpha at zero density", () => {
    const composite = composeBlendedWater(SOURCE, 0.35, BED, 1);
    expectRgbClose(composite.sourceRgb, SOURCE);
    expect(composite.sourceAlpha).toBeCloseTo(0.35, 12);
    expectRgbClose(composite.result, blendPremultiplied(SOURCE, 0.35, BED));
  });

  it("handles the transparent and opaque alpha extremes at full and zero transmittance", () => {
    const clearTransparent = composeBlendedWater(SOURCE, 0, BED, 1);
    expect(clearTransparent.sourceAlpha).toBe(0);
    expectRgbClose(clearTransparent.result, addRgb(SOURCE, BED));

    const clearOpaque = composeBlendedWater(SOURCE, 1, BED, 1);
    expect(clearOpaque.sourceAlpha).toBe(1);
    expectRgbClose(clearOpaque.result, SOURCE);

    const foggedTransparent = composeBlendedWater(SOURCE, 0, BED, 0);
    expect(foggedTransparent.sourceAlpha).toBe(1);
    expectRgbClose(foggedTransparent.result, AIRLIGHT);

    const foggedOpaque = composeBlendedWater(SOURCE, 1, BED, 0);
    expect(foggedOpaque.sourceAlpha).toBe(1);
    expectRgbClose(foggedOpaque.result, AIRLIGHT);
  });

  it("changes continuously across the full transmittance range", () => {
    const steps = 128;
    let previous = composeBlendedWater(SOURCE, 0.4, BED, 1).result;
    for (let index = 1; index <= steps; index += 1) {
      const transmittance = 1 - index / steps;
      const composite = composeBlendedWater(SOURCE, 0.4, BED, transmittance);
      expect(Number.isFinite(composite.sourceAlpha)).toBe(true);
      expect(composite.sourceAlpha).toBeGreaterThanOrEqual(0);
      expect(composite.sourceAlpha).toBeLessThanOrEqual(1);
      expect(composite.result.every(Number.isFinite)).toBe(true);
      expect(Math.abs(composite.result[0] - previous[0])).toBeLessThan(0.05);
      expect(Math.abs(composite.result[1] - previous[1])).toBeLessThan(0.05);
      expect(Math.abs(composite.result[2] - previous[2])).toBeLessThan(0.05);
      previous = composite.result;
    }
    expectRgbClose(
      composeBlendedWater(SOURCE, 0.4, BED, 1 - 1e-9).result,
      composeBlendedWater(SOURCE, 0.4, BED, 1).result,
      8
    );
  });

  it("does not mistake a camera-fogged bed for the required unfogged destination", () => {
    const unfogged = composeBlendedWater(SOURCE, 0.4, BED, 0.6);
    const equalPathBed = composeBlendedWater(SOURCE, 0.4, fogRgb(BED, 0.6), 0.6);
    const longerBedPath = composeBlendedWater(SOURCE, 0.4, fogRgb(BED, 0.25), 0.6);
    expect(equalPathBed.result).not.toEqual(unfogged.result);
    expect(longerBedPath.result).not.toEqual(equalPathBed.result);
    expect(longerBedPath.result).not.toEqual(unfogged.result);

    const opaqueUnfogged = composeBlendedWater(SOURCE, 1, BED, 0.6);
    const opaqueFoggedBed = composeBlendedWater(SOURCE, 1, fogRgb(BED, 0.25), 0.6);
    expectRgbClose(opaqueFoggedBed.result, opaqueUnfogged.result);
  });
});

describe("production atmosphere wiring", () => {
  it("outputs terrain once, with air only on unsubmerged ground", () => {
    const texture = new DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      RGBAFormat,
      UnsignedByteType
    );
    const shader = createTerrainMaterial({}, texture, texture, "lite").fragmentShader;
    const fogAt = shader.indexOf("color = applyFogOfWar(color, field.z, xz);");
    const tauAt = shader.indexOf(
      "float tau = field.x <= 0.0 ? atmosphereSurfaceTau(vWorld) : 0.0;"
    );
    expect(fogAt).toBeGreaterThan(0);
    expect(tauAt).toBeGreaterThan(fogAt);
    expect(shader).toContain("fragColor = vec4(finishColor(color, tau), 1.0);");
    expect(shader).not.toContain("gradeColor");
  });

  it("applies air to the blended water source and once to opaque refracted water", () => {
    const shader = createWaterMaterial({}, false).fragmentShader;
    expect(shader).toContain("exp(-atmosphereSurfaceTau(vWorld))");
    const premultipliedSource = "colorOutputPremultiplied(applyFogOfWar(color * shade, field.z, vWorld.xz), "
      + "1.0 - seen)";
    expect(shader).toContain(premultipliedSource);
    expect(shader).toContain(
      "(1.0 - atmosphereTransmittance) * colorOutputAirlight(vWorld, atmosphereSurfaceTau(vWorld))"
    );
    expect(shader).toContain("sourceAlpha = 1.0 - atmosphereTransmittance * seen;");
    expect(shader).toContain(
      "fragColor = vec4(finishSurface(applyFogOfWar(color * shade, field.z, vWorld.xz), vWorld), "
        + "1.0);"
    );
  });

  it("decodes the linear seabed capture back to display-authored values before the optics", () => {
    const shader = createWaterMaterial({}, true).fragmentShader;
    const refractedAt = shader.indexOf("vec4 refracted = sampleRefraction(");
    expect(refractedAt).toBeGreaterThan(0);
    expect(shader.indexOf("vec3 bed = blendOpenSeaBed(colorSrgbEncode(refracted.rgb), vWorld.xz);"))
      .toBeGreaterThan(refractedAt);
    expect(shader).not.toContain("gradeColor");
  });
});

describe("refraction camera-air exclusion", () => {
  it("runs every capture inside the callback and restores pass, target and visibility on throw", () => {
    const ship = new Group();
    const scene = { name: "terrain" };
    const weedScene = { name: "weeds" };
    const atmospherePass = { value: 1 };
    const passesDuringCalls: number[] = [];
    const passesWhenSettingTarget: number[] = [];
    const restoreVegetation = vi.fn();
    const clear = vi.fn();
    const setRenderTarget = vi.fn((target: unknown) => {
      passesWhenSettingTarget.push(atmospherePass.value);
      return target;
    });
    const render = vi.fn((renderedScene: { name: string }) => {
      passesDuringCalls.push(atmospherePass.value);
      expect(ship.visible).toBe(false);
      if (renderedScene.name === "weeds") throw new Error("capture failed");
    });
    const asSeabedCapture = vi.fn((capture: () => void) => {
      withoutAtmosphere({ uAtmospherePass: atmospherePass }, capture);
    });
    const options = {
      asSeabedCapture,
      foreground: () => [ship],
      quality: { refractionScale: 1 },
      refraction: { height: 0, setSize: vi.fn(), width: 0 },
      renderer: { clear, render, setRenderTarget },
      scene,
      vegetation: { hideForRefraction: () => restoreVegetation },
      viewport: { x: 64, y: 48 },
      weedScene
    } as unknown as RefractionOptions;
    const capture = createRefractionRenderer(options);
    const camera = {} as RefractionCamera;

    expect(() => capture(camera)).toThrow("capture failed");
    expect(asSeabedCapture).toHaveBeenCalledOnce();
    expect(passesDuringCalls).toEqual([0, 0]);
    expect(passesWhenSettingTarget).toEqual([0, 1]);
    expect(atmospherePass.value).toBe(1);
    expect(clear).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledTimes(2);
    expect(restoreVegetation).toHaveBeenCalledOnce();
    expect(ship.visible).toBe(true);
    expect(setRenderTarget).toHaveBeenLastCalledWith(null);
  });
});
