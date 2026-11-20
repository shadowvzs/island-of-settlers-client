import { DataTexture, DoubleSide, ShaderLib, type WebGLProgramParametersWithUniforms,
  type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";

import { CLIMBER_FOLIAGE_ATLAS } from "../src/render-common/plants/climber-foliage-atlas-manifest";
import { createDecorationFoliageMaterial,
  decorationFoliageCacheKey } from "../src/renderers/three/plants/decoration-foliage-material";
import { createDecorationFoliageSource } from "../src/renderers/three/plants/decoration-foliage-source";
import type { FoliageAtlasLease } from "../src/renderers/three/plants/foliage-atlas-loader";

const texture = () => new DataTexture(new Uint8Array(4), 1, 1);
const maps = (detailed: boolean) => ({ albedo: texture(), normal: detailed ? texture() : null, orm: texture() });
const shadowUniforms = { uShadowMap: { value: texture() }, uShadowMatrix: { value: null },
  uShadowTexel: { value: 1 }, uSunShadows: { value: 1 } };

const compile = (material: { onBeforeCompile: (shader: WebGLProgramParametersWithUniforms,
  renderer: WebGLRenderer) => void }) => {
  const shader = { fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {},
    vertexShader: ShaderLib.standard.vertexShader } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
};

describe("shared decoration foliage material (D04b)", () => {
  it.each([[true, true], [true, false], [false, true], [false, false]])(
    "detailed %s, antialias %s: cut-out, double sided, vertex tinted", (detailed, antialias) => {
      const { depth, dispose, material } = createDecorationFoliageMaterial({ antialias, detailed,
        maps: maps(detailed), tiles: CLIMBER_FOLIAGE_ATLAS.tiles, uniforms: shadowUniforms });
      expect(material.alphaTest).toBe(.5);
      expect(material.side).toBe(DoubleSide);
      expect(material.alphaToCoverage).toBe(antialias);
      expect(material.vertexColors).toBe(true);
      expect(material.transparent).toBe(false);
      expect(Boolean(material.normalMap)).toBe(detailed);
      expect(material.roughnessMap).not.toBeNull();
      expect(material.metalnessMap).toBeNull();
      expect(material.aoMap).toBeNull();
      expect(material.customProgramCacheKey()).toBe(decorationFoliageCacheKey(antialias, detailed));
      expect(material.customProgramCacheKey()).toContain(antialias ? "a2c" : "test");
      expect(depth.alphaTest).toBe(.5);
      expect(depth.map).toBe(material.map);
      expect("DECORATION_FOLIAGE_WIND" in material.defines!).toBe(detailed);
      expect("DECORATION_FOLIAGE_SHADOWS" in material.defines!).toBe(detailed);
      dispose();
    });

  it("hooks the instanced shadow position, tint strength, translucency and flutter", () => {
    const uniforms = { ...shadowUniforms, uSunColor: { value: [1, 1, 1] }, uSunDirection: { value: [0, 1, 0] },
      uTime: { value: 0 }, uWind: { value: [0, 0] } };
    const high = createDecorationFoliageMaterial({ antialias: true, detailed: true, maps: maps(true),
      tiles: CLIMBER_FOLIAGE_ATLAS.tiles, uniforms });
    const shader = compile(high.material);
    expect(shader.vertexShader).toContain("instanceMatrix * vec4(transformed");
    expect(shader.vertexShader).toContain("foliageFlutterWeight(uv)");
    expect(shader.fragmentShader).toContain("mix( vec3( 1.0 ), vColor.rgb, foliageOrm.b )");
    expect(shader.fragmentShader).toContain("sampleSunShadow( vFoliageWorld )");
    expect(shader.fragmentShader).toContain("FOLIAGE_TRANSLUCENCY = 0.220");
    for (const chunk of ["color_fragment", "roughnessmap_fragment"])
      expect(shader.fragmentShader).not.toContain(`#include <${chunk}>`);
    // Shared renderer uniforms are bound by reference, so per-frame sun/wind updates reach the leaves.
    expect(shader.uniforms.uSunDirection).toBe(uniforms.uSunDirection);
    expect(shader.uniforms.uShadowMap).toBe(uniforms.uShadowMap);
    expect(shader.uniforms.uFoliagePivots?.value).toHaveLength(16);
    expect(compile(high.depth).vertexShader).toContain("foliageFlutterWeight(uv)");
    const minimal = createDecorationFoliageMaterial({ antialias: false, detailed: false, maps: maps(false),
      tiles: CLIMBER_FOLIAGE_ATLAS.tiles });
    const cheap = compile(minimal.material);
    expect(cheap.fragmentShader).toContain("FOLIAGE_TRANSLUCENCY = 0.120");
    expect(minimal.material.defines).toEqual({});
    // Scenes without island uniforms (icons, reviews) still bind a sun and no shadow map.
    expect(cheap.uniforms.uSunDirection).toBeDefined();
    expect(cheap.uniforms.uShadowMap).toBeUndefined();
    high.dispose(); minimal.dispose();
  });
});

describe("decoration foliage source", () => {
  const lease = (release = vi.fn()): FoliageAtlasLease => ({ maps: maps(true), release,
    tiles: CLIMBER_FOLIAGE_ATLAS.tiles });

  it("shares one lease and material pair, releasing both on dispose", async () => {
    const release = vi.fn(), acquire = vi.fn(async () => lease(release));
    const source = createDecorationFoliageSource({ antialias: true, detailed: true }, acquire);
    const [first, second] = await Promise.all([source.acquire(), source.acquire()]);
    expect(first).toBe(second);
    expect(acquire).toHaveBeenCalledTimes(1);
    const dispose = vi.spyOn(first.material, "dispose");
    source.dispose(); source.dispose();
    expect(release).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(source.acquire()).rejects.toThrow("disposed");
  });

  it("retries after a failed atlas load and releases a lease that lands after dispose", async () => {
    const release = vi.fn();
    const acquire = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(lease(release));
    const source = createDecorationFoliageSource({ antialias: false, detailed: false }, acquire);
    await expect(source.acquire()).rejects.toThrow("offline");
    await expect(source.acquire()).resolves.toBeDefined();
    source.dispose();
    let resolve!: (value: FoliageAtlasLease) => void;
    const late = createDecorationFoliageSource({ antialias: false, detailed: false },
      () => new Promise(done => { resolve = done; }));
    const pending = late.acquire();
    late.dispose();
    const lateRelease = vi.fn(); resolve(lease(lateRelease));
    await expect(pending).rejects.toThrow("disposed while loading");
    expect(lateRelease).toHaveBeenCalledTimes(1);
  });
});
