import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace,
  UnsignedByteType } from "three";

type Rgb = readonly [number, number, number];
type Surface = (u: number, v: number) => { colour: Rgb; height: number };

/** Culm atlas columns (u ranges): the three culm skins, papery sheath, granular soil. */
export const BAMBOO_ATLAS = Object.freeze({
  plain: [0, .2], "golden-striped": [.2, .4], "green-grooved": [.4, .6], sheath: [.6, .8], soil: [.8, 1]
} as const satisfies Record<string, readonly [number, number]>);
export type BambooAtlasRegion = keyof typeof BAMBOO_ATLAS;

const fract = (value: number) => value - Math.floor(value);
const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const smooth = (value: number) => value * value * (3 - 2 * value);
/** Tileable value noise on a `period` lattice. */
const noise = (u: number, v: number, period: number) => {
  const x = u * period, y = v * period, ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy), wrap = (value: number) => (value % period + period) % period;
  const at = (dx: number, dy: number) => hash(wrap(ix + dx), wrap(iy + dy));
  return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
};
const band = (value: number, from: number, to: number, soft: number) =>
  Math.min(1, Math.max(0, (value - from) / soft)) * Math.min(1, Math.max(0, (to - value) / soft));
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t];

/** Culm skin: fine longitudinal grain, raised node ridge with its sheath scar, waxy band below the next node. */
/** Painted skins: base and stripe colours of the golden (green-striped) and green (golden-grooved) culms. */
const PAINTED_SKINS = {
  "golden-striped": { base: [1, .8, .24], stripe: [.24, .6, .16], stripes: [.08, .31, .55, .79] },
  "green-grooved": { base: [.24, .6, .12], stripe: [1, .82, .26], stripes: [.2, .7] }
} as const satisfies Record<string, { base: Rgb; stripe: Rgb; stripes: readonly number[] }>;
type PaintedSkin = keyof typeof PAINTED_SKINS;

const skinColour = (skin: PaintedSkin | undefined, u: number, v: number, grain: number): Rgb => {
  const tone = .9 + grain * .1;
  if (!skin) return [.86 + grain * .1, .86 + grain * .1, .84 + grain * .08];
  const { base, stripe, stripes } = PAINTED_SKINS[skin];
  const wobble = noise(u, v * .5, 8) * .05;
  const amount = stripes.reduce((sum, centre, index) =>
    Math.max(sum, band(fract(u + wobble), centre - .025 - index % 2 * .02, centre + .03, .012)), 0);
  const colour = mix3(base, stripe, amount * .92);
  return [colour[0] * tone, colour[1] * tone, colour[2] * tone];
};

/** Culm skin: fine longitudinal grain, raised node ridge with its sheath scar, waxy band below the next node. */
const culmSurface = (skin?: PaintedSkin): Surface => (u, v) => {
  const grain = noise(u * 2, v * .25, 48) * .5 + noise(u * 4, v * .5, 64) * .5;
  const ridge = Math.exp(-((v / .022) ** 2)), scar = band(v, .03, .055, .008);
  const wax = band(v, .86, .985, .03);
  let colour = skinColour(skin, u, v, grain);
  colour = mix3(colour, [.98, .98, .95], wax * .4);
  colour = mix3(colour, [.62, .58, .40], ridge * .55 + scar * .35);
  return { colour, height: ridge * .9 - scar * .25 + grain * .12 };
};

/** Papery culm sheath: dense parallel fibres, sparse mottling and a clean, paler margin. */
const sheathSurface: Surface = (u, v) => {
  const fibre = noise(u * 6, v * .3, 96) * .7 + noise(u * 12, v * .2, 128) * .3, mottle = noise(u, v, 22);
  const spot = mottle > .8 ? (mottle - .8) * 1.6 : 0;
  // Clean edge: a slightly paler, even margin at the tongue instead of a dark ragged rim.
  const margin = band(v, .9, 1.05, .06) + band(u, -.1, .06, .04) + band(u, .94, 1.1, .04);
  const colour = mix3(mix3([.8 + fibre * .2, .78 + fibre * .2, .74 + fibre * .18], [.42, .3, .2], spot * .7),
    [.95, .9, .78], Math.min(1, margin) * .35);
  return { colour, height: fibre * .5 + spot * .2 };
};

