import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  ClampToEdgeWrapping,
  CustomBlending,
  EqualStencilFunc,
  FloatType,
  GLSL3,
  type IUniform,
  Matrix4,
  Mesh,
  NearestFilter,
  OneFactor,
  OrthographicCamera,
  RawShaderMaterial,
  RedFormat,
  RGBAFormat,
  Scene,
  type Texture,
  Vector2,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
  ZeroFactor
} from "three";

import { ambientOcclusionSize } from "../../render-common/post-sizes";
import type { ActiveAmbientOcclusion } from "../../render-common/quality";
import {
  type AmbientOcclusionTuning,
  AO_BLUR_FRAGMENT_GLSL,
  AO_DEPTH_FRAGMENT_GLSL,
  AO_DIRECT_SHARE_GLSL,
  AO_GTAO_FRAGMENT_GLSL,
  AO_LEVEL_TUNING,
  AO_MASK_FRAGMENT_GLSL,
  AO_TRIANGLE_VERTEX_GLSL,
  AO_TUNING,
  createAoGtaoFragmentGlsl
} from "../../render-common/shaders/frame-ao-glsl";
import { AO_EXCLUDED_STENCIL_BIT } from "./ambient-occlusion-exclusion";
import { SUN_SHADOW_SCREEN_GLSL, SUN_SHADOW_UNIFORM_NAMES } from "./sun-shadow-glsl";

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);

/** The live AO values: the shared tuning plus the occlusion-only debug view. */
export interface AmbientOcclusionRuntimeTuning extends AmbientOcclusionTuning {
  /** 1 shows the visibility alone (development captures), 0 the shaded frame. */
  view: number;
}

export interface FrameAmbientOcclusion {
  dispose: () => void;
  /** The output pass's AO uniforms (FRAME_AO_APPLY_GLSL); `render` keeps them current. */
  outputUniforms: Record<string, IUniform>;
  /**
   * GTAO at half resolution from the resolved depth, then the depth-aware blur; updates the output
   * uniforms for `camera`'s projection.
   */
  render: (depth: Texture, camera: Camera) => void;
  resize: (width: number, height: number) => void;
  /** Runs the passes (true) or leaves the frame unoccluded at strength 0 (false). */
  setActive: (active: boolean) => void;
  tuning: AmbientOcclusionRuntimeTuning;
  /**
   * Writes the AO weight into the alpha of the bound MSAA scene target: 1 everywhere, then 0 where
   * an excluded surface (water, impostor cards) left AO_EXCLUDED_STENCIL_BIT. Colour is kept.
   */
  writeMask: () => void;
}

export { ambientOcclusionSize };

/**
 * RGBA32F (visibility, view depth, direct sun share; RGB32F is not renderable) or R32F (view
 * depth) at half resolution, nearest sampled.
 */
const createHalfTarget = (format: typeof RGBAFormat | typeof RedFormat) => {
  const target = new WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    format,
    generateMipmaps: false,
    magFilter: NearestFilter,
    minFilter: NearestFilter,
    type: FloatType
  });
  target.texture.wrapS = ClampToEdgeWrapping;
  target.texture.wrapT = ClampToEdgeWrapping;
  return target;
};

const createPassMaterial = (fragmentShader: string, uniforms: Record<string, IUniform>) => new RawShaderMaterial({
  depthTest: false,
  depthWrite: false,
  fragmentShader,
  glslVersion: GLSL3,
  uniforms,
  vertexShader: AO_TRIANGLE_VERTEX_GLSL
});

/** Alpha-only write: the colour keeps the scene (zero × source + one × destination). */
const createMaskMaterial = (alpha: number, excludedOnly: boolean) => {
  const material = createPassMaterial(AO_MASK_FRAGMENT_GLSL, { uMaskAlpha: { value: alpha } });
  material.blending = CustomBlending;
  material.blendSrc = ZeroFactor;
  material.blendDst = OneFactor;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = ZeroFactor;
  if (!excludedOnly) return material;
  material.stencilWrite = true;
  material.stencilWriteMask = 0;
  material.stencilFunc = EqualStencilFunc;
  material.stencilRef = AO_EXCLUDED_STENCIL_BIT;
  material.stencilFuncMask = AO_EXCLUDED_STENCIL_BIT;
  return material;
};

