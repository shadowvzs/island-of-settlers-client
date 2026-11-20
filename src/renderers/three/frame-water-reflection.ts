import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  DepthTexture,
  GLSL3,
  HalfFloatType,
  type IUniform,
  LinearFilter,
  type Material,
  Mesh,
  type Object3D,
  OrthographicCamera,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  type Texture,
  UnsignedIntType,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget
} from "three";

import {
  createWaterReflectionFragmentGlsl,
  WATER_REFLECTION_BLUR_FRAGMENT_GLSL,
  WATER_REFLECTION_TRIANGLE_VERTEX_GLSL,
  WATER_REFLECTION_TUNING,
  type WaterReflectionTuning
} from "../../render-common/shaders/frame-water-reflection-glsl";
import { WATER_VERTEX_GLSL } from "./three-materials";

/** The water surface the pass draws again: its meshes and a cheap "any of it in view" test. */
export interface ReflectiveWater {
  hasVisibleWater: (camera: Camera) => boolean;
  /** Group of water meshes (chunks and the open-sea frame); its children are drawn by the pass. */
  water: Object3D;
}

export interface FrameWaterReflection {
  dispose: () => void;
  /** The output pass's uniforms (FRAME_WATER_REFLECTION_APPLY_GLSL); `render` keeps them current. */
  outputUniforms: Record<string, IUniform>;
  /**
   * Draws the water surface at half resolution and traces its mirror rays through the frame's
   * resolved `scene` colour and `depth`; with no water in view the output skips the apply.
   */
  render: (scene: Texture, depth: Texture, camera: Camera) => void;
  resize: (width: number, height: number) => void;
  /** Runs the pass (true) or leaves the frame without reflections (false). */
  setActive: (active: boolean) => void;
  setWater: (water: ReflectiveWater | null) => void;
  tuning: WaterReflectionTuning;
}

/** Half of the drawing buffer, rounded up (the same grid as the ambient occlusion). */
const halfSize = (size: number) => Math.max(1, Math.ceil(size / 2));

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);

/**
 * RGBA16F reflection (rgb colour, a mirror weight); the trace target also owns the water surface's
 * depth texture, the blur's intermediate target has none.
 */
const createReflectionTarget = (withDepth: boolean) => {
  const target = new WebGLRenderTarget(1, 1, {
    depthBuffer: withDepth,
    format: RGBAFormat,
    generateMipmaps: false,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    type: HalfFloatType
  });
  if (withDepth) target.depthTexture = new DepthTexture(1, 1, UnsignedIntType);
  return target;
};

/** The separable blur: one fullscreen triangle whose material reads `source` along `axis`. */
const createBlur = (depthToView: IUniform<Vector4>, waterDepth: Texture) => {
  const material = new RawShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: WATER_REFLECTION_BLUR_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    uniforms: {
      uSsrAxis: { value: [1, 0] },
      uSsrDepthToView: depthToView,
      uSsrSource: { value: null },
      uSsrTolerance: { value: new Vector2() },
      uSsrWaterDepth: { value: waterDepth }
    },
    vertexShader: WATER_REFLECTION_TRIANGLE_VERTEX_GLSL
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(FULLSCREEN_TRIANGLE, 3));
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { camera: new OrthographicCamera(), geometry, material, scene: new Scene().add(mesh) };
};

const createReflectionMaterial = (
  shading: Record<string, IUniform>, uniforms: Record<string, IUniform>, winter: boolean, iceFloes: boolean
) => new RawShaderMaterial({
  fragmentShader: createWaterReflectionFragmentGlsl(winter, iceFloes),
  glslVersion: GLSL3,
  uniforms: { ...shading, ...uniforms },
  vertexShader: WATER_VERTEX_GLSL
});

const TRANSPARENT_BLACK = new Color(0, 0, 0);

const isMesh = (object: Object3D): object is Mesh => (object as Mesh).isMesh === true;

/**
 * Draws `water`'s meshes with `material` (the scene's own water material swapped out for one
 * call, so chunk LOD and editor rebuilds need no mirror bookkeeping) and restores them.
 */
const renderWaterWith = (
  renderer: WebGLRenderer, water: Object3D, material: Material, camera: Camera, swapped: Material[]
) => {
  swapped.length = 0;
  const meshes = water.children.filter(isMesh);
  for (const mesh of meshes) {
    swapped.push(mesh.material as Material);
    mesh.material = material;
  }
  try {
    renderer.render(water, camera);
  } finally {
    meshes.forEach((mesh, index) => { mesh.material = swapped[index]!; });
  }
};

/**
 * R18b: screen-space reflections on the water only, at half resolution. The pass redraws the water
 * surface (the scene's swell lift) into an RGBA16F target with its own depth texture: the colour
 * holds the traced reflection and its weight, the depth tells the output pass which full-resolution
 * pixels are visible water. Null without half-float colour buffers (the water keeps its sky
 * reflection).
 */
