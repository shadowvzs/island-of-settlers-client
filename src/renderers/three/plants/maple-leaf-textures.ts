import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType
} from "three";

interface Vein { ax: number; ay: number; bx: number; by: number; width: number; relief: number }
const ORIGIN = [.5, .17] as const;
const LOBES = [[0, .40], [.16, .76], [.5, 1], [.86, .80], [1, .39]] as const;
const noise = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const smoothNoise = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = noise(ix, iy) * (1 - sx) + noise(ix + 1, iy) * sx;
  const b = noise(ix, iy + 1) * (1 - sx) + noise(ix + 1, iy + 1) * sx;
  return a * (1 - sy) + b * sy;
};

const makeVeins = () => {
  const veins: Vein[] = [];
  for (const [tipX, tipY] of LOBES) {
    const dx = tipX - ORIGIN[0], dy = tipY - ORIGIN[1];
    for (let segment = 0; segment < 3; segment++) {
      const t = segment / 3, next = (segment + 1) / 3;
      veins.push({ ax: ORIGIN[0] + dx * t + Math.sin(t * Math.PI) * .006,
        ay: ORIGIN[1] + dy * t, bx: ORIGIN[0] + dx * next + Math.sin(next * Math.PI) * .006,
        by: ORIGIN[1] + dy * next, width: .0046 - t * .0016, relief: .37 - t * .12 });
    }
    for (let step = 0; step < 5; step++) for (const side of [-1, 1]) {
      const t = .22 + step * .125, length = .18 * (1 - t * .62);
      const ax = ORIGIN[0] + dx * t, ay = ORIGIN[1] + dy * t;
      const bx = ax + dx * .12 + dy * side * length;
      const by = ay + dy * .12 - dx * side * length;
      veins.push({ ax, ay, bx, by, width: .0021, relief: .17 });
      for (let fork = 0; fork < 2; fork++) {
        const along = .42 + fork * .27, originX = ax + (bx - ax) * along, originY = ay + (by - ay) * along;
        veins.push({ ax: originX, ay: originY, bx: originX + dx * .05 + (bx - ax) * .24,
          by: originY + dy * .05 + (by - ay) * .24, width: .0012, relief: .075 });
      }
    }
  }
  return veins;
};

/** Rasterize only each narrow vein's local bounds; no all-veins scan for every texture pixel. */
const paintVein = (height: Float32Array, size: number, vein: Vein) => {
  const margin = vein.width * 2.6;
  const left = Math.max(0, Math.floor((Math.min(vein.ax, vein.bx) - margin) * size));
  const right = Math.min(size - 1, Math.ceil((Math.max(vein.ax, vein.bx) + margin) * size));
  const bottom = Math.max(0, Math.floor((Math.min(vein.ay, vein.by) - margin) * size));
  const top = Math.min(size - 1, Math.ceil((Math.max(vein.ay, vein.by) + margin) * size));
  const dx = vein.bx - vein.ax, dy = vein.by - vein.ay, lengthSquared = dx * dx + dy * dy;
  for (let y = bottom; y <= top; y++) for (let x = left; x <= right; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    const t = Math.max(0, Math.min(1, ((u - vein.ax) * dx + (v - vein.ay) * dy) / lengthSquared));
    const distance = Math.hypot(u - vein.ax - dx * t, v - vein.ay - dy * t);
    const value = Math.exp(-((distance / vein.width) ** 2)) * vein.relief;
    const at = y * size + x;
    height[at] = Math.max(height[at]!, value);
  }
};

/** Original nonperiodic lamina and branching palmate venation, shared by all autumn palettes. */
export const createMapleLeafTextures = () => {
  const size = 256, relief = new Float32Array(size * size);
  const colour = new Uint8Array(size * size * 4), normals = new Uint8Array(colour.length);
  for (const vein of makeVeins()) paintVein(relief, size, vein);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), at = (y * size + x) * 4;
    const fine = smoothNoise(u * 83 + 2, v * 83 + 9) - .5;
    const cells = smoothNoise(u * 31 + 13, v * 31 + 4) - .5;
    const mottling = smoothNoise(u * 7 + 10, v * 7 + 11) - .5;
    const vein = relief[y * size + x]!;
    relief[y * size + x] = vein + cells * .027 + fine * .014;
    const shade = Math.max(.55, Math.min(1, .88 - vein * .33 + mottling * .14 + cells * .075 + fine * .028));
    const warmth = (smoothNoise(u * 4 + 7, v * 4 + 2) - .5) * .026;
    colour[at] = Math.round(Math.min(1, shade + warmth) * 255);
    colour[at + 1] = Math.round(shade * 255);
    colour[at + 2] = Math.round(Math.min(1, shade - warmth * .65) * 255);
    colour[at + 3] = 255;
  }
  const sample = (x: number, y: number) => relief[Math.max(0, Math.min(size - 1, y)) * size +
    Math.max(0, Math.min(size - 1, x))]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (sample(x + 1, y) - sample(x - 1, y)) * 2;
    const dy = (sample(x, y + 1) - sample(x, y - 1)) * 2;
    const length = Math.hypot(dx, dy, 1), at = (y * size + x) * 4;
    normals[at] = Math.round((.5 - dx / length * .5) * 255);
    normals[at + 1] = Math.round((.5 - dy / length * .5) * 255);
    normals[at + 2] = Math.round((.5 + .5 / length) * 255); normals[at + 3] = 255;
  }
  const map = new DataTexture(colour, size, size, RGBAFormat, UnsignedByteType);
  map.colorSpace = SRGBColorSpace;
  const normalMap = new DataTexture(normals, size, size, RGBAFormat, UnsignedByteType);
  for (const texture of [map, normalMap]) {
    texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
  }
  let disposed = false;
  return { map, normalMap, dispose: () => {
    if (disposed) return;
    disposed = true; map.dispose(); normalMap.dispose(); map.image.data = null; normalMap.image.data = null;
  } };
};