const createRuntimeTuning = (level: ActiveAmbientOcclusion): AmbientOcclusionRuntimeTuning => ({
  ...AO_TUNING,
  ...AO_LEVEL_TUNING[level],
  depthTolerance: { ...AO_TUNING.depthTolerance },
  view: 0
});

/** The shared shading uniforms AO_DIRECT_SHARE_GLSL reads besides its own uAoViewToWorld. */
const DIRECT_SHARE_UNIFORM_NAMES = [...SUN_SHADOW_UNIFORM_NAMES, "uSkyIrradiance", "uSunColor", "uSunDirection"];

/**
 * AO-AMBIENT: the GTAO pass with the direct sun share when the scene's shading provides the sun
 * shadow map and the sky light (the island renderer), otherwise the plain R12b pass.
 */
const createGtaoMaterial = (shading: Record<string, IUniform>, uniforms: Record<string, IUniform>) => {
  if (DIRECT_SHARE_UNIFORM_NAMES.some(name => !shading[name])) {
    return createPassMaterial(AO_GTAO_FRAGMENT_GLSL, uniforms);
  }
  const shared = Object.fromEntries(DIRECT_SHARE_UNIFORM_NAMES.map(name => [name, shading[name]!]));
  const prelude = `#define AO_DIRECT_SHARE\n${SUN_SHADOW_SCREEN_GLSL}${AO_DIRECT_SHARE_GLSL}`;
  return createPassMaterial(createAoGtaoFragmentGlsl(prelude), {
    ...uniforms, ...shared, uAoViewToWorld: { value: new Matrix4() }
  });
};

/** Perspective projections have -1 in row 3, column 2; orthographic ones 0. */
const isOrthographic = (projection: Matrix4) => projection.elements[11] === 0;

/**
 * R12b: half-resolution GTAO of the frame compositor. An R32F target holds the view depth, two
 * RGBA32F targets (visibility, view depth, direct sun share) the occlusion through the separable
 * blur; `shading` (the renderer's shared uniforms) lets the GTAO pass weigh the occlusion by the
 * ambient share of the light (AO-AMBIENT, AO_DIRECT_SHARE_GLSL); the compositor
 * applies the result in its output pass. Depth needs 32 bits: the iso camera sits hundreds of units
 * away, where half floats step by 0.5 (coarser than the depth tolerance, which shows as banding).
 * Null when float colour buffers are unavailable (the frame then stays unoccluded).
 */
