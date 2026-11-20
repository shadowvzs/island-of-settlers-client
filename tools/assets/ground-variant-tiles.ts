import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Bakes the render-only ground variant tiles (GROUND-PALETTE step 2, owner 2026-11-17) from CC0 photo sets into
 * the game's 512² layer format: `<id>-albedo.png` (RGB), `<id>-relief.png` (R height, G normal x, B normal z,
 * the painted tiles' convention: normal = (-dh/dx, -dh/drow)) and `<id>-surface.png` (R ambient occlusion,
 * G roughness). Albedo is regraded to the game palette (mean/std transfer to `target`, contrast `contrast`), so
 * the photo reads as one of our painted tiles; the ground shader tints it further where the variant needs it.
 *
 * Usage (from island-of-settlers-client): npx tsx tools/assets/ground-variant-tiles.ts <sources folder> [--only <id>]
 *   The sources folder holds one sub-folder per set as downloaded (Poly Haven 1k PNG: `<set>_diff_1k.png`,
 *   `_nor_gl_1k.png`, `_arm_1k.png`, `_disp_1k.png`; ambientCG 1K-PNG: `<set>_1K-PNG_Color.png`, ...).
 *   `SHARP` overrides the sharp module path (default: the asset-tools checkout beside the client).
 * Raw downloads never enter the repository; only the baked tiles under assets/ground-variants/ ship. The map
 * editor's tile icons (`assets/editor-icons/tile-<id>.webp`, 1x and 2x, the rounded tile crop of the other
 * ground icons) are cut from the baked albedo.
 */
const SIZE = 512;
/** Height deviation of the painted tiles (bytes): every variant's height is normalised to it. */
const HEIGHT_DEVIATION = 40;
const OUTPUT = resolve(import.meta.dirname, "../../assets/ground-variants");
const SHARP = process.env.SHARP ?? resolve(import.meta.dirname,
  "../../../island-of-settlers-asset-tools/node_modules/sharp/dist/index.mjs");

interface VariantSource {
  /** Albedo contrast against the regraded mean (game tiles are calmer than photos). */
  contrast: number;
  files: { albedo: string; arm?: string; ao?: string; height: string; normal: string; roughness?: string };
  /** The normal map's green axis: "gl" (y up, flipped to rows) or "dx" (y down, as the tiles). */
  green: "dx" | "gl";
  /** Editor-paintable variants get tile icons; the crown litter tiles are laid by the trees only. */
  icon: boolean;
  id: string;
  /** Height contrast: the height's deviation is normalised to HEIGHT_DEVIATION × relief (the height blend). */
  relief: number;
  set: string;
  /** Mean albedo of the baked tile (display bytes). */
  target: readonly [number, number, number];
}

const polyHaven = (set: string) => ({
  albedo: `${set}_diff_1k.png`, arm: `${set}_arm_1k.png`, height: `${set}_disp_1k.png`, normal: `${set}_nor_gl_1k.png`
});

const VARIANTS: readonly VariantSource[] = [
  // Neutral grey-beige: the shader tints it with the beach sand palette or the rock grey.
  { contrast: 0.85, files: polyHaven("rocks_ground_01"), green: "gl", icon: true, id: "coarse-stones", relief: 1,
    set: "rocks_ground_01", target: [150, 146, 140] },
  // Moss green a little brighter and greener than the forest floor (59/78/39), less bright than the mock.
  { contrast: 0.75, files: {
    albedo: "Ground037_1K-PNG_Color.png", ao: "Ground037_1K-PNG_AmbientOcclusion.png",
    height: "Ground037_1K-PNG_Displacement.png", normal: "Ground037_1K-PNG_NormalDX.png",
    roughness: "Ground037_1K-PNG_Roughness.png"
  }, green: "dx", icon: true, id: "moss", relief: 0.8, set: "Ground037", target: [66, 92, 38] },
  { contrast: 0.85, files: polyHaven("brown_mud_02"), green: "gl", icon: true, id: "swamp-mud", relief: 0.9,
    set: "brown_mud_02", target: [70, 57, 42] },
  // Light dry earth; the shader turns it white (salt flat) on desert flats.
  { contrast: 0.8, files: polyHaven("mud_cracked_dry_03"), green: "gl", icon: true, id: "cracked-earth", relief: 1,
    set: "mud_cracked_dry_03", target: [168, 132, 94] },
  // Broadleaf litter (step 4): neutral brown leaves, no autumn colours (the season plan owns those).
  { contrast: 0.8, files: polyHaven("leaves_forest_ground"), green: "gl", icon: false, id: "leaf-litter",
    relief: 0.9, set: "leaves_forest_ground", target: [100, 80, 54] },
  // Rounded river pebbles (step 6): river beds and banks, waterfall pools and the stony shore; neutral grey-beige,
  // the shader wets and tints them (rocks_ground_01 stays the angular scree).
  { contrast: 0.85, files: polyHaven("ganges_river_pebbles"), green: "gl", icon: false, id: "river-pebbles",
    relief: 1, set: "ganges_river_pebbles", target: [146, 140, 130] },
  // Basalt (step 5): dark, fissured volcanic rock on the basalt rock palette's gentle rock.
  { contrast: 0.9, files: polyHaven("dark_rock"), green: "gl", icon: false, id: "basalt", relief: 1,
    set: "dark_rock", target: [62, 60, 60] }
];

