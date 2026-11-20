import {
  AmbientLight, BoxGeometry, Color, DoubleSide, GLSL3, Mesh, MeshStandardMaterial,
  OrthographicCamera, PerspectiveCamera, PlaneGeometry, RawShaderMaterial, Scene,
  Vector3, WebGLRenderer
} from "three";

import { createNoiseTexture, NOISE_TEXTURE_SIZE } from "../../src/render-common/noise-textures";
import { createSharedUniformValues } from "../../src/render-common/shader-uniforms";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../src/render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL, FOG_OF_WAR_GLSL, NOISE_GLSL
} from "../../src/render-common/shaders/common-glsl";
import { installStandardAtmosphere } from "../../src/renderers/three/atmosphere/standard-atmosphere";
import { createExplorationSkyObject } from "../../src/renderers/three/exploration-weather/exploration-sky-object";
import { createRepeatTexture, createThreeUniforms } from "../../src/renderers/three/three-materials";
import { type AtmosphereCustomKind, reviewAtmosphereCustom } from "./atmosphere-custom-fixture";
import {
  compareAtmospherePixels, measureAtmosphereGpu, readAtmospherePixels, summarizeAtmospherePixels
} from "./atmosphere-gpu";
import { reviewAtmosphereNativeMath } from "./atmosphere-math-fixture";
import { createAtmosphereWaterFixture } from "./atmosphere-water-fixture";

export interface AtmosphereReviewCase {
  camera: "perspective" | "orthographic";
  density: number;
  family: "raw" | "standard" | "mixed";
  offset?: number;
  pitch?: number;
  reference?: boolean;
  sky?: boolean;
  viewFar?: number;
}

const vertexShader = `precision highp float;
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Production GLSL + material injector, isolated from simulation and exploration permissions. */
export const createAtmosphereReview = () => {
  const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(1920, 1080);
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  document.body.style.margin = "0";
  document.body.append(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(.22, .29, .39);
  scene.add(new AmbientLight(0xffffff, 3));
  const perspective = new PerspectiveCamera(65, 16 / 9, .1, 3000);
  const orthographic = new OrthographicCamera(-58, 58, 32.625, -32.625, .1, 3000);
  let camera: PerspectiveCamera | OrthographicCamera = perspective;
  const values = createSharedUniformValues({ cellsX: 256, cellsZ: 256 });
  const uniforms = createThreeUniforms(values);
  const noise = createRepeatTexture(createNoiseTexture(123), NOISE_TEXTURE_SIZE);
  uniforms.uNoiseTexture = { value: noise };
  uniforms.uSunDirection!.value.set([.6, .7, -.3]);
  uniforms.uSunColor!.value.set([1.05, .95, .82]);
  uniforms.uAmbientSky!.value.set([.52, .62, .76]);
  uniforms.uFogColor!.value.set([.68, .74, .81]);
  uniforms.uLiveFog!.value = 0;
  uniforms.uExplorationFog!.value = 0;
  uniforms.uAtmosphereBoundsMin!.value.set([-256, -24, -256]);
  uniforms.uAtmosphereBoundsMax!.value.set([512, 80, 512]);
  uniforms.uAtmosphereAirlightLinear!.value.set([.420, .507, .621]);
  const rawFragment = (fog: boolean) => `precision highp float;