export const createFrameAmbientOcclusion = (
  renderer: WebGLRenderer,
  shading: Record<string, IUniform>,
  { height, level, width }: { height: number; level: ActiveAmbientOcclusion; width: number }
): FrameAmbientOcclusion | null => {
  if (!renderer.extensions.has("EXT_color_buffer_float")) return null;
  const tuning = createRuntimeTuning(level);
  const viewDepth = createHalfTarget(RedFormat);
  const occlusion = createHalfTarget(RGBAFormat);
  const blurredAlongX = createHalfTarget(RGBAFormat);
  const targets = [viewDepth, occlusion, blurredAlongX];
  const depthToView: IUniform<Vector4> = { value: new Vector4(0, -1, 0, 1) };
  const depthPass = createPassMaterial(AO_DEPTH_FRAGMENT_GLSL, { uAoDepthToView: depthToView, uDepth: { value: null } });
  const gtao = createGtaoMaterial(shading, {
    uAoFullSize: { value: new Vector2(width, height) },
    uAoParams: { value: new Vector4() },
    uAoShape: { value: new Vector2(tuning.falloff, tuning.bias) },
    uAoUnproject: { value: new Vector4() },
    uViewDepth: { value: viewDepth.texture }
  });
  const blur = createPassMaterial(AO_BLUR_FRAGMENT_GLSL, {
    uAo: { value: null },
    uAoAxis: { value: [1, 0] },
    uAoTolerance: { value: new Vector2() }
  });
  const maskAll = createMaskMaterial(1, false);
  const maskExcluded = createMaskMaterial(0, true);
  const materials = [depthPass, gtao, blur, maskAll, maskExcluded];
  const outputUniforms: Record<string, IUniform> = {
    uAoApply: { value: new Vector4() },
    uAoPower: { value: 1 },
    uAoSunlit: { value: 0 },
    uAoDepth: { value: null },
    uAoDepthToView: depthToView,
    uAoTexture: { value: occlusion.texture }
  };
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(FULLSCREEN_TRIANGLE, 3));
  const mesh = new Mesh(geometry, gtao);
  mesh.frustumCulled = false;
  const scene = new Scene().add(mesh);
  const quadCamera = new OrthographicCamera();
  const fullSize: Vector2 = gtao.uniforms.uAoFullSize!.value;
  let active = true;

  const draw = (material: RawShaderMaterial, destination: WebGLRenderTarget | null) => {
    mesh.material = material;
    if (destination) renderer.setRenderTarget(destination);
    renderer.render(scene, quadCamera);
  };

  /** One axis of the separable blur (renderer.render re-uploads the changed uniforms per call). */
  const blurAlong = (axis: readonly [number, number], source: WebGLRenderTarget, destination: WebGLRenderTarget) => {
    blur.uniforms.uAo!.value = source.texture;
    blur.uniforms.uAoAxis!.value = axis;
    draw(blur, destination);
  };

  const resize = (nextWidth: number, nextHeight: number) => {
    const [halfWidth, halfHeight] = ambientOcclusionSize(nextWidth, nextHeight);
    for (const target of targets) target.setSize(halfWidth, halfHeight);
    fullSize.set(nextWidth, nextHeight);
  };
  resize(width, height);

  /** Projection-dependent uniforms: unprojection, radius scale, depth linearisation, tolerances. */
  const updateProjection = (camera: Camera) => {
    const projection = camera.projectionMatrix.elements;
    const inverse = camera.projectionMatrixInverse.elements;
    const orthographic = isOrthographic(camera.projectionMatrix) ? 1 : 0;
    const projectionScale = projection[5]! * fullSize.y * 0.5;
    // NDC offset of an off-centre frustum: + translation (orthographic), - skew (perspective).
    const offsetX = orthographic ? projection[12]! : -projection[8]!;
    const offsetY = orthographic ? projection[13]! : -projection[9]!;
    gtao.uniforms.uAoUnproject!.value.set(1 / projection[0]!, 1 / projection[5]!, offsetX, offsetY);
    gtao.uniforms.uAoParams!.value.set(tuning.radius, projectionScale, tuning.maxRadiusPixels, orthographic);
    gtao.uniforms.uAoShape!.value.set(tuning.falloff, tuning.bias);
    const relative = tuning.depthTolerance.relative * (1 - orthographic);
    blur.uniforms.uAoTolerance!.value.set(tuning.depthTolerance.absolute, relative);
    depthToView.value.set(inverse[10]!, inverse[14]!, inverse[11]!, inverse[15]!);
    outputUniforms.uAoApply!.value.set(tuning.strength, tuning.depthTolerance.absolute, relative, tuning.view);
    outputUniforms.uAoPower!.value = tuning.power;
    outputUniforms.uAoSunlit!.value = tuning.sunlit;
    (gtao.uniforms.uAoViewToWorld?.value as Matrix4 | undefined)?.copy(camera.matrixWorld);
  };

  return {
    dispose: () => {
      for (const target of targets) target.dispose();
      geometry.dispose();
      for (const material of materials) material.dispose();
    },
    outputUniforms,
    render: (depth, camera) => {
      if (!active) {
        outputUniforms.uAoApply!.value.set(0, 1, 0, 0);
        return;
      }
      updateProjection(camera);
      depthPass.uniforms.uDepth!.value = depth;
      outputUniforms.uAoDepth!.value = depth;
      draw(depthPass, viewDepth);
      draw(gtao, occlusion);
      blurAlong([1, 0], occlusion, blurredAlongX);
      blurAlong([0, 1], blurredAlongX, occlusion);
    },
    resize,
    setActive: next => { active = next; },
    tuning,
    writeMask: () => {
      if (!active) return;
      draw(maskAll, null);
      draw(maskExcluded, null);
    }
  };
};
