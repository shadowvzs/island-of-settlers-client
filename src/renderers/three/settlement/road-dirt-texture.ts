import { fract, sinHash2 } from "../../../shared/world/noise";

const smooth = (value: number) => value * value * (3 - 2 * value);

/** Periodic baked stone/soil variation: junctions and both detail levels share the same pattern. */
export const createPeriodicTextureNoise = (cells: number) => {
  const values = Float32Array.from({ length: cells * cells }, (_, index) =>
    sinHash2(index % cells, Math.floor(index / cells)));
  return (u: number, v: number) => {
    const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(fract(x)), fy = smooth(fract(y));
    const nextX = (ix + 1) % cells, nextY = (iy + 1) % cells;
    const a = values[iy * cells + ix]! * (1 - fx) + values[iy * cells + nextX]! * fx;
    const b = values[nextY * cells + ix]! * (1 - fx) + values[nextY * cells + nextX]! * fx;
    return a * (1 - fy) + b * fy;
  };
};
const earthNoise = createPeriodicTextureNoise(6), compactedNoise = createPeriodicTextureNoise(17);
const crumbNoise = createPeriodicTextureNoise(53), wearNoise = createPeriodicTextureNoise(31);
const soil = [135, 103, 69];

/** Compacted earth and shallow, irregular stones, baked once with no extra meshes or texture fetches. */
export const paintDirtRoadTexture = (pixels: Uint8Array, relief: Uint8Array, size: number) => {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const earth = earthNoise(u, v), compacted = compactedNoise(u, v), crumbs = crumbNoise(u, v);
    const grain = sinHash2(x * 1.17, y * 1.31) - .5;
    const shade = 1 + (earth - .5) * .18 + (compacted - .5) * .12 + grain * .045;
    const offset = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = Math.round(soil[channel]! * shade + (crumbs - .5) * 8);
      relief[offset + channel] = Math.round(255 * (.38 + compacted * .055 + crumbs * .14 + grain * .035));
    }
    // Alpha carries edge wear only; the material keeps the compacted road centre opaque.
    pixels[offset + 3] = Math.round(255 * (.60 + wearNoise(u, v) * .36));
    relief[offset + 3] = 255;
  }
  // Stable world-space footprints keep stones equally sized on High and Minimal.
  for (let stone = 0; stone < 72; stone++) {
    const cx = sinHash2(stone, 97) * size, cy = sinHash2(stone, 193) * size;
    const radius = (.006 + sinHash2(stone, 271) * .013) * size;
    const aspect = .65 + sinHash2(stone, 379) * .55;
    const tone = sinHash2(stone, 431), angle = sinHash2(stone, 557) * Math.PI * 2;
    const cosine = Math.cos(angle), sine = Math.sin(angle), reach = Math.ceil(radius * 1.35);
    for (let y = Math.floor(cy) - reach; y <= Math.floor(cy) + reach; y++)
      for (let x = Math.floor(cx) - reach; x <= Math.floor(cx) + reach; x++) {
        const dx = x + .5 - cx, dy = y + .5 - cy;
        const sx = (dx * cosine + dy * sine) / radius;
        const sy = (-dx * sine + dy * cosine) / (radius * aspect);
        const distance = Math.hypot(sx, sy);
        if (distance > 1) continue;
        const px = (x % size + size) % size, py = (y % size + size) % size;
        const offset = (py * size + px) * 4;
        const buried = smooth(Math.min(1, (1 - distance) * 4));
        const shade = 1 + (-sx - sy) * .035;
        const rock = [111 + tone * 31, 102 + tone * 29, 85 + tone * 26];
        for (let channel = 0; channel < 3; channel++) {
          pixels[offset + channel] = Math.round(pixels[offset + channel]! * (1 - buried) +
            rock[channel]! * shade * buried);
          relief[offset + channel] = Math.round(relief[offset + channel]! * (1 - buried) +
            (143 + (1 - distance) * 29) * buried);
        }
      }
  }
};
