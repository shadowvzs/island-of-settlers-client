import { Color, DataTexture, RGBAFormat, UnsignedByteType } from "three";
import { float, vec2, vec3 } from "three/tsl";
import { describe, expect, it } from "vitest";

import { writeHemisphereSkyLight } from "../src/render-common/lighting/sky-irradiance";
import { createNoiseTexture, NOISE_TEXTURE_SIZE } from "../src/render-common/noise-textures";
import { createFogNodes } from "../src/renderers/webgpu/tsl/fog";
import { createLightingNodes } from "../src/renderers/webgpu/tsl/lighting";
import { createNoiseNodes } from "../src/renderers/webgpu/tsl/noise";
import {
  agxToneMap,
  ditherNoise,
  finishDisplay,
  grade,
  neutralToneMap,
  srgbDecode,
  srgbEncode,
  toneMap
} from "../src/renderers/webgpu/tsl/reference/color-output";
import {
  applyFogClouds,
  applyMapEdge,
  fogCoverColor,
  fogCoverPuffs,
  fogVisibilityFade,
  litFogCover
} from "../src/renderers/webgpu/tsl/reference/fog";
import {
  cloudShadow,
  type LightingReferenceInputs,
  lightSurface,
  skyIrradiance
} from "../src/renderers/webgpu/tsl/reference/lighting";
import { fbm3, valueNoise, valueNoise4 } from "../src/renderers/webgpu/tsl/reference/noise";
import * as rockReference from "../src/renderers/webgpu/tsl/reference/rock";
import { createTslRockMaterial, isRockMaterial } from "../src/renderers/webgpu/tsl/rock";
import { branchSway, flutterOffset, windDisplacement } from "../src/renderers/webgpu/tsl/reference/wind";
import { createWindNodes } from "../src/renderers/webgpu/tsl/wind";

/** A tilted SH9 sky (hemisphere plus small quadratic terms), lit sun and rain sheen. */
const LIGHTING_CASE: LightingReferenceInputs = {
  ambientSky: [.5, .6, .8],
  cloudCover: .6,
  cloudDrift: [3.5, 1.25],
  highlight: .8,
  rain: .4,
  skyIrradiance: [.35, .39, .45, .15, .25, .35, .01, .02, .03, .04, 0, .01, .02, .03, .04, 0, .01, .02,
    .03, .04, 0, .01, .02, .03, .04, 0, .01],
  sunColor: [1, .92, .8],
  sunDirection: [.48, .8, .36],
  viewDirection: [0, .6, .8]
};

const close = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 4));

