import {
  Group,
  type IUniform,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer
} from "three";
import { describe, expect, it, vi } from "vitest";

import {
  ATMOSPHERE_GLSL,
  ATMOSPHERE_UNIFORMS_GLSL
} from "../src/render-common/atmosphere/atmosphere-glsl";
import {
  CONCEALMENT_GLSL,
  CONCEALMENT_UNIFORMS_GLSL
} from "../src/render-common/atmosphere/concealment-glsl";
import {
  createStandardAtmosphereBinding,
  installStandardAtmosphere,
  uninstallStandardAtmosphere
} from "../src/renderers/three/atmosphere/standard-atmosphere";
import { STANDARD_ATMOSPHERE_CACHE_KEY_SUFFIX } from
  "../src/renderers/three/atmosphere/standard-atmosphere-shader";

const MESH_VERTEX = `
void main() {
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
}`;

const MESH_FRAGMENT = `
void main() {
  vec3 outgoingLight = vec3( 1.0 );
  #include <opaque_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SPRITE_VERTEX = `
void main() {
  vec4 mvPosition = modelViewMatrix[ 3 ];
  gl_Position = projectionMatrix * mvPosition;
}`;

const uniforms = (): Record<string, IUniform> => ({
  uAtmosphereAirlightLinear: { value: new Vector3() },
  uAtmosphereBoundsMax: { value: new Vector3(10, 10, 10) },
  uAtmosphereBoundsMin: { value: new Vector3(-10, -10, -10) },
  uAtmosphereEye: { value: new Vector3() },
  uAtmosphereForward: { value: new Vector3(0, 0, -1) },
  uAtmospherePass: { value: 1 },
  uAtmosphereProfile: { value: new Vector4(.1, .05, 0, 1) }
});

const fakeRenderer = () => {
  const render = vi.fn();
  const renderer = { render } as unknown as WebGLRenderer;
  return { render, renderer };
};

const compile = (
  material: Material,
  renderer: WebGLRenderer,
  vertexShader = MESH_VERTEX,
  fragmentShader = MESH_FRAGMENT
): WebGLProgramParametersWithUniforms => {
  const shader = {
    fragmentShader,
    uniforms: {},
    vertexShader
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, renderer);
  return shader;
};

const screenFrame = (): [Scene, PerspectiveCamera] => [
  new Scene(),
  new PerspectiveCamera()
];

describe("standard atmosphere shader hook", () => {
  it("chains existing hooks/cache keys and composes once after the lit mesh tail", () => {
    const { renderer } = fakeRenderer();
    const material = new MeshStandardMaterial();
    const originalHook = vi.fn((shader: WebGLProgramParametersWithUniforms) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        "// existing material extension\n#include <opaque_fragment>"
      );
    });
    const originalCacheKey = vi.fn(() => "existing-material");
    material.onBeforeCompile = originalHook;
    material.customProgramCacheKey = originalCacheKey;
    const values = uniforms();

    installStandardAtmosphere(material, values, renderer);
    const shader = compile(material, renderer);

    expect(originalHook).toHaveBeenCalledOnce();
    expect(material.customProgramCacheKey()).toBe(
      `existing-material:${STANDARD_ATMOSPHERE_CACHE_KEY_SUFFIX}:1`
    );
    expect(shader.uniforms.uAtmosphereProfile).toBe(values.uAtmosphereProfile);
    expect(shader.fragmentShader).toContain(ATMOSPHERE_UNIFORMS_GLSL);
    expect(shader.fragmentShader).toContain(ATMOSPHERE_GLSL);
    expect(shader.fragmentShader).toContain(CONCEALMENT_UNIFORMS_GLSL);
    expect(shader.fragmentShader).toContain(CONCEALMENT_GLSL);
    expect(shader.fragmentShader).not.toContain("applyFogClouds");
    const composite = shader.fragmentShader.indexOf(
      "outgoingLight = composeAtmosphereLinear"
    );
    expect(composite).toBeGreaterThan(
      shader.fragmentShader.indexOf("// existing material extension")
    );
    expect(composite).toBeLessThan(
      shader.fragmentShader.indexOf("#include <opaque_fragment>")
    );
    expect(shader.fragmentShader.indexOf("#include <opaque_fragment>")).toBeLessThan(
      shader.fragmentShader.indexOf("#include <tonemapping_fragment>")
    );
    expect(shader.fragmentShader.match(/outgoingLight = composeAtmosphereLinear/g))
      .toHaveLength(1);
  });

  it("composes buildings through the fragment world ray and the shared camera-air gate", () => {
    const { renderer } = fakeRenderer();
    const material = new MeshStandardMaterial();
    installStandardAtmosphere(material, uniforms(), renderer);
    const shader = compile(material, renderer);

    expect(shader.fragmentShader).toContain("atmosphereSurfaceRay( vAtmosphereWorld )");
    expect(shader.fragmentShader).toContain("atmosphereOpticalDepth( standardAtmosphereRay )");
    // The bank gate travels with the shared GLSL, so standard materials stay clear in clear air.
    expect(shader.fragmentShader).toContain(
      "atmosphereBankEyeVisibility(bank, uAtmosphereEye)"
    );
  });

  it("captures transformed world positions after native skinning, batching and instancing", () => {
    const { renderer } = fakeRenderer();
    const material = new MeshStandardMaterial();
    installStandardAtmosphere(material, uniforms(), renderer);
    const shader = compile(material, renderer);
    const capture = shader.vertexShader.indexOf(
      "vec4 standardAtmosphereLocal = vec4( transformed, 1.0 );"
    );

    expect(capture).toBeGreaterThan(
      shader.vertexShader.indexOf("#include <skinning_vertex>")
    );
    expect(capture).toBeGreaterThan(
      shader.vertexShader.indexOf("#include <project_vertex>")
    );
    expect(shader.vertexShader).toContain(
      "standardAtmosphereLocal = batchingMatrix * standardAtmosphereLocal;"
    );
    expect(shader.vertexShader).toContain(
      "standardAtmosphereLocal = instanceMatrix * standardAtmosphereLocal;"
    );
    expect(shader.vertexShader).toContain(
      "vAtmosphereWorld = ( modelMatrix * standardAtmosphereLocal ).xyz;"
    );
  });

  it("keeps default cache keys tied to the original hook source", () => {
    const { renderer } = fakeRenderer();
    const material = new MeshStandardMaterial();
    const originalHook = vi.fn();
    material.onBeforeCompile = originalHook;
    installStandardAtmosphere(material, uniforms(), renderer);
    expect(material.customProgramCacheKey()).toContain(originalHook.toString());
  });

  it("uses the billboard centre for compatible sprites", () => {
    const { renderer } = fakeRenderer();
    const material = new SpriteMaterial();
    installStandardAtmosphere(material, uniforms(), renderer);
    const shader = compile(material, renderer, SPRITE_VERTEX);

    expect(shader.vertexShader).toContain(
      "vAtmosphereWorld = modelMatrix[ 3 ].xyz;"
    );
    expect(shader.fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
  });

  it.each([
    ["basic", () => new MeshBasicMaterial()],
    ["lambert", () => new MeshLambertMaterial()],
    ["phong", () => new MeshPhongMaterial()],
    ["physical", () => new MeshPhysicalMaterial()],
    ["standard", () => new MeshStandardMaterial()]
  ])("covers built-in %s world materials", (_name, createMaterial) => {
    const { renderer } = fakeRenderer();
    const material = createMaterial();
    installStandardAtmosphere(material, uniforms(), renderer);
    expect(compile(material, renderer).fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
  });

  it("is idempotent per renderer and excludes raw, depth and shader materials", () => {
    const { renderer } = fakeRenderer();
    const material = new MeshBasicMaterial();
    installStandardAtmosphere(material, uniforms(), renderer);
    const hook = material.onBeforeCompile;
    const cacheKey = material.customProgramCacheKey;
    const version = material.version;
    installStandardAtmosphere(material, uniforms(), renderer);

    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey).toBe(cacheKey);
    expect(material.version).toBe(version);
    expect(compile(material, renderer).fragmentShader.match(
      /#define standard_atmosphere_v1/g
    )).toHaveLength(1);

    for (const unsupported of [
      new MeshDepthMaterial(),
      new ShaderMaterial()
    ]) {
      const originalHook = unsupported.onBeforeCompile;
      installStandardAtmosphere(unsupported, uniforms(), renderer);
      expect(unsupported.onBeforeCompile).toBe(originalHook);
    }
  });

  it("injects only for the owning renderer and fully restores hooks on cleanup", () => {
    const owned = fakeRenderer().renderer;
    const other = fakeRenderer().renderer;
    const material = new MeshStandardMaterial();
    const originalHook = material.onBeforeCompile;
    const originalCacheKey = material.customProgramCacheKey;
    installStandardAtmosphere(material, uniforms(), owned);
    const scopedHook = material.onBeforeCompile;

    expect(compile(material, owned).fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
    expect(compile(material, other).fragmentShader).not.toContain(
      "outgoingLight = composeAtmosphereLinear"
    );

    uninstallStandardAtmosphere(material, owned);
    expect(material.onBeforeCompile).toBe(originalHook);
    expect(material.customProgramCacheKey).toBe(originalCacheKey);
    expect(compile(material, owned).fragmentShader).not.toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
    const staleShader = {
      fragmentShader: MESH_FRAGMENT,
      uniforms: {},
      vertexShader: MESH_VERTEX
    } as unknown as WebGLProgramParametersWithUniforms;
    expect(() => scopedHook.call(material, staleShader, owned)).not.toThrow();
    expect(staleShader.fragmentShader).not.toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
    expect(staleShader.uniforms).toEqual({});
  });

  it("invalidates an earlier renderer program when that renderer joins later", () => {
    const first = fakeRenderer().renderer;
    const second = fakeRenderer().renderer;
    const material = new MeshStandardMaterial();
    const originalHook = material.onBeforeCompile;
    installStandardAtmosphere(material, uniforms(), first);
    const secondKeyBefore = material.customProgramCacheKey();
    const secondVersionBefore = material.version;
    expect(compile(material, second).fragmentShader).not.toContain(
      "outgoingLight = composeAtmosphereLinear"
    );

    installStandardAtmosphere(material, uniforms(), second);
    expect(material.customProgramCacheKey()).not.toBe(secondKeyBefore);
    expect(material.version).toBeGreaterThan(secondVersionBefore);
    expect(compile(material, second).fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );

    uninstallStandardAtmosphere(material, first);
    expect(compile(material, second).fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
    uninstallStandardAtmosphere(material, second);
    expect(material.onBeforeCompile).toBe(originalHook);
  });
});

describe("standard atmosphere scene binding", () => {
  it("watches each scene once and registers later descendants without per-frame traversal", () => {
    const { render, renderer } = fakeRenderer();
    const [scene, camera] = screenFrame();
    const firstMaterial = new MeshStandardMaterial();
    scene.add(new Mesh(undefined, firstMaterial));
    const traverse = vi.spyOn(scene, "traverse");
    const binding = createStandardAtmosphereBinding(renderer, uniforms());

    renderer.render(scene, camera);
    renderer.render(scene, camera);
    expect(render).toHaveBeenCalledTimes(2);
    expect(traverse).toHaveBeenCalledOnce();
    expect(binding.stats).toMatchObject({ materials: 1, scenes: 1 });

    const lateMaterial = new MeshStandardMaterial();
    const group = new Group();
    group.add(new Mesh(undefined, lateMaterial));
    scene.add(group);
    expect(compile(lateMaterial, renderer).fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
    expect(traverse).toHaveBeenCalledOnce();
    expect(binding.stats.materials).toBe(2);

    const secondScene = new Scene();
    const secondMaterial = new MeshStandardMaterial();
    secondScene.add(new Mesh(undefined, secondMaterial));
    renderer.render(secondScene, camera);
    expect(compile(secondMaterial, renderer).fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
    expect(render).toHaveBeenCalledTimes(3);
    expect(traverse).toHaveBeenCalledOnce();
    expect(binding.stats.scenes).toBe(2);
    binding.dispose();
  });

  it("unwatches detached subtrees, rebinds readded pools and refreshes replaced materials", () => {
    const { renderer } = fakeRenderer();
    const [scene, camera] = screenFrame();
    const group = new Group();
    const mesh = new Mesh(undefined, new MeshStandardMaterial());
    const detachedMaterial = new MeshStandardMaterial();
    const unattachedPrototype = new MeshStandardMaterial();
    const prototypeHook = unattachedPrototype.onBeforeCompile;
    group.add(mesh);
    scene.add(group);
    const binding = createStandardAtmosphereBinding(renderer, uniforms());
    renderer.render(scene, camera);
    expect(unattachedPrototype.onBeforeCompile).toBe(prototypeHook);

    scene.remove(group);
    group.add(new Mesh(undefined, detachedMaterial));
    expect(compile(detachedMaterial, renderer).vertexShader).not.toContain(
      "standardAtmosphereLocal"
    );

    const replacement = new MeshStandardMaterial();
    mesh.material = replacement;
    binding.bind(mesh);
    expect(compile(replacement, renderer).fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
    const factoryHook = vi.fn();
    replacement.onBeforeCompile = factoryHook;
    binding.bind(mesh);
    expect(compile(replacement, renderer).fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
    expect(factoryHook).toHaveBeenCalledOnce();

    scene.add(group);
    expect(compile(detachedMaterial, renderer).fragmentShader).toContain(
      "outgoingLight = composeAtmosphereLinear"
    );
    binding.dispose();
  });

  it("drops material scope on dispose and restores the renderer entry point", () => {
    const { render, renderer } = fakeRenderer();
    const [scene, camera] = screenFrame();
    const material = new MeshStandardMaterial();
    const originalHook = material.onBeforeCompile;
    scene.add(new Sprite(new SpriteMaterial()));
    scene.add(new Mesh(undefined, material));
    const originalRender = renderer.render;
    const binding = createStandardAtmosphereBinding(renderer, uniforms());
    renderer.render(scene, camera);

    expect(() => material.dispose()).not.toThrow();
    expect(material.onBeforeCompile).toBe(originalHook);
    expect(binding.stats.materials).toBe(1);
    binding.dispose();
    expect(renderer.render).toBe(originalRender);
    expect(binding.stats).toEqual({ materials: 0, scenes: 0, watchedObjects: 0 });

    scene.add(new Mesh(undefined, new MeshStandardMaterial()));
    expect(render).toHaveBeenCalledOnce();
  });
});