export const createFrameWaterReflection = (
  renderer: WebGLRenderer,
  shading: Record<string, IUniform>,
  { height, iceFloes = false, width, winter }: { height: number; iceFloes?: boolean; width: number; winter: boolean }
): FrameWaterReflection | null => {
  if (!renderer.extensions.has("EXT_color_buffer_float")) return null;
  const tuning: WaterReflectionTuning = {
    ...WATER_REFLECTION_TUNING,
    blurTolerance: { ...WATER_REFLECTION_TUNING.blurTolerance },
    depthTolerance: { ...WATER_REFLECTION_TUNING.depthTolerance }
  };
  const target = createReflectionTarget(true);
  const blurredAlongX = createReflectionTarget(false);
  /** The blur's result: a third target, since the trace target's depth texture is read meanwhile. */
  const blurred = createReflectionTarget(false);
  const depthToView: IUniform<Vector4> = { value: new Vector4(0, -1, 0, 1) };
  const fullSize = new Vector2(width, height);
  const material = createReflectionMaterial(shading, {
    uSsrDepth: { value: null },
    uSsrDepthToView: depthToView,
    uSsrFullSize: { value: fullSize },
    uSsrScene: { value: null },
    uSsrShape: { value: new Vector3() },
    uSsrTrace: { value: new Vector3() }
  }, winter, iceFloes);
  const outputUniforms: Record<string, IUniform> = {
    uSsrApply: { value: new Vector4() },
    uSsrDepthToView: depthToView,
    uSsrSceneDepth: { value: null },
    uSsrTexture: { value: blurred.texture },
    uSsrWaterDepth: { value: target.depthTexture }
  };
  const apply: Vector4 = outputUniforms.uSsrApply!.value;
  const blur = createBlur(depthToView, target.depthTexture!);

  /** One blur axis from `source` into `destination`. */
  const blurAlong = (axis: readonly [number, number], source: WebGLRenderTarget, destination: WebGLRenderTarget) => {
    blur.material.uniforms.uSsrAxis!.value = axis;
    blur.material.uniforms.uSsrSource!.value = source.texture;
    renderer.setRenderTarget(destination);
    renderer.render(blur.scene, blur.camera);
  };
  const swapped: Material[] = [];
  const previousClear = new Color();
  let active = true;
  let source: ReflectiveWater | null = null;

  const resize = (nextWidth: number, nextHeight: number) => {
    target.setSize(halfSize(nextWidth), halfSize(nextHeight));
    blurredAlongX.setSize(halfSize(nextWidth), halfSize(nextHeight));
    blurred.setSize(halfSize(nextWidth), halfSize(nextHeight));
    fullSize.set(nextWidth, nextHeight);
  };
  resize(width, height);

  const updateUniforms = (scene: Texture, depth: Texture, camera: Camera) => {
    const inverse = camera.projectionMatrixInverse.elements;
    depthToView.value.set(inverse[10]!, inverse[14]!, inverse[11]!, inverse[15]!);
    material.uniforms.uSsrDepth!.value = depth;
    material.uniforms.uSsrScene!.value = scene;
    material.uniforms.uSsrTrace!.value.set(tuning.maxDistance, tuning.thickness, tuning.edgeFade);
    material.uniforms.uSsrShape!.value.set(tuning.floor, tuning.maxWeight, tuning.roughness);
    outputUniforms.uSsrSceneDepth!.value = depth;
    // The relative share serves perspective views only: the iso camera's view depth is hundreds of
    // units, where a share would let a ship's deck pass for the water under it.
    const perspective = camera.projectionMatrix.elements[11] === 0 ? 0 : 1;
    apply.set(tuning.strength, tuning.depthTolerance.absolute, tuning.depthTolerance.relative * perspective,
      tuning.debugView);
    blur.material.uniforms.uSsrTolerance!.value.set(tuning.blurTolerance.absolute,
      tuning.blurTolerance.relative * perspective);
  };

  /** Clears to "no water" (colour 0, depth 1) without touching the renderer's clear colour for good. */
  const clearTarget = () => {
    renderer.getClearColor(previousClear);
    const previousAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(TRANSPARENT_BLACK, 0);
    renderer.clear(true, true, false);
    renderer.setClearColor(previousClear, previousAlpha);
  };

  return {
    dispose: () => {
      target.depthTexture?.dispose();
      target.dispose();
      blurredAlongX.dispose();
      blurred.dispose();
      material.dispose();
      blur.material.dispose();
      blur.geometry.dispose();
    },
    outputUniforms,
    render: (scene, depth, camera) => {
      if (!active || !source || !source.hasVisibleWater(camera)) {
        apply.x = 0;
        return;
      }
      updateUniforms(scene, depth, camera);
      clearTarget();
      renderWaterWith(renderer, source.water, material, camera, swapped);
      blurAlong([1, 0], target, blurredAlongX);
      blurAlong([0, 1], blurredAlongX, blurred);
    },
    resize,
    setActive: next => { active = next; },
    setWater: water => { source = water; },
    tuning
  };
};