/** Rich soil with granules and small pebbles. */
const soilSurface: Surface = (u, v) => {
  const grain = noise(u, v, 128), crumb = noise(u + .37, v + .11, 48), pebble = noise(u + .7, v + .2, 32);
  const stone = pebble > .8 ? 1 : 0;
  const colour = mix3([.56 + grain * .3 + crumb * .1, .54 + grain * .28 + crumb * .1, .5 + grain * .25],
    [.95, .92, .84], stone * .6);
  return { colour, height: grain * .18 + crumb * .14 + stone * .3 };
};

/** Lanceolate monocot lamina: pale midrib, parallel veins, faint tessellate veinlets, slightly paler margin. */
const leafSurface: Surface = (u, v) => {
  const across = Math.abs(u - .5) * 2;
  const midrib = Math.exp(-((across / .05) ** 2));
  const veins = Math.max(0, Math.cos(across * Math.PI * 11)) ** 14 * (1 - midrib) * (1 - band(across, .9, 1.1, .05));
  const groove = Math.exp(-(((across - .07) / .03) ** 2));
  const tessellate = Math.max(0, Math.cos(v * Math.PI * 70)) ** 30 * .4;
  const margin = band(across, .86, 1.1, .06);
  const base = .84 + noise(u, v, 16) * .06 - (1 - v) * .05;
  let colour: Rgb = [base, base, base];
  colour = mix3(colour, [.62, .66, .5], groove * .35);
  colour = mix3(colour, [1, 1, .88], veins * .42 + tessellate * .1);
  colour = mix3(colour, [1, 1, .82], midrib * .55 + margin * .25);
  return { colour, height: midrib * .8 - groove * .2 + veins * .35 + tessellate * .1 };
};

const configure = (texture: DataTexture) => {
  texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
};

/** Albedo and tangent-space normal from analytic surfaces placed side by side. */
const paint = (width: number, height: number, columns: readonly Surface[], relief: number) => {
  const colour = new Uint8Array(width * height * 4), normal = new Uint8Array(colour.length);
  const columnWidth = width / columns.length;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = Math.min(columns.length - 1, Math.floor(x / columnWidth)), surface = columns[column]!;
    const u = (x - column * columnWidth) / columnWidth, v = y / (height - 1), at = (y * width + x) * 4;
    const sample = surface(u, v);
    sample.colour.forEach((value, channel) => { colour[at + channel] = Math.round(Math.min(1, value) * 255); });
    colour[at + 3] = 255;
    const step = 1 / columnWidth, rise = 1 / height;
    const dx = (surface(fract(u + step), v).height - surface(fract(u - step + 1), v).height) * relief;
    const dy = (surface(u, Math.min(1, v + rise)).height - surface(u, Math.max(0, v - rise)).height) * relief;
    const length = Math.hypot(dx, dy, 1);
    normal[at] = Math.round((-.5 * dx / length + .5) * 255);
    normal[at + 1] = Math.round((-.5 * dy / length + .5) * 255);
    normal[at + 2] = Math.round((.5 / length + .5) * 255);
    normal[at + 3] = 255;
  }
  const map = configure(new DataTexture(colour, width, height, RGBAFormat, UnsignedByteType));
  map.colorSpace = SRGBColorSpace;
  return { map, normalMap: configure(new DataTexture(normal, width, height, RGBAFormat, UnsignedByteType)) };
};

/** Original procedural maps (no reference pixels); one pair per detail level owner. */
export const createBambooTextures = (detailed: boolean) => {
  const culm = paint(detailed ? 640 : 320, detailed ? 256 : 128,
    [culmSurface(), culmSurface("golden-striped"), culmSurface("green-grooved"), sheathSurface, soilSurface], 2.2);
  const leaf = paint(detailed ? 64 : 32, detailed ? 256 : 128, [leafSurface], 1.6);
  const textures = [culm.map, culm.normalMap, leaf.map, leaf.normalMap];
  return { culm, leaf, dispose: () => { for (const texture of textures) texture.dispose(); } };
};
export type BambooTextures = ReturnType<typeof createBambooTextures>;
