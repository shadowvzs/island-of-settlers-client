import {
  BackSide,
  BoxGeometry,
  type Camera,
  DepthTexture,
  DoubleSide,
  FrontSide,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  type RenderTarget,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
  type WebGPURenderer
} from "three/webgpu";
import { describe, expect, it } from "vitest";

import { SUN_SHADOW_GLSL, SUN_SHADOW_POISSON, SUN_SHADOW_TUNING } from "../src/renderers/three/sun-shadow-glsl";
import { isSunShadowDepthTexture } from "../src/renderers/three/three-shadows";
import { createSunShadowPass, wearDepthMaterials } from "../src/renderers/three/webgpu/sun-shadow-pass";
import { sunShadowAtlasOf } from "../src/renderers/webgpu/tsl/sun-shadow-atlas";
import { sunShadowReceiverOf } from "../src/renderers/webgpu/tsl/sun-shadow";

const ATLAS = 64;

const createSource = () => {
  const depthTexture = new DepthTexture(ATLAS, ATLAS);
  depthTexture.userData.sunShadowAtlas = true;
  return { depthTexture, height: ATLAS, viewport: new Vector4(0, 0, ATLAS, ATLAS), width: ATLAS };
};

interface Draw {
  camera: Camera;
  material: Material | undefined;
  viewport: Vector4;
}

/** The renderer surface the pass uses; each render records the per-draw choice of every mesh. */
const createFakeRenderer = (coordinateSystem: number, pass: () => ReturnType<typeof createSunShadowPass>) => {
  const draws: Draw[] = [];
  let target: RenderTarget | null = null;
  const renderer = {
    coordinateSystem,
    getRenderTarget: () => target,
    info: { render: { drawCalls: 0 } },
    render: (scene: Scene, camera: Camera) => {
      scene.traverse(object => {
        const material = (object as Mesh).material as Material | undefined;
        if (material === undefined) return;
        draws.push({ camera: camera.clone(), material: pass().materialFor(object, material),
          viewport: target!.viewport.clone() });
      });
    },
    setRenderTarget: (next: RenderTarget | null) => { target = next; }
  };
  return { draws, renderer: renderer as unknown as WebGPURenderer };
};

const createPass = (coordinateSystem: number = WebGPUCoordinateSystem) => {
  let pass: ReturnType<typeof createSunShadowPass> | null = null;
  const fake = createFakeRenderer(coordinateSystem, () => pass!);
  pass = createSunShadowPass(fake.renderer);
  return { draws: fake.draws, pass };
};

const lightCamera = () => {
  const camera = new OrthographicCamera(-10, 10, 10, -10, 1, 599);
  camera.position.set(0, 100, 0);
  camera.lookAt(new Vector3());
  camera.updateMatrixWorld();
  return camera;
};