describe("WG-1a TSL CPU references", () => {
  it("matches the colour contract tables", () => {
    close(neutralToneMap([0.5, 0.25, 1.2]), [0.4032402608, 0.2203638833, 0.9152941176]);
    close(agxToneMap([0.5, 0.25, 1.2]), [0.4242792228, 0.3478639769, 0.6703577742]);
    close(toneMap([0.5, 0.25, 1.2], 1, .35), [0.4106038975, 0.2649889161, 0.8295663974]);
    close(grade([0.5, 0.25, 0.8], .2, .15, .4), [0.5183647835, 0.2150722835, 0.8823157835]);
    close(srgbDecode(srgbEncode([0.5, 0.25, 0.8])), [0.5, 0.25, 0.8]);
    close(finishDisplay([0.5, 0.25, 0.8], 123, 45, .2, .15, .4),
      [0.5183647835 + (ditherNoise(123, 45) - 0.5) / 255,
        0.2150722835 + (ditherNoise(123, 45) - 0.5) / 255,
        0.8823157835 + (ditherNoise(123, 45) - 0.5) / 255]);
    expect(ditherNoise(123, 45)).toBeCloseTo(0.4065078386, 4);
  });

  it("matches the noise texture tables", () => {
    expect(valueNoise(0.5, 0.5)).toBeCloseTo(0.1215686275, 4);
    expect(valueNoise(3.2, 7.1)).toBeCloseTo(0.5450980392, 4);
    expect(valueNoise(31.9, 1.3)).toBeCloseTo(0.7294117647, 4);
    close(valueNoise4(0.5, 0.5), [0.1215686275, 0.5529411765, 0.5568627451, 0.7294117647]);
    expect(fbm3(0.5, 0.5)).toBeCloseTo(0.2733333333, 4);
    expect(fbm3(12.25, 4.75)).toBeCloseTo(0.6282352941, 4);
  });

  it("matches the wind tables", () => {
    expect(windDisplacement([12.5, 4.2], .7, 3.1, [1.2, .4], [2.5, 7.1])).toHaveLength(2);
    close(windDisplacement([12.5, 4.2], .7, 3.1, [1.2, .4], [2.5, 7.1]),
      [0.0755556625, 0.0181939547]);
    close(flutterOffset([1, 2, 3], .7, 3.1),
      [0.0139546223, 0.0063630282, -0.0139993255]);
    close(branchSway([1, 2, 3], .7, 3.1, [1.2, .4]),
      [0.0094743321, 0, 0.0188411422]);
  });

  it("matches the fog tables", () => {
    expect(fogVisibilityFade(.28)).toBeCloseTo(0.5214227405, 4);
    close(fogCoverColor(.62, [.12, .18, .24]), [0.1193270624, 0.1789905935, 0.2386541247]);
    close(applyMapEdge([.4, .5, .3], [2, 2], [128, 128]), [0.317037037, 0.3962962963, 0.2377777778]);
    expect(fogCoverPuffs([12.5, 4.2], 3.1)).toBeCloseTo(0.4643137255, 4);
    close(litFogCover(.62, [12.5, 4.2], 3.1, [0, .3, 1], [.3, .8, .2], [1, .9, .7], .2,
      [.12, .18, .24]), [0.0759251761, 0.1142138590, 0.1532012191]);
    close(applyFogClouds([.4, .5, .3], .28, [12.5, 4.2], 3.1, 0, 0, [.12, .18, .24]),
      [0.2093409436, 0.2596040005, 0.2561654353]);
    close(applyFogClouds([.4, .5, .3], .28, [12.5, 4.2], 3.1, 0, 1, [.12, .18, .24]),
      [0.2038501673, 0.2513678361, 0.2451838828]);
    close(applyFogClouds([.4, .5, .3], .96, [12.5, 4.2], 3.1, 0, 1, [.12, .18, .24]), [.4, .5, .3]);
    close(applyFogClouds([.4, .5, .3], .28, [12.5, 4.2], 3.1, 1, 1, [.12, .18, .24]), [.4, .5, .3]);
    close(applyMapEdge([.4, .5, .3], [-30, 2], [0, 0]), [.4, .5, .3]);
  });

  it("matches the lighting tables", () => {
    const sky = new Float32Array(27);
    writeHemisphereSkyLight([.5, .6, .8], [.2, .18, .1], sky, new Float32Array(27));
    close(skyIrradiance(sky, [0, 1, 0]), [.5, .6, .8]);
    close(skyIrradiance(sky, [0, -1, 0]), [.2, .18, .1]);
    close(skyIrradiance(sky, [0, 1, 0], true), [.5, .6, .8]);
    close(skyIrradiance(LIGHTING_CASE.skyIrradiance, [.6, .64, .48]),
      [0.4741119972, 0.5675999853, 0.7240479831]);
    close(skyIrradiance(LIGHTING_CASE.skyIrradiance, [.6, .64, .48], true),
      [0.4461279979, 0.5432159858, 0.6903039839]);
    expect(cloudShadow([12.5, 4.2], LIGHTING_CASE)).toBeCloseTo(0.8759528612, 4);
    expect(cloudShadow([40, 22], LIGHTING_CASE)).toBeCloseTo(0.7039428998, 4);
    close(lightSurface([.4, .5, .3], [.6, .64, .48], .9, .85, [12.5, 4.2], LIGHTING_CASE),
      [0.3978815403, 0.4970828198, 0.3038506143]);
    close(lightSurface([.4, .5, .3], [0, 1, 0], 1, 1, [40, 22], LIGHTING_CASE),
      [0.3350265787, 0.4588639858, 0.2973534698]);
  });

  it("matches the rock tables", () => {
    expect(rockReference.hashRockId(0.5)).toBeCloseTo(0.2100478806, 4);
    expect(rockReference.hashRockId(3.2)).toBeCloseTo(0.1818737689, 4);
    const upward = rockReference.getRockPlanes([0, 1, 0], 0.5, 1);
    close(upward.normal, [0, 1, 0]);
    expect(upward.tone).toBeCloseTo(0, 6);
    expect(upward.edge).toBeCloseTo(0, 6);
    const wall = rockReference.getRockPlanes([1, 0, 0], 0.5, 1);
    close(wall.normal, [1, 0, 0]);
    expect(wall.tone).toBeCloseTo(-0.2320649303, 4);
    close(rockReference.decodeRockTint(0.5), [0, 1, 0]);
    close(rockReference.decodeRockTint(0.2), [0.4015748031, 0, 0]);
    expect(rockReference.getSnowLee([0, 1, 0])).toBeCloseTo(0, 6);
    close(rockReference.getSnowNormal([0, 1, 0]), [0, 1, 0]);
    expect(rockReference.getSnowCover([12.5, 9, 4.2], [0, 1, 0], [0, 0, 0, 0],
      [0.5, 0.5, 0.5, 0.5], [0.5, 0.5], 7)).toBeCloseTo(1, 4);
    expect(rockReference.getFineGrain(
      rockReference.getRockUv([1, 2, 3], [0, 1, 0], 0.19), 0.5, 1)).toBeCloseTo(1, 6);
    const weights = rockReference.getRockUv([1, 2, 3], [0.6, 0.64, 0.48], 0.19).weights;
    expect(weights[0] + weights[1] + weights[2]).toBeCloseTo(1, 6);
    const zones = rockReference.getRockZones([0.3, 0.4, 0.5, 0.6], 0.55, [0.5, 0.5, 0.5, 0.5], 0);
    expect(zones.clean + zones.weathered + zones.loose).toBeCloseTo(1, 6);
    const albedo: [number, number, number] = [0.4, 0.42, 0.45];
    close(rockReference.applyOreStone(albedo, [1, 2, 3], 0, 0.5), albedo);
    close(rockReference.applyStrata(albedo, { band: 0.5, lip: 0.8, seam: 0.4 }, 0), albedo);
    close(rockReference.applyWetRock(albedo, [0, 1, 0], 0, 0), albedo);
    const triplanar = rockReference.sampleRockTriplanar(
      rockReference.getRockUv([3, 4, 5], [0.6, 0.64, 0.48], 0.19),
      rockReference.sampleRockTestTexture(rockReference.createRockTestPixels()));
    expect(triplanar).toHaveLength(4);
    triplanar.forEach(channel => expect(channel).toBeGreaterThanOrEqual(0));
    triplanar.forEach(channel => expect(channel).toBeLessThanOrEqual(1));
  });

  it("builds the rock TSL material plain and stone-tinted", () => {
    const texture = () => new DataTexture(new Uint8Array(64), 4, 4, RGBAFormat, UnsignedByteType);
    const source = (tinted: boolean) => ({
      defines: tinted ? { STONE_TINT: "" } : {},
      depthTest: true,
      depthWrite: true,
      fragmentShader: "struct RockSurface { vec3 albedo; };",
      side: 0,
      uniforms: {
        uAmbientGround: { value: [0.2, 0.18, 0.1] }, uAmbientSky: { value: [0.4, 0.5, 0.6] },
        uCloudCover: { value: 0.5 }, uCloudDrift: { value: [1, 2] },
        uColorGradeRain: { value: 0 }, uColorToneMapper: { value: 0 },
        uColorVividBoost: { value: 0 }, uExplorationFog: { value: 0 },
        uFogColor: { value: [0.1, 0.15, 0.2] }, uFogMap: { value: texture() },
        uFogOfWarLit: { value: 0 }, uHighlight: { value: 0.8 }, uLiveFog: { value: 0 },
        uMacroNormals: { value: texture() }, uNoiseTexture: { value: texture() },
        uRain: { value: 0.2 }, uRockNormal: { value: texture() },
        uRockTexture: { value: texture() }, uSkyIrradiance: { value: Array(27).fill(0.1) },
        uSnowMap: { value: texture() }, uSunColor: { value: [1, 0.9, 0.8] },
        uSunDirection: { value: [0.4, 0.8, 0.4] }, uTime: { value: 1 },
        uViewDirection: { value: [0, 0.6, 0.8] }, uWorldSize: { value: [128, 128] },
        ...(tinted ? { uStoneTint: { value: new Color(0.88, 0.91, 0.96) } } : {})
      },
      userData: tinted ? { rockDepositFamily: "marble" } : {}
    }) as never;
    for (const tinted of [false, true]) {
      const rockSource = source(tinted);
      expect(isRockMaterial(rockSource)).toBe(true);
      const material = createTslRockMaterial(rockSource);
      expect(material).not.toBeNull();
      expect(typeof material!.userData.syncUniforms).toBe("function");
    }
    expect(isRockMaterial({ fragmentShader: "void main() {}", uniforms: {} } as never)).toBe(false);
  });

  it("constructs the TSL node functions without a renderer", () => {
    const texture = new DataTexture(createNoiseTexture(77), NOISE_TEXTURE_SIZE, NOISE_TEXTURE_SIZE,
      RGBAFormat, UnsignedByteType);
    const noise = createNoiseNodes(texture);
    const wind = createWindNodes(noise.valueNoise);
    const fog = createFogNodes({ fbm3: noise.fbm3, noiseTexture: texture });
    const lighting = createLightingNodes({ ambientSky: vec3(.5), cloudCover: float(.6),
      cloudDrift: vec2(0), fbm3: noise.fbm3, highlight: float(1), rain: float(0),
      skyIrradiance: Array.from({ length: 9 }, () => vec3(0)), sunColor: vec3(1),
      sunDirection: vec3(0, 1, 0), viewDirection: vec3(0, 1, 0) });
    expect(typeof noise.valueNoise).toBe("function");
    expect(typeof noise.fbm3).toBe("function");
    expect(typeof wind.windDisplacement).toBe("function");
    expect(typeof wind.flutterOffset).toBe("function");
    expect(typeof wind.branchSway).toBe("function");
    expect(typeof fog.applyFogOfWar).toBe("function");
    expect(typeof fog.litFogCover).toBe("function");
    expect(typeof lighting.lightSurface).toBe("function");
  });
});
