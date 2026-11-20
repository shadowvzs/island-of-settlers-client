import {
  type Camera,
  Color,
  DataTexture,
  LinearFilter,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  WebGLRenderer
} from "three";

import { type BirdFrame,createBirdFrame } from "../../src/render-common/birds/bird-pool";
import { BIRD_SPECIES } from "../../src/render-common/birds/bird-species";
import { type CameraState,getViewHalfExtent } from "../../src/render-common/camera-state";
import { createNoiseTexture, NOISE_TEXTURE_SIZE } from "../../src/render-common/noise-textures";
import { createSharedUniformValues, SCALAR_UNIFORMS } from "../../src/render-common/shader-uniforms";
import { createThreeBirds } from "../../src/renderers/three/three-birds";
import { createRepeatTexture, createThreeUniforms } from "../../src/renderers/three/three-materials";

const WIDTH = 960;
const HEIGHT = 540;
const MAP = 64;
const BIRD_X_MIN = 20;
const BIRD_X_MAX = 44;
const BIRD_Z = 32;
const BIRD_Y = 3;
const SPECIES = 3;
/** Same target airlight the bird shader receives, so a fully fogged bird matches the backdrop. */
const AIRLIGHT = [0.36, 0.46, 0.56] as const;
const VISIBILITY_SAMPLES = [
  0, 0.05, 0.1, 0.15, 0.2, 0.225, 0.25, 0.275, 0.3, 0.35, 0.4, 0.45, 0.5, 0.65, 0.8, 1
];
const DENSITY_SAMPLES = [0, 0.001, 0.002, 0.004, 0.008, 0.016, 0.032, 0.064];
const ROI_SIZE = 180;

