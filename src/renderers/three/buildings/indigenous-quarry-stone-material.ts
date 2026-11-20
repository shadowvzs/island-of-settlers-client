import {
  CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial,
  RepeatWrapping, RGBAFormat, SRGBColorSpace, Vector2
} from "three";

interface MineralPixels { colour: Uint8Array; normal: Uint8Array; size: number }
const pixels = new Map<boolean, MineralPixels>();
const smooth = (value: number) => value * value * (3 - 2 * value);
const random = (x: number, y: number, seed: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 19.17) * 43758.5453;
  return value - Math.floor(value);
};

/** Periodic interpolated fields give soft mineral boundaries, rather than square texel patches. */
const mineralField = (u: number, v: number, count: number, seed: number) => {
  const x = u * count, y = v * count, ix = Math.floor(x), iy = Math.floor(y);
  const sx = smooth(x - ix), sy = smooth(y - iy);
  const at = (dx: number, dy: number) => random((ix + dx) % count, (iy + dy) % count, seed);
  const lower = at(0, 0) * (1 - sx) + at(1, 0) * sx;
  const upper = at(0, 1) * (1 - sx) + at(1, 1) * sx;
  return lower * (1 - sy) + upper * sy;
};

const createPixels = (detailed: boolean): MineralPixels => {
  const existing = pixels.get(detailed);
  if (existing) return existing;
  const size = detailed ? 256 : 128, colour = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4), heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const broad = mineralField(u, v, 7, 3), mottling = mineralField(u, v, 23, 7);
    const speckle = mineralField(u, v, 37, 11), fine = mineralField(u, v, 97, 17);
    const quartz = Math.max(0, (speckle - .64) / .36);
    const feldspar = Math.max(0, (mineralField(u, v, 41, 23) - .62) / .38);
    const shade = 164 + (broad - .5) * 16 + (mottling - .5) * 12 +
      (speckle - .5) * 16 + (fine - .5) * 5 + quartz * 9 - feldspar * 4;
    colour.set([shade * 1.018 + feldspar * 4, shade, shade * .962, 255], (y * size + x) * 4);
    heights[y * size + x] = mottling * .45 + speckle * .35 + fine * .2;
  }
  const height = (x: number, y: number) => heights[((y + size) % size) * size + (x + size) % size]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (height(x - 1, y) - height(x + 1, y)) * .35;
    const dy = (height(x, y - 1) - height(x, y + 1)) * .35, length = Math.hypot(dx, dy, 1);
    normal.set([(dx / length * .5 + .5) * 255, (dy / length * .5 + .5) * 255,
      (.5 / length + .5) * 255, 255], (y * size + x) * 4);
  }
  const result = { colour, normal, size }; pixels.set(detailed, result); return result;
};

const texture = (data: Uint8Array, size: number) => {
  let result;
  if (typeof document === "undefined") result = new DataTexture(data, size, size, RGBAFormat);
  else {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
    result = new CanvasTexture(canvas);
  }
  result.wrapS = result.wrapT = RepeatWrapping;
  result.magFilter = LinearFilter; result.minFilter = LinearMipmapLinearFilter;
  result.generateMipmaps = true; result.needsUpdate = true;
  return result;
};

/** Quarry-only subdued mineral grain; Well/Catapult rock finishes retain their authored materials. */
export const createIndigenousQuarryStoneMaterial = (_source: MeshStandardMaterial, detailed: boolean) => {
  const data = createPixels(detailed), map = texture(data.colour, data.size);
  map.colorSpace = SRGBColorSpace;
  const normalMap = detailed ? texture(data.normal, data.size) : null;
  const material = new MeshStandardMaterial({ map, metalness: 0, normalMap,
    normalScale: new Vector2(.22, .22), roughness: .96, vertexColors: true });
  material.name = "indigenous_quarry_stone";
  return material;
};
