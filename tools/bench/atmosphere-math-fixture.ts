import {
  FloatType, GLSL3, Mesh, OrthographicCamera, PlaneGeometry, RawShaderMaterial,
  RGBAFormat, Scene, type WebGLRenderer, WebGLRenderTarget
} from "three";

import { ATMOSPHERE_GLSL, ATMOSPHERE_UNIFORMS_GLSL } from
  "../../src/render-common/atmosphere/atmosphere-glsl";
import type { AtmosphereProfile, AtmosphereVec3 } from "../../src/render-common/atmosphere/atmosphere-height";
import {
  type AtmosphereBounds, atmosphereOpticalDepth, type AtmosphereRay,
  atmosphereSkyRay, atmosphereSurfaceRay
} from "../../src/render-common/atmosphere/atmosphere-ray";

interface MathCase {
  direction: AtmosphereVec3;
  length: number;
  mode?: "surface" | "sky";
  name: string;
  origin: AtmosphereVec3;
  orthographic?: boolean;
  pass?: boolean;
  profile?: AtmosphereProfile;
  worldPosition?: AtmosphereVec3;
}

const bounds: AtmosphereBounds = { max: [20, 40, 20], min: [-20, -10, -20] };
const profile: AtmosphereProfile = { extinction: .025, falloff: .12, referenceHeight: 2 };
const homogeneous = { ...profile, falloff: 0 };
const cases: MathCase[] = [
  { name: "horizontal-reference", origin: [0, 2, 0], direction: [1, 0, 0], length: 12 },
  { name: "horizontal-high", origin: [0, 18, 0], direction: [1, 0, 0], length: 12 },
  { name: "horizontal-below", origin: [0, -4, 0], direction: [1, 0, 0], length: 12 },
  { name: "horizontal-upper-bound", origin: [0, 40, 0], direction: [1, 0, 0], length: 12 },
  { name: "upward-above", origin: [0, 3, 0], direction: [0, 1, 0], length: 20 },
  { name: "downward-above", origin: [0, 23, 0], direction: [0, -1, 0], length: 20 },
  { name: "up-reference-cross", origin: [0, -4, 0], direction: [0, 1, 0], length: 16 },
  { name: "down-reference-cross", origin: [0, 12, 0], direction: [0, -1, 0], length: 16 },
  { name: "near-horizontal-up", origin: [0, 18, 0], direction: [1, 1e-7, 0], length: 12 },
  { name: "near-horizontal-down", origin: [0, 18, 0], direction: [1, -1e-7, 0], length: 12 },
  { name: "small-q-up", origin: [0, 18, 0], direction: [1, .0002, 0], length: 12 },
  { name: "small-q-down", origin: [0, 18, 0], direction: [1, -.0002, 0], length: 12 },
  { name: "outside-enter", origin: [-32, 4, 0], direction: [1, 0, 0], length: 50 },
  { name: "outside-miss", origin: [-32, 44, 0], direction: [1, 0, 0], length: 50 },
  { name: "inside-exit", origin: [0, 4, 0], direction: [1, 0, 0], length: 100 },
  { name: "boundary-outward", origin: [20, 4, 0], direction: [1, 0, 0], length: 12 },
  { name: "boundary-inward", origin: [20, 4, 0], direction: [-1, 0, 0], length: 12 },
  { name: "near-boundary-inward", origin: [19.99999, 4, 0], direction: [-1, 0, 0], length: 12 },
  { name: "grazing-upper-face", origin: [-32, 39.99999, 0], direction: [1, 1e-8, 0], length: 50 },
  { name: "grazing-side-face", origin: [-32, 4, 19.99999], direction: [1, 0, 1e-8], length: 50 },
  { name: "homogeneous", origin: [0, 18, 0], direction: [1, .2, 0], length: 12, profile: homogeneous },
  { name: "zero-density", origin: [0, 4, 0], direction: [1, 0, 0], length: 12,
    profile: { ...profile, extinction: 0 } },
  { name: "zero-length", origin: [0, 4, 0], direction: [1, 0, 0], length: 0 },
  { name: "zero-direction", origin: [0, 4, 0], direction: [0, 0, 0], length: 12 },
  { name: "excluded-pass", origin: [0, 4, 0], direction: [1, 0, 0], length: 12, pass: false },
  { name: "large-q", origin: [0, 2, 0], direction: [0, 1, 0], length: 36,
    profile: { ...profile, falloff: 8 } },
  { name: "surface-perspective", origin: [0, 4, -8], direction: [0, 0, 1], length: 0,
    mode: "surface", worldPosition: [0, 4, 14] },
  { name: "surface-ortho600", origin: [0, 424, -424], direction: [0, -Math.SQRT1_2, Math.SQRT1_2], length: 0,
    mode: "surface", orthographic: true, worldPosition: [0, 4, 8] },
  { name: "surface-ortho1200", origin: [0, 848, -848], direction: [0, -Math.SQRT1_2, Math.SQRT1_2], length: 0,
    mode: "surface", orthographic: true, worldPosition: [0, 4, 8] },
  { name: "sky-horizontal", origin: [0, 4, 0], direction: [0, 0, 1], length: 0, mode: "sky" },
  { name: "sky-upward", origin: [0, 4, 0], direction: [0, 1, 0], length: 0, mode: "sky" },
  { name: "sky-grazing", origin: [0, 39.99999, 0], direction: [1, 1e-8, 0], length: 0, mode: "sky" }
];

