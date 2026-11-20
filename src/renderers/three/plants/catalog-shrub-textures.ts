import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace } from "three";

const grainNoise = (seed: number) => {
  let value = Math.imul(seed ^ 0x68bc21eb, 0x45d9f3b);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
};
interface SoilGrain { x: number; y: number; radius: number; shade: number }
const soilGrainShade = (grains: SoilGrain[], x: number, y: number, size: number) => {
  let shade = .38 + grainNoise(x + y * size + 173) * .18;
  for (const grain of grains) {
    const distance = Math.hypot(x - grain.x, y - grain.y) / grain.radius;
    if (distance >= 1) continue;
    shade = Math.max(shade, grain.shade * (.52 + .48 * Math.sqrt(1 - distance * distance)));
  }
  return shade;
};
/** Original deterministic painted vein, petal striation and fired-clay maps; allocated once per owner. */
const paintedMap = (kind: "leaf" | "petal" | "clay" | "soil" | "bark", size: number) => {
  const data = new Uint8Array(size * size * 4);
  const grains: SoilGrain[] = [];
  if (kind === "soil") for (let i = 0; i < 96; i++) grains.push({
    x: grainNoise(i * 19 + 3) * size, y: grainNoise(i * 23 + 7) * size,
    radius: .65 + grainNoise(i * 31 + 13) * 1.55, shade: .64 + grainNoise(i * 47 + 17) * .30
  });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    const noise = Math.sin(x * 13.17 + y * 42.13) * Math.sin(y * 7.31 + x * .63);
    let shade = .91 + noise * .06;
    if (kind === "leaf") {
      const rib = Math.exp(-Math.abs(u - .5) * 120);
      const vein = Math.exp(-Math.abs(Math.sin(v * 29 - Math.abs(u - .5) * 14)) * 20);
      shade = .79 + v * .11 + rib * .19 + vein * .12 + noise * .035;
    }
    if (kind === "petal") shade = .79 + v * .18 + Math.sin(u * 87 + v * 6) * .035 + noise * .025;
    if (kind === "clay") shade = .87 + Math.sin(v * 120) * .025 + noise * .045;
    if (kind === "bark") shade = .79 + Math.sin(u * 53 + Math.sin(v * 20) * 2) * .075 + noise * .035;
    if (kind === "soil") shade = soilGrainShade(grains, x, y, size);
    const offset = (y * size + x) * 4, value = Math.round(Math.max(0, Math.min(1, shade)) * 255);
    data[offset] = value; data[offset + 1] = value; data[offset + 2] = value; data[offset + 3] = 255;
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace; texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter; texture.needsUpdate = true;
  return texture;
};
const surfaceNormal = (source: DataTexture) => {
  const { data, height, width } = source.image;
  if (!data) throw new Error("Painted shrub texture has no pixels");
  const pixels = new Uint8Array(width * height * 4);
  const sample = (x: number, y: number) => data[((y + height) % height * width + (x + width) % width) * 4]!;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    pixels[offset] = 128 + (sample(x - 1, y) - sample(x + 1, y)) * .55;
    pixels[offset + 1] = 128 + (sample(x, y - 1) - sample(x, y + 1)) * .55;
    pixels[offset + 2] = 252; pixels[offset + 3] = 255;
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat);
  texture.generateMipmaps = true; texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter; texture.needsUpdate = true;
  return texture;
};
export const createCatalogShrubTextures = (detailed: boolean) => {
  const leaf = paintedMap("leaf", detailed ? 128 : 64), petal = paintedMap("petal", detailed ? 128 : 64);
  const clay = paintedMap("clay", 64), soil = paintedMap("soil", 64), bark = paintedMap("bark", 128);
  const leafNormal = surfaceNormal(leaf), clayNormal = surfaceNormal(clay), soilNormal = surfaceNormal(soil);
  const maps = { bark, clay, clayNormal, leaf, leafNormal, petal, soil, soilNormal };
  return { maps, dispose: () => Object.values(maps).forEach(texture => texture.dispose()) };
};