type Sharp = (input: string) => {
  raw: () => { toBuffer: (options: { resolveWithObject: true }) =>
    Promise<{ data: Buffer; info: { channels: number } }> };
  removeAlpha: () => ReturnType<Sharp>;
  resize: (width: number, height: number, options: { kernel: string }) => ReturnType<Sharp>;
};
type SharpWriter = (input: Buffer, options: { raw: { channels: 3; height: number; width: number } }) => {
  png: (options: { compressionLevel: number }) => { toFile: (path: string) => Promise<unknown> };
  resize: (width: number, height: number) => {
    composite: (layers: { blend: string; input: Buffer }[]) => {
      webp: (options: { lossless: boolean }) => { toFile: (path: string) => Promise<unknown> };
    };
  };
};

const sharp = (await import(SHARP)).default as Sharp & SharpWriter;

/** One map at SIZE², as `channels` bytes per pixel (RGB maps lose their alpha). */
const readMap = async (path: string) => {
  const { data, info } = await sharp(path).resize(SIZE, SIZE, { kernel: "lanczos3" }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { channels: info.channels, data };
};

const channelStats = (data: Buffer, channels: number, channel: number) => {
  let sum = 0, square = 0;
  const count = data.length / channels;
  for (let index = channel; index < data.length; index += channels) {
    sum += data[index]!;
    square += data[index]! ** 2;
  }
  const mean = sum / count;
  return { mean, std: Math.sqrt(Math.max(0, square / count - mean * mean)) };
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** Mean transfer per channel to the target, contrast scaled on the source's own deviation. */
const regradeAlbedo = (map: { channels: number; data: Buffer }, source: VariantSource) => {
  const out = Buffer.alloc(SIZE * SIZE * 3);
  for (let channel = 0; channel < 3; channel += 1) {
    const { mean } = channelStats(map.data, map.channels, channel);
    for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
      const value = map.data[pixel * map.channels + channel]!;
      out[pixel * 3 + channel] = clampByte(source.target[channel]! + (value - mean) * source.contrast);
    }
  }
  return out;
};

/** Height (contrast around its mean), normal x / z in the painted tiles' convention. */
const packRelief = (height: { channels: number; data: Buffer }, normal: { channels: number; data: Buffer },
  source: VariantSource) => {
  const out = Buffer.alloc(SIZE * SIZE * 3);
  const { mean, std } = channelStats(height.data, height.channels, 0);
  const scale = HEIGHT_DEVIATION * source.relief / Math.max(std, 1);
  for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
    out[pixel * 3] = clampByte(128 + (height.data[pixel * height.channels]! - mean) * scale);
    out[pixel * 3 + 1] = normal.data[pixel * normal.channels]!;
    const green = normal.data[pixel * normal.channels + 1]!;
    out[pixel * 3 + 2] = source.green === "gl" ? 255 - green : green;
  }
  return out;
};

const packSurface = async (folder: string, source: VariantSource) => {
  const out = Buffer.alloc(SIZE * SIZE * 3);
  if (source.files.arm) {
    const arm = await readMap(join(folder, source.files.arm));
    for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
      out[pixel * 3] = arm.data[pixel * arm.channels]!;
      out[pixel * 3 + 1] = arm.data[pixel * arm.channels + 1]!;
    }
    return out;
  }
  const ao = await readMap(join(folder, source.files.ao!));
  const roughness = await readMap(join(folder, source.files.roughness!));
  for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
    out[pixel * 3] = ao.data[pixel * ao.channels]!;
    out[pixel * 3 + 1] = roughness.data[pixel * roughness.channels]!;
  }
  return out;
};