const expectedTau = (settings: MathCase) => {
  let ray: AtmosphereRay = settings;
  if (settings.mode === "surface") ray = atmosphereSurfaceRay({
    bounds, eye: settings.origin, forward: settings.direction,
    orthographic: Boolean(settings.orthographic), worldPosition: settings.worldPosition!
  });
  if (settings.mode === "sky") ray = atmosphereSkyRay({
    bounds, direction: settings.direction, eye: settings.origin
  });
  return atmosphereOpticalDepth(ray, bounds, settings.profile ?? profile, settings.pass !== false);
};

/** Isolated native float32 evidence. No readback or float target is added to production. */
export const reviewAtmosphereNativeMath = (renderer: WebGLRenderer) => {
  const gl = renderer.getContext();
  if (!gl.getExtension("EXT_color_buffer_float"))
    return { skipped: "EXT_color_buffer_float is unavailable", cases: [] };
  const target = new WebGLRenderTarget(1, 1, { format: RGBAFormat, type: FloatType });
  const uniforms = {
    uAtmosphereAirlightLinear: { value: new Float32Array(3) },
    uAtmosphereBoundsMax: { value: new Float32Array(bounds.max) },
    uAtmosphereBoundsMin: { value: new Float32Array(bounds.min) },
    uAtmosphereEye: { value: new Float32Array(3) },
    uAtmosphereForward: { value: new Float32Array(3) },
    uAtmospherePass: { value: 1 },
    uAtmosphereProfile: { value: new Float32Array(4) },
    uCaseLength: { value: 0 },
    uCaseMode: { value: 0 },
    uCaseWorld: { value: new Float32Array(3) }
  };
  const material = new RawShaderMaterial({
    depthTest: false, depthWrite: false, glslVersion: GLSL3, uniforms,
    vertexShader: `in vec3 position; void main(){ gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader: `precision highp float;
      ${ATMOSPHERE_UNIFORMS_GLSL} ${ATMOSPHERE_GLSL}
      uniform float uCaseLength; uniform int uCaseMode; uniform vec3 uCaseWorld;
      out vec4 fragColor;
      void main(){
        AtmosphereRay ray=AtmosphereRay(uAtmosphereEye,uAtmosphereForward,uCaseLength);
        if(uCaseMode==1) ray=atmosphereSurfaceRay(uCaseWorld);
        if(uCaseMode==2) ray=atmosphereSkyRay(uAtmosphereForward);
        fragColor=vec4(atmosphereOpticalDepth(ray),ray.length,ray.origin.y,1.0);
      }`
  });
  const geometry = new PlaneGeometry(2, 2);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const camera = new OrthographicCamera();
  const previousTarget = renderer.getRenderTarget();
  const pixel = new Float32Array(4);
  try {
    renderer.setRenderTarget(target);
    const results = cases.map(settings => {
      const selected = settings.profile ?? profile;
      uniforms.uAtmosphereProfile.value.set([
        selected.extinction, selected.falloff, selected.referenceHeight, Number(Boolean(settings.orthographic))
      ]);
      uniforms.uAtmosphereEye.value.set(settings.origin);
      uniforms.uAtmosphereForward.value.set(settings.direction);
      uniforms.uAtmospherePass.value = Number(settings.pass !== false);
      uniforms.uCaseLength.value = settings.length;
      uniforms.uCaseMode.value = settings.mode === "surface" ? 1 : 0;
      if (settings.mode === "sky") uniforms.uCaseMode.value = 2;
      uniforms.uCaseWorld.value.set(settings.worldPosition ?? [0, 0, 0]);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
      const expected = expectedTau(settings);
      const measured = pixel[0]!;
      const absoluteError = Math.abs(measured - expected);
      const tolerance = 3e-4 + Math.abs(expected) * 2e-4;
      return { absoluteError, expected, measured, name: settings.name,
        passed: Number.isFinite(measured) && absoluteError <= tolerance, tolerance };
    });
    return { skipped: null, cases: results };
  } finally {
    renderer.setRenderTarget(previousTarget);
    material.dispose(); geometry.dispose(); target.dispose();
  }
};