export type BirdFogView = "walking" | "normal";
export type BirdFogQuality = "high" | "minimal";
export interface BirdFogReviewCase {
  mode: BirdFogView;
  quality: BirdFogQuality;
}
export interface BirdFogPixelSample {
  centerBird: [number, number, number];
  centerEmpty: [number, number, number];
  coverage: number;
  maximumDifference: number;
  meanDifference: number;
  /** Mean absolute difference over the fixed central bird region (unbiased by coverage). */
  regionDifference: number;
  value: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const createFogTexture = (width: number, height: number, valueAt: (x: number, y: number) => number) => {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(clamp01(valueAt(x, y)) * 255);
      const offset = (y * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
};

const gradientVisibility = (x: number) =>
  clamp01((BIRD_X_MAX - x) / (BIRD_X_MAX - BIRD_X_MIN));

const createWhiteAtlas = () => createFogTexture(4, 4, () => 1);

const getAtmosphereDensity = ({ mode, quality }: BirdFogReviewCase) => {
  if (quality === "minimal") return mode === "walking" ? 0.0016 : 0;
  return mode === "walking" ? 0.012 : 0.00215;
};

const differenceStats = (before: Uint8Array, after: Uint8Array) => {
  let coverage = 0;
  let maximumDifference = 0;
  let sum = 0;
  const left = Math.floor(WIDTH / 2 - ROI_SIZE / 2);
  const top = Math.floor(HEIGHT / 2 - ROI_SIZE / 2);
  let regionSum = 0;
  for (let offset = 0; offset < before.length; offset += 4) {
    const difference = Math.max(
      Math.abs(before[offset]! - after[offset]!),
      Math.abs(before[offset + 1]! - after[offset + 1]!),
      Math.abs(before[offset + 2]! - after[offset + 2]!)
    );
    const pixel = offset / 4;
    const x = pixel % WIDTH;
    const y = Math.floor(pixel / WIDTH);
    if (x >= left && x < left + ROI_SIZE && y >= top && y < top + ROI_SIZE)
      regionSum += difference;
    if (difference <= 2) continue;
    coverage += 1;
    sum += difference;
    maximumDifference = Math.max(maximumDifference, difference);
  }
  const center = (Math.floor(HEIGHT / 2) * WIDTH + Math.floor(WIDTH / 2)) * 4;
  return {
    centerBird: [after[center]!, after[center + 1]!, after[center + 2]!] as [number, number, number],
    centerEmpty: [before[center]!, before[center + 1]!, before[center + 2]!] as [number, number, number],
    coverage,
    maximumDifference,
    meanDifference: coverage > 0 ? sum / coverage : 0,
    regionDifference: regionSum / (ROI_SIZE * ROI_SIZE)
  };
};

/**
 * Production bird shader and atmosphere uniforms on a controlled backdrop. The live fog map is
 * synthetic (a smooth horizontal reveal gradient or a solid visibility value), so native pixels
 * show and measure the exact fade the game uses without spawning a world.
 */
export const createBirdFogReview = () => {
  const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT);
  document.body.style.margin = "0";
  document.body.append(renderer.domElement);
  const scene = new Scene();
  // Raw shaders output graded display RGB; keep the backdrop byte-identical to the airlight.
  scene.background = new Color().setRGB(
    AIRLIGHT[0],
    AIRLIGHT[1],
    AIRLIGHT[2],
    SRGBColorSpace
  );
  const perspective = new PerspectiveCamera(55, WIDTH / HEIGHT, 0.1, 500);
  const orthographic = new OrthographicCamera(-34, 34, 19, -19, 0.1, 500);
  const values = createSharedUniformValues({ cellsX: MAP, cellsZ: MAP });
  const uniforms = createThreeUniforms(values);
  const gradientFog = createFogTexture(MAP, MAP, (x) => gradientVisibility(x));
  const solidFog = createFogTexture(1, 1, () => 1);
  const workAtlas = createWhiteAtlas();
  uniforms.uFogMap = { value: gradientFog };
  uniforms.uFlyerAtlas = { value: workAtlas };
  uniforms.uNoiseTexture = {
    value: createRepeatTexture(createNoiseTexture(77), NOISE_TEXTURE_SIZE)
  };
  const birds = createThreeBirds(uniforms);
  scene.add(birds.mesh);
  const frame: BirdFrame = createBirdFrame(24);
  const state: CameraState = {
    centerX: 32, centerZ: BIRD_Z, tilt: 0, viewportHeight: HEIGHT, viewportWidth: WIDTH,
    yaw: 0, zoom: 0.45
  };
  const forward = new Vector3();
  const gl = renderer.getContext();
  let camera: Camera = perspective;
  let current: BirdFogReviewCase = { mode: "walking", quality: "high" };

  values.uAtmosphereAirlightLinear.set([0.11, 0.18, 0.28]);
  values.uAmbientGround.set([0.18, 0.2, 0.2]);
  values.uAmbientSky.set([0.5, 0.58, 0.68]);
  values.uAtmosphereBoundsMin.set([-96, -32, -96]);
  values.uAtmosphereBoundsMax.set([160, 96, 160]);
  values.uBakedShadowWeight = 1;
  values.uCloudCover = 0.2;
  values.uFogColor.set(AIRLIGHT);
  values.uLiveFog = 1;
  values.uRain = 0;
  values.uSunColor.set([1.05, 0.95, 0.82]);
  values.uSunDirection.set([0.45, 0.7, 0.55]);
  values.uTime = 0;
  values.uViewDirection.set([0.45, 0.55, 0.7]);
  values.uWind.set([0.2, 0.1]);

  const syncScalars = () => {
    for (const name of SCALAR_UNIFORMS) uniforms[name]!.value = values[name];
  };

  const writeBird = (slot: number, x: number, visibility: number) => {
    const species = BIRD_SPECIES[SPECIES]!;
    frame.bank[slot] = 0;
    frame.flapAmount[slot] = 0.75;
    frame.flapPhase[slot] = 1.1;
    frame.ground[slot] = 0;
    frame.heading[slot] = Math.PI / 2;
    frame.pitch[slot] = 0;
    frame.scale[slot] = species.size;
    frame.shade[slot] = 1;
    frame.species[slot] = SPECIES;
    frame.tuck[slot] = 0;
    frame.visibility[slot] = visibility;
    frame.x[slot] = x;
    frame.y[slot] = BIRD_Y;
    frame.z[slot] = BIRD_Z;
  };

  const setSolidFog = (visibility: number) => {
    const pixels = solidFog.image.data as Uint8Array;
    const value = Math.round(clamp01(visibility) * 255);
    pixels[0] = value;
    pixels[1] = value;
    pixels[2] = value;
    pixels[3] = 255;
    solidFog.needsUpdate = true;
    uniforms.uFogMap!.value = solidFog;
  };

  const render = (count: number) => {
    frame.count = count;
    birds.update(frame, camera, state);
    syncScalars();
    renderer.clear();
    renderer.render(scene, camera);
  };

  const readPixels = () => {
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };

  const syncAtmosphereCamera = () => {
    if (camera === orthographic) {
      const { halfHeight, halfWidth } = getViewHalfExtent(state);
      orthographic.left = -halfWidth;
      orthographic.right = halfWidth;
      orthographic.top = halfHeight;
      orthographic.bottom = -halfHeight;
      orthographic.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    camera.getWorldDirection(forward);
    values.uAtmosphereEye.set(camera.position.toArray());
    values.uAtmosphereForward.set(forward.toArray());
  };

  const setCase = (next: BirdFogReviewCase) => {
    current = next;
    const walking = next.mode === "walking";
    state.zoom = walking ? 1 : 0.35;
    camera = walking ? perspective : orthographic;
    if (walking) {
      perspective.position.set(32, 3.8, 14);
      perspective.lookAt(32, BIRD_Y, BIRD_Z);
    } else {
      orthographic.position.set(32, 34, 80);
      orthographic.lookAt(32, BIRD_Y, BIRD_Z);
    }
    syncAtmosphereCamera();
    const density = getAtmosphereDensity(next);
    values.uAtmosphereFar = walking ? 260 : 0;
    values.uAtmosphereOrthoDepth = walking ? 0 : 200;
    values.uAtmospherePass = 1;
    values.uAtmosphereProfile.set([density, 0.065, 2, walking ? 0 : 1]);
    values.uExplorationFog = walking ? 1 : 0;
  };

  const setDensity = (density: number) => {
    values.uAtmosphereProfile[0] = density;
  };

  /** Close view for dither coverage; row distance for weather extinction paths. */
  const resetMeasurementCamera = (close: boolean) => {
    if (current.mode === "walking") {
      perspective.position.set(32, 3.8, close ? 24 : 14);
      perspective.lookAt(32, BIRD_Y, BIRD_Z);
      camera = perspective;
      state.zoom = 1;
    } else {
      camera = orthographic;
      state.zoom = close ? 1.2 : 0.35;
    }
    syncAtmosphereCamera();
  };

  const showRow = () => {
    uniforms.uFogMap!.value = gradientFog;
    frame.count = 9;
    for (let index = 0; index < frame.count; index += 1) {
      const x = BIRD_X_MIN + ((BIRD_X_MAX - BIRD_X_MIN) * index) / (frame.count - 1);
      writeBird(index, x, gradientVisibility(x));
    }
    render(frame.count);
  };

  const showCrossing = (progress: number) => {
    // The bird holds station while the boundary passes it, so a screenshot sequence shows the
    // whole fade at the same screen position rather than a tiny bird moving across the canvas.
    if (current.mode === "walking") {
      perspective.position.set(32, 3.5, 24);
      perspective.lookAt(32, BIRD_Y, BIRD_Z);
      camera = perspective;
    } else {
      state.zoom = 1.2;
    }
    syncAtmosphereCamera();
    const visibility = clamp01(progress) * 0.6;
    setSolidFog(visibility);
    writeBird(0, 32, visibility);
    render(1);
  };

  const measureVisibility = () => {
    resetMeasurementCamera(true);
    frame.count = 1;
    const samples: BirdFogPixelSample[] = [];
    for (const visibility of VISIBILITY_SAMPLES) {
      setSolidFog(visibility);
      writeBird(0, 32, visibility);
      render(0);
      const empty = readPixels();
      render(1);
      const stats = differenceStats(empty, readPixels());
      samples.push({ ...stats, value: visibility });
    }
    return samples;
  };

  const measureDensity = () => {
    resetMeasurementCamera(false);
    setSolidFog(1);
    frame.count = 1;
    writeBird(0, 32, 1);
    const samples: BirdFogPixelSample[] = [];
    for (const density of DENSITY_SAMPLES) {
      setDensity(density);
      render(0);
      const empty = readPixels();
      render(1);
      const stats = differenceStats(empty, readPixels());
      samples.push({ ...stats, value: density });
    }
    return samples;
  };

  const inspect = () => ({
    buffer: [renderer.domElement.width, renderer.domElement.height],
    draws: renderer.info.render.calls,
    programs: renderer.info.programs?.length ?? 0,
    resources: { ...renderer.info.memory },
    triangles: renderer.info.render.triangles
  });

  const dispose = () => {
    birds.mesh.geometry.dispose();
    (birds.mesh.material as { dispose: () => void }).dispose();
    (birds.caster.material as { dispose: () => void }).dispose();
    gradientFog.dispose();
    solidFog.dispose();
    workAtlas.dispose();
    uniforms.uNoiseTexture!.value.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    return { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 };
  };

  return {
    case: () => current,
    dispose,
    inspect,
    measureDensity,
    measureVisibility,
    setCase,
    showCrossing,
    showRow
  };
};
