import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping,
  RGBAFormat, SRGBColorSpace } from "three";

const noise = (x: number, y: number, periodX: number, periodY: number) => {
  const hash = (a: number, b: number) => {
    a = (a % periodX + periodX) % periodX; b = (b % periodY + periodY) % periodY;
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) +
    (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
};

/** Fine continuous fibres complement actual twined wood; no painted cobblestone-like knot loops. */
export const createWisteriaTreeBark = (detailed: boolean) => {
  const width = detailed ? 256 : 128, height = width * 2;
  const albedo = new Uint8Array(width * height * 4), normals = new Uint8Array(albedo.length);
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    const wander = .012 * Math.sin(v * Math.PI * 2) + .008 * Math.sin(v * Math.PI * 6 + u * Math.PI * 2);
    const fibres = Math.abs(Math.sin((u + wander) * Math.PI * 30 + noise(u * 8, v * 3, 8, 3) * .8));
    const fine = noise(u * 88, v * 17, 88, 17), patches = noise(u * 7, v * 6, 7, 6);
    const channel = (1 - fibres) ** 9;
    const shade = 150 + patches * 24 + fine * 9 - channel * 19;
    const offset = (y * width + x) * 4;
    albedo.set([shade * 1.02, shade * .98, shade * .91, 255], offset);
    field[y * width + x] = .48 + patches * .10 + fine * .025 - channel * .07;
  }
  const at = (x: number, y: number) => field[((y + height) % height) * width + (x + width) % width]!;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (at(x - 1, y) - at(x + 1, y)) * 1.7;
    const dy = (at(x, y - 1) - at(x, y + 1)) * 1.7, length = Math.hypot(dx, dy, 1);
    normals.set([(dx / length * .5 + .5) * 255, (dy / length * .5 + .5) * 255,
      (1 / length * .5 + .5) * 255, 255], (y * width + x) * 4);
  }
  const texture = (pixels: Uint8Array, normal = false) => {
    const map = new DataTexture(pixels, width, height, RGBAFormat);
    map.colorSpace = normal ? NoColorSpace : SRGBColorSpace;
    map.wrapS = map.wrapT = RepeatWrapping; map.magFilter = LinearFilter;
    map.minFilter = LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
    return map;
  };
  const map = texture(albedo), normalMap = texture(normals, true);
  let disposed = false;
  return { map, normalMap, dispose: () => {
    if (disposed) return;
    disposed = true; map.dispose(); normalMap.dispose(); map.image.data = null; normalMap.image.data = null;
  } };
};
