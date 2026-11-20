import { floor, int, ivec2, screenCoordinate, textureLoad } from "three/tsl";
import {
  DataTexture,
  FloatType,
  NearestFilter,
  NoBlending,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  WebGPURenderer
} from "three/webgpu";

import { createNoiseTexture, NOISE_SEED, NOISE_TEXTURE_SIZE } from "../../src/render-common/noise-textures";
import { createTslParityCases, toVec4, type TslParityCase } from "./tsl-parity-cases";

/** Browser half of `tsl-parity.ts`: evaluates every TSL case on the GPU and its CPU reference. */
export interface TslParityResult {
  backend: string;
  cases: Array<{ maxError: number; name: string; samples: Array<{ cpu: number[]; gpu: number[] }> }>;
}

/** The game's noise texture: nearest, repeat, no mipmaps (three-renderer-shading.ts). */
const createNoiseSource = () => {
  const texture = new DataTexture(createNoiseTexture(NOISE_SEED), NOISE_TEXTURE_SIZE, NOISE_TEXTURE_SIZE,
    RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

/** Column `sample`, row `row` holds that sample's vec4 input row (missing components are 0). */
const createInputTexture = (parityCase: TslParityCase) => {
  const width = parityCase.samples.length;
  const height = Math.max(...parityCase.samples.map(rows => rows.length));
  const data = new Float32Array(width * height * 4);
  parityCase.samples.forEach((rows, sample) => rows.forEach((row, rowIndex) =>
    data.set(row.slice(0, 4), (rowIndex * width + sample) * 4)));
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
};

const evaluateCase = async (renderer: WebGPURenderer, parityCase: TslParityCase) => {
  const width = parityCase.samples.length;
  const inputs = createInputTexture(parityCase);
  const column = int(floor(screenCoordinate.x));
  const material = new NodeMaterial();
  material.blending = NoBlending;
  material.fragmentNode = toVec4(parityCase.gpu(row => textureLoad(inputs, ivec2(column, row))),
    parityCase.size);
  const target = new RenderTarget(width, 1, { depthBuffer: false, type: FloatType });
  renderer.setRenderTarget(target);
  new QuadMesh(material).render(renderer);
  renderer.setRenderTarget(null);
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, 1) as Float32Array;
  target.dispose();
  inputs.dispose();
  material.dispose();
  return pixels;
};

const compareCase = (parityCase: TslParityCase, pixels: Float32Array) => {
  let maxError = 0;
  const samples = parityCase.samples.map((rows, sample) => {
    const cpu = [...parityCase.cpu(rows)].slice(0, parityCase.size);
    const gpu = Array.from(pixels.slice(sample * 4, sample * 4 + parityCase.size));
    cpu.forEach((value, index) => { maxError = Math.max(maxError, Math.abs(value - gpu[index]!)); });
    return { cpu, gpu };
  });
  return { maxError, name: parityCase.name, samples };
};

export const runTslParity = async (forceWebGL: boolean): Promise<TslParityResult> => {
  const renderer = new WebGPURenderer({ antialias: false, forceWebGL });
  await renderer.init();
  document.body.append(renderer.domElement);
  const noise = createNoiseSource();
  const cases = [];
  for (const parityCase of createTslParityCases(noise))
    cases.push(compareCase(parityCase, await evaluateCase(renderer, parityCase)));
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2";
  renderer.dispose();
  return { backend, cases };
};