describe("WebGPU sun shadow (C-1)", () => {
  it("restores the materials and layer masks the prewarm compile wore", () => {
    const scene = new Scene();
    const ownMaterial = new MeshBasicMaterial();
    const twinned = new Mesh(new BoxGeometry(), ownMaterial);
    const twinless = new Mesh(new BoxGeometry(), new ShaderMaterial());
    twinless.layers.set(3);
    scene.add(twinned, twinless);
    const depth = new MeshDepthMaterial();
    const restore = wearDepthMaterials(scene, object => object === twinned ? depth : undefined);
    expect(twinned.material).toBe(depth);
    expect(twinless.layers.mask).toBe(0);
    restore();
    expect(twinned.material).toBe(ownMaterial);
    expect(twinless.layers.mask).toBe(1 << 3);
  });

  it("shares the lookup constants with SUN_SHADOW_GLSL", () => {
    expect(SUN_SHADOW_GLSL).toContain(`SHADOW_DEPTH_BIAS = ${SUN_SHADOW_TUNING.depthBias.toExponential(4)}`);
    expect(SUN_SHADOW_GLSL).toContain(`SHADOW_MAX_BIAS = ${SUN_SHADOW_TUNING.maxDepthBias.toExponential(4)}`);
    for (const [x, y] of SUN_SHADOW_POISSON) expect(SUN_SHADOW_GLSL).toContain(`vec2(${x.toFixed(3)}, ${y.toFixed(3)})`);
    expect(SUN_SHADOW_GLSL).toContain(`mix(${SUN_SHADOW_TUNING.shadowFloor}, 1.0, lit)`);
  });

  it("keys one atlas twin per WebGL depth texture and tags the WebGL atlas", () => {
    const source = createSource();
    const atlas = sunShadowAtlasOf(source.depthTexture);
    expect(sunShadowAtlasOf(source.depthTexture)).toBe(atlas);
    expect(atlas.image).toMatchObject({ height: ATLAS, width: ATLAS });
    expect(isSunShadowDepthTexture(source.depthTexture)).toBe(true);
    expect(isSunShadowDepthTexture(atlas)).toBe(false);
  });

  it("compiles no lookup while the pass is off", () => {
    const uniforms = {
      uShadowAtlas: { value: new Vector2(1, 1) }, uShadowCascades: { value: new Vector4(1, 0.06, 0, 1) },
      uShadowMap: { value: createSource().depthTexture }, uShadowMatrix: { value: new Matrix4() },
      uShadowMatrix1: { value: new Matrix4() }, uShadowMatrix2: { value: new Matrix4() },
      uShadowSlots: { value: new Vector4(0, 1, 2, 1) }, uShadowTexel: { value: 1 / ATLAS },
      uShadowTexelWorld: { value: new Vector3(1, 1, 1) }, uSunShadowWeight: { value: 1 }, uSunShadows: { value: 0 }
    };
    expect(sunShadowReceiverOf(uniforms)).toBeNull();
    uniforms.uSunShadows.value = 1;
    expect(sunShadowReceiverOf(uniforms)).not.toBeNull();
  });

  it("draws the moving casters with the shared double-sided depth twin and skips unported shaders", () => {
    const { draws, pass } = createPass();
    const scene = new Scene();
    const custom = new ShaderMaterial({ fragmentShader: "void main() {}", vertexShader: "void main() {}" });
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ side: BackSide })), new Mesh(new BoxGeometry(), custom));
    pass.render(scene, lightCamera(), createSource());
    expect(draws.map(draw => draw.material?.side)).toEqual([BackSide, undefined]);
    expect(Object.values(pass.takeStats().skipped)).toEqual([1]);

    draws.length = 0;
    scene.overrideMaterial = new MeshDepthMaterial();
    pass.render(scene, lightCamera(), createSource());
    expect(draws.map(draw => draw.material?.side)).toEqual([DoubleSide, DoubleSide]);
    expect(draws[0]!.material?.colorWrite).toBe(false);
    expect(scene.overrideMaterial).toBeInstanceOf(MeshDepthMaterial);
    expect(pass.active).toBe(false);
  });

  it("maps WebGL tiles and depth to the WebGPU convention", () => {
    const { draws, pass } = createPass();
    const source = createSource();
    source.viewport.set(0, 0, 32, 16);
    const scene = new Scene().add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ side: FrontSide })));
    const camera = lightCamera();
    pass.render(scene, camera, source);
    const [draw] = draws;
    expect(draw!.viewport.toArray()).toEqual([0, ATLAS - 16, 32, 16]);
    const point = new Vector3(3, 20, -2);
    const webgl = point.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    const webgpu = point.clone().applyMatrix4(draw!.camera.matrixWorldInverse).applyMatrix4(draw!.camera.projectionMatrix);
    expect(webgpu.x).toBeCloseTo(webgl.x, 6);
    expect(webgpu.z).toBeCloseTo(webgl.z * 0.5 + 0.5, 6);
  });

  it("keeps WebGL depth but top-left tiles on the forced WebGL2 backend", () => {
    const { draws, pass } = createPass(WebGLCoordinateSystem);
    const source = createSource();
    source.viewport.set(32, 0, 32, 16);
    const camera = lightCamera();
    pass.render(new Scene().add(new Mesh(new BoxGeometry(), new MeshBasicMaterial())), camera, source);
    const [draw] = draws;
    expect(draw!.viewport.toArray()).toEqual([32, ATLAS - 16, 32, 16]);
    expect(draw!.camera.projectionMatrix.equals(camera.projectionMatrix)).toBe(true);
  });
});
