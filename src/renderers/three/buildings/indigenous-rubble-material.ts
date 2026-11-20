import { CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial,
  RepeatWrapping, RGBAFormat, SRGBColorSpace, Vector2 } from "three";

const hash = (x: number, y: number, seed: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 17.19) * 43758.5453;
  return value - Math.floor(value);
};
const mineralNoise = (x: number, y: number, cells: number, seed: number) => {
  const px = x * cells, py = y * cells, ix = Math.floor(px), iy = Math.floor(py);
  const sx = px - ix, sy = py - iy, u = sx * sx * (3 - 2 * sx), v = sy * sy * (3 - 2 * sy);
  const at = (dx: number, dy: number) => hash((ix + dx) % cells, (iy + dy) % cells, seed);
  const low = at(0, 0) * (1 - u) + at(1, 0) * u;
  const high = at(0, 1) * (1 - u) + at(1, 1) * u;
  return low * (1 - v) + high * v;
};
const textureFromPixels = (pixels: Uint8Array, size: number) => {
  let texture;
  if (typeof document === "undefined") texture = new DataTexture(pixels, size, size, RGBAFormat);
  else {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
    texture = new CanvasTexture(canvas);
  }
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
};

/** Original periodic mineral patches and fine grain; rock fractures come from actual stone geometry. */
export const createIndigenousRubbleMaterial = (detailed: boolean) => {
  const size = detailed ? 256 : 128, heights = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4), normals = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const broad = mineralNoise(px, py, 8, 3), medium = mineralNoise(px, py, 32, 7);
    const fine = mineralNoise(px, py, 64, 13), grain = hash(x, y, 19);
    const shade = 148 + (broad - .5) * 24 + (medium - .5) * 17 + (fine - .5) * 9 + (grain - .5) * 5;
    colour.set([shade * .94, shade * .98, shade, 255], (y * size + x) * 4);
    heights[y * size + x] = medium * .55 + fine * .38 + grain * .07;
  }
  const heightAt = (x: number, y: number) => heights[((y + size) % size) * size + (x + size) % size]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (heightAt(x - 1, y) - heightAt(x + 1, y)) * 1.8;
    const dy = (heightAt(x, y - 1) - heightAt(x, y + 1)) * 1.8, length = Math.hypot(dx, dy, 1);
    normals.set([(dx / length * .5 + .5) * 255, (dy / length * .5 + .5) * 255,
      (.5 / length + .5) * 255, 255], (y * size + x) * 4);
  }
  const map = textureFromPixels(colour, size); map.colorSpace = SRGBColorSpace;
  let normalMap = null;
  if (detailed) normalMap = textureFromPixels(normals, size);
  return new MeshStandardMaterial({ map, metalness: 0, normalMap, normalScale: new Vector2(.24, .24),
    roughness: .98, vertexColors: true });
};