const writePng = (data: Buffer, path: string) =>
  sharp(data, { raw: { channels: 3, height: SIZE, width: SIZE } }).png({ compressionLevel: 9 }).toFile(path);

const ICONS = resolve(import.meta.dirname, "../../assets/editor-icons");

/** The editor tile icon: a crop of the albedo with the rounded corners of the other ground tiles. */
const writeIcon = async (albedo: Buffer, id: string, size: number, suffix: string) => {
  const radius = Math.round(size * 0.16);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
  await sharp(albedo, { raw: { channels: 3, height: SIZE, width: SIZE } }).resize(size, size)
    .composite([{ blend: "dest-in", input: mask }]).webp({ lossless: true })
    .toFile(join(ICONS, `tile-${id}${suffix}.webp`));
};

const bake = async (sources: string, source: VariantSource) => {
  const folder = join(sources, source.set);
  const albedo = regradeAlbedo(await readMap(join(folder, source.files.albedo)), source);
  const relief = packRelief(await readMap(join(folder, source.files.height)),
    await readMap(join(folder, source.files.normal)), source);
  const surface = await packSurface(folder, source);
  await writePng(albedo, join(OUTPUT, `${source.id}-albedo.png`));
  await writePng(relief, join(OUTPUT, `${source.id}-relief.png`));
  await writePng(surface, join(OUTPUT, `${source.id}-surface.png`));
  if (source.icon) {
    await writeIcon(albedo, source.id, 40, "");
    await writeIcon(albedo, source.id, 80, "@2x");
  }
  const stats = [0, 1, 2].map(channel => Math.round(channelStats(albedo, 3, channel).mean));
  console.log(`${source.id}: ${source.set} -> mean albedo ${stats.join("/")}`);
};

/**
 * The editor icon of the tilled garden soil (step 6; no tile of its own: the shader furrows the island's dirt tile):
 * the brown mud photo regraded to the moist soil colour, shaded in soft, slightly wavy furrows.
 */
const TILLED_ICON = { furrows: 7, mean: [83, 64, 45] as const, shade: [0.7, 1.08] as const } as const;

const bakeTilledIcon = async (sources: string) => {
  const mud = VARIANTS.find(source => source.id === "swamp-mud")!;
  const albedo = regradeAlbedo(await readMap(join(sources, mud.set, mud.files.albedo)),
    { ...mud, contrast: 0.7, target: TILLED_ICON.mean });
  for (let pixel = 0; pixel < SIZE * SIZE; pixel += 1) {
    const x = pixel % SIZE, y = Math.floor(pixel / SIZE);
    const wave = Math.sin(((y + Math.sin(x * 0.02) * 6) / SIZE) * TILLED_ICON.furrows * Math.PI * 2);
    const profile = Math.min(1, Math.max(0, (wave + 0.7) / 1.55));
    const smooth = profile * profile * (3 - 2 * profile);
    const shade = TILLED_ICON.shade[0] + (TILLED_ICON.shade[1] - TILLED_ICON.shade[0]) * smooth;
    for (let channel = 0; channel < 3; channel += 1) {
      albedo[pixel * 3 + channel] = clampByte(albedo[pixel * 3 + channel]! * shade);
    }
  }
  await writeIcon(albedo, "tilled-soil", 40, "");
  await writeIcon(albedo, "tilled-soil", 80, "@2x");
  console.log("tilled-soil: editor icon");
};

const sources = process.argv[2];
if (!sources) throw new Error("usage: ground-variant-tiles.ts <sources folder> [--only <id>]");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
mkdirSync(OUTPUT, { recursive: true });
for (const source of VARIANTS) if (!only || source.id === only) await bake(resolve(sources), source);
if (!only || only === "tilled-soil") await bakeTilledIcon(resolve(sources));
writeFileSync(join(OUTPUT, "SOURCES.md"), [
  "# Ground variant tiles (CC0)",
  "",
  "Baked by `tools/assets/ground-variant-tiles.ts` (512², regraded to the game palette). Sources, all CC0 1.0:",
  "",
  ...VARIANTS.map(({ id, set }) => set === "Ground037"
    ? `- \`${id}\`: ambientCG Ground037 (https://ambientcg.com/view?id=Ground037)`
    : `- \`${id}\`: Poly Haven ${set} (https://polyhaven.com/a/${set})`),
  "- `pine-needles`: procedural, own work (`tools/assets/pine-needle-tile.ts`)",
  ""
].join("\n"));