in vec3 vWorld;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${FOG_OF_WAR_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
void main() {
  vec3 color = vec3(.15, .34, .07);
  fragColor = vec4(${fog ? "finishSurface(color, vWorld)" : "colorOutputDisplayAuthored(color)"}, 1.0);
}`;
  const raw = new RawShaderMaterial({
    fragmentShader: rawFragment(true), glslVersion: GLSL3, side: DoubleSide, uniforms, vertexShader
  });
  const rawReference = new RawShaderMaterial({
    fragmentShader: rawFragment(false), glslVersion: GLSL3, side: DoubleSide, uniforms, vertexShader
  });
  const standard = new MeshStandardMaterial({ color: 0x55752f, roughness: .95, side: DoubleSide });
  const standardReference = standard.clone();
  installStandardAtmosphere(standard, uniforms);
  const groundGeometry = new PlaneGeometry(256, 256);
  const boxGeometry = new BoxGeometry(5, 13, 5);
  const objects: Mesh[] = [];
  const ground: Mesh = new Mesh(groundGeometry, raw);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(128, -1, 128);
  scene.add(ground);
  for (const z of [20, 45, 90, 155]) for (const x of [112, 128, 144]) {
    const box = new Mesh(boxGeometry, standard);
    box.position.set(x, 5.5, z);
    scene.add(box);
    objects.push(box);
  }
  const sky = createExplorationSkyObject({ background: 0x38465d, uniforms });
  const forward = new Vector3();
  let current: AtmosphereReviewCase = { camera: "perspective", density: 0, family: "mixed" };
  const render = () => {
    renderer.info.reset();
    renderer.clear();
    const background = scene.background;
    if (current.sky) {
      scene.background = null;
      sky.render(renderer, camera);
    }
    renderer.render(scene, camera);
    scene.background = background;
  };
  const set = (settings: AtmosphereReviewCase) => {
    current = settings;
    camera = settings.camera === "orthographic" ? orthographic : perspective;
    const pitch = settings.pitch ?? 0;
    if (settings.camera === "orthographic") {
      forward.set(0, -.7, -1).normalize();
      camera.position.set(128, 0, 100).addScaledVector(forward, -(settings.offset ?? 600));
      camera.lookAt(128, 0, 100);
    } else {
      camera.position.set(128, 2, 4);
      camera.lookAt(128, 2 + Math.sin(pitch) * 100, 4 + Math.cos(pitch) * 100);
    }
    camera.updateMatrixWorld();
    camera.getWorldDirection(forward);
    uniforms.uAtmosphereEye!.value.set(camera.position.toArray());
    uniforms.uAtmosphereForward!.value.set(forward.toArray());
    uniforms.uAtmosphereProfile!.value.set([settings.density, .06, 2,
      Number(settings.camera === "orthographic")]);
    uniforms.uAtmospherePass!.value = 1;
    uniforms.uAtmosphereFar!.value = settings.viewFar ?? 0;
    uniforms.uExplorationFog!.value = Number(settings.viewFar !== undefined);
    const rawChoice = settings.reference ? rawReference : raw;
    const standardChoice = settings.reference ? standardReference : standard;
    ground.material = settings.family === "standard" ? standardChoice : rawChoice;
    for (const [index, mesh] of objects.entries()) {
      mesh.material = standardChoice;
      if (settings.family === "raw" || (settings.family === "mixed" && index % 2 === 0))
        mesh.material = rawChoice;
    }
    sky.update({ cloudCover: .32, cloudDetail: 1, daylight: 1, flash: 0, timeSeconds: 120 });
    render();
  };
  const inspect = () => ({
    buffer: [renderer.domElement.width, renderer.domElement.height],
    draws: renderer.info.render.calls,
    pixels: summarizeAtmospherePixels(readAtmospherePixels(renderer)),
    programs: renderer.info.programs?.length ?? 0,
    resources: { ...renderer.info.memory },
    sky: sky.stats(),
    triangles: renderer.info.render.triangles
  });
  const compare = (reference: AtmosphereReviewCase, candidate: AtmosphereReviewCase) => {
    set(reference);
    const before = readAtmospherePixels(renderer);
    set(candidate);
    return compareAtmospherePixels(before, readAtmospherePixels(renderer));
  };
  const viewLimit = (family: "raw" | "standard") => {
    const settings = { camera: "perspective", density: 0, family, viewFar: 0 } as const;
    set(settings);
    const before = readAtmospherePixels(renderer);
    const point = new Vector3(128, -1, 12).project(camera);
    const x = Math.floor((point.x + 1) * 960);
    const y = Math.floor((point.y + 1) * 540);
    const pixel = (y * 1920 + x) * 4;
    set({ ...settings, viewFar: 100 });
    const after = readAtmospherePixels(renderer);
    const nearMaximum = Math.max(...[0, 1, 2].map(channel =>
      Math.abs(before[pixel + channel]! - after[pixel + channel]!)));
    return { ...compareAtmospherePixels(before, after), nearMaximum };
  };
  const water = (refraction: boolean) => {
    set({ camera: "perspective", density: 0, family: "raw" });
    const fixture = createAtmosphereWaterFixture(renderer, uniforms);
    try {
      const captureParity = fixture.captureParity(camera);
      const effect = fixture.compare(camera, refraction);
      return { captureParity, effect, pixels: summarizeAtmospherePixels(readAtmospherePixels(renderer)) };
    } finally {
      fixture.dispose();
    }
  };
  const dispose = () => {
    sky.dispose();
    for (const material of [raw, rawReference, standard, standardReference]) material.dispose();
    groundGeometry.dispose();
    boxGeometry.dispose();
    noise.dispose();
    renderer.render(new Scene(), camera);
    const released = { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 };
    renderer.dispose();
    renderer.domElement.remove();
    return released;
  };
  return {
    compare, custom: (kind: AtmosphereCustomKind) => reviewAtmosphereCustom(renderer, uniforms, kind),
    dispose, inspect, math: () => reviewAtmosphereNativeMath(renderer),
    measure: () => measureAtmosphereGpu(renderer, render), set, viewLimit, water
  };
};
