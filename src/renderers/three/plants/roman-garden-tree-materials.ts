import { DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial,
  RepeatWrapping, RGBAFormat, SRGBColorSpace } from "three";

import type { RomanGardenTreeSpecies } from "../../../render-common/plants/roman-garden-tree-graph";

const noise = (x: number, y: number, periodX = 64, periodY = 64) => {
  const hash = (a: number, b: number) => {
    const wrappedX = (a % periodX + periodX) % periodX;
    const wrappedY = (b % periodY + periodY) % periodY;
    const value = Math.sin(wrappedX * 127.1 + wrappedY * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = (x - ix) ** 2 * (3 - 2 * (x - ix));
  const ty = (y - iy) ** 2 * (3 - 2 * (y - iy));
  return hash(ix, iy) * (1 - tx) * (1 - ty) + hash(ix + 1, iy) * tx * (1 - ty) +
    hash(ix, iy + 1) * (1 - tx) * ty + hash(ix + 1, iy + 1) * tx * ty;
};

const barkHeight = (u: number, v: number, willow: boolean) => {
  const frequency = willow ? 17 : 27;
  const warp = (noise(u * 5, v * 8, 5, 8) - .5) * 1.2 +
    (noise(u * 11, v * 19, 11, 19) - .5) * .32;
  const across = u * frequency + warp;
  const fraction = across - Math.floor(across);
  const crack = Math.exp(-((Math.min(fraction, 1 - fraction) / .050) ** 2));
  const interruptions = .38 + noise(u * 9, v * 13, 9, 13) * .62;
  const shoulders = Math.sin(fraction * Math.PI) ** .65 * .17;
  const chips = noise(u * 37, v * 41, 37, 41);
  const crossBreak = Math.max(0, .24 - chips) * (willow ? .42 : .18);
  const grain = (noise(u * 83, v * 57, 83, 57) - .5) * .055;
  return .73 + shoulders + grain - crack * interruptions * .39 - crossBreak;
};

/** Smooth overlapping imbricate scales, including narrow raised keels, rather than constant square cells. */
const cypressScaleHeight = (u: number, v: number) => {
  const row = Math.floor(v * 29);
  let scales = 0, keels = 0;
  for (let neighbour = row - 1; neighbour <= row + 1; neighbour++) {
    const horizontal = u * 17 + (neighbour % 2) * .5;
    const x = horizontal - Math.floor(horizontal) - .5;
    const y = v * 29 - neighbour - .48;
    const oval = Math.exp(-((x / .39) ** 4) - (y / .64) ** 2);
    scales += oval * (.80 + noise(Math.floor(horizontal), neighbour) * .20);
    keels += oval * Math.exp(-((x / .045) ** 2)) * .05;
  }
  return .67 + scales * .15 + keels + noise(u * 61, v * 97, 61, 97) * .035;
};

const texture = (width: number, height: number, paint: (u: number, v: number) => readonly number[]) => {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = paint(x / width, y / height), index = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) pixels[index + channel] = Math.round(value[channel]!);
    pixels[index + 3] = 255;
  }
  const result = new DataTexture(pixels, width, height, RGBAFormat);
  result.colorSpace = SRGBColorSpace; result.generateMipmaps = true;
  result.magFilter = LinearFilter; result.minFilter = LinearMipmapLinearFilter;
  result.wrapS = RepeatWrapping; result.wrapT = RepeatWrapping; result.needsUpdate = true;
  return result;
};

/** Original furrowed grey willow and warm fibrous cypress retain separate colour and microstructure. */
export const createRomanGardenTreeMaterials = (species: RomanGardenTreeSpecies) => {
  const willow = species === "willow-tree";
  const barkMap = texture(256, 512, (u, v) => {
    const tone = barkHeight(u, v, willow);
    const base = willow ? [191, 164, 116] : [169, 119, 77];
    return base.map(channel => channel * tone);
  });
  barkMap.repeat.y = .13;
  const leafMap = texture(256, 512, (u, v) => {
    const distance = Math.abs(u - .5);
    const midrib = Math.exp(-((distance / .016) ** 2));
    const ribs = Math.exp(-Math.abs(Math.sin((v - distance * .60) * Math.PI * 15)) * 24);
    const shade = willow ? .77 + midrib * .18 + ribs * .10 : cypressScaleHeight(u, v);
    return [shade * 255, shade * 255, shade * (willow ? 232 : 249)];
  });
  const bark = new MeshStandardMaterial({ bumpMap: barkMap, bumpScale: willow ? .016 : .010,
    map: barkMap, roughness: .96, vertexColors: true });
  const foliage = new MeshStandardMaterial({ bumpMap: leafMap, bumpScale: willow ? .0005 : .004,
    color: willow ? "#92cf50" : "#668e48", map: leafMap, roughness: .88,
    side: DoubleSide, vertexColors: true });
  bark.name = `${species}-furrowed-bark`; foliage.name = `${species}-dimensional-foliage`;
  let disposed = false;
  return { bark, foliage, dispose: () => {
    if (disposed) return;
    disposed = true;
    bark.dispose(); foliage.dispose(); barkMap.dispose(); leafMap.dispose();
  } };
};

export type RomanGardenTreeMaterials = ReturnType<typeof createRomanGardenTreeMaterials>;
