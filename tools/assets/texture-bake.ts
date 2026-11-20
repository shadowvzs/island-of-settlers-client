import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GlbFile } from "../../src/render-common/glb-reader";
import type { SkinSource } from "./gltf-skin-sampler";

/**
 * Bakes a source's base colour textures into vertex colours (offline): each vertex samples its
 * material's albedo at its uv (images decoded by Python/PIL). Returns rgb triples (0..1, the
 * texture's sRGB values, as the critter palettes are authored); vertices without a texture get
 * the material's colour factor. The alpha bake finds the cut-out parts (hair cards).
 */

interface Image {
  data: Uint8Array;
  height: number;
  width: number;
}

const decodeImages = (file: GlbFile) => {
  const json = file.json as any;
  const directory = mkdtempSync(join(tmpdir(), "critter-bake-"));
  const images: Image[] = [];
  try {
    (json.images ?? []).forEach((image: any, index: number) => {
      const view = json.bufferViews[image.bufferView];
      const bytes = new Uint8Array(file.binary.buffer, file.binary.byteOffset + (view.byteOffset ?? 0), view.byteLength);
      const input = join(directory, `${index}.img`);
      writeFileSync(input, bytes);
      const output = join(directory, `${index}.rgb`);
      const size = execFileSync("python3", ["-c", [
        "import sys; from PIL import Image",
        "im = Image.open(sys.argv[1]).convert('RGBA'); open(sys.argv[2], 'wb').write(im.tobytes())",
        "print(im.width, im.height)"
      ].join("\n"), input, output]).toString().trim().split(" ").map(Number);
      images.push({ data: new Uint8Array(readFileSync(output)), height: size[1]!, width: size[0]! });
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
  return images;
};


/** Bilinear-free nearest sample (repeat wrap, rgba 0..1) of an image at uv. */
const sample = (image: Image, u: number, v: number) => {
  const x = Math.floor((((u % 1) + 1) % 1) * image.width);
  const y = Math.floor((((v % 1) + 1) % 1) * image.height);
  const at = (Math.min(image.height - 1, y) * image.width + Math.min(image.width - 1, x)) * 4;
  return Array.from(image.data.subarray(at, at + 4), (channel) => channel / 255);
};

/** Base colour factor and texture of a material (metal-rough or the spec-gloss extension). */
const getBaseColor = (material: any): { factor: number[]; textureIndex?: number } => {
  const gloss = material?.extensions?.KHR_materials_pbrSpecularGlossiness;
  if (gloss) return { factor: gloss.diffuseFactor ?? [1, 1, 1, 1], textureIndex: gloss.diffuseTexture?.index };
  const pbr = material?.pbrMetallicRoughness;
  return { factor: pbr?.baseColorFactor ?? [1, 1, 1, 1], textureIndex: pbr?.baseColorTexture?.index };
};

/** The mesh data the bake reads (a skin source or a static mesh). */
export type BakeSource = Pick<SkinSource, "file" | "materials" | "positions" | "uvs">;

/** Vertex colours (rgb) and the texture alpha of every vertex. */
export const bakeVertexColorsAndAlpha = (source: BakeSource) => {
  const json = source.file.json as any;
  const images = decodeImages(source.file);
  const count = source.positions.length / 3;
  const colors = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const material = json.materials?.[source.materials[vertex]!];
    const { factor, textureIndex } = getBaseColor(material);
    const texture = textureIndex === undefined ? null : json.textures[textureIndex];
    const image = texture ? images[texture.source ?? texture.extensions?.EXT_texture_webp?.source] : undefined;
    const color = image ? sample(image, source.uvs[vertex * 2]!, source.uvs[vertex * 2 + 1]!) : [1, 1, 1, 1];
    colors.set(color.slice(0, 3).map((channel, index) => channel * factor[index]!), vertex * 3);
    alpha[vertex] = color[3]! * (factor[3] ?? 1);
  }
  return { alpha, colors };
};

export const bakeVertexColors = (source: BakeSource) => bakeVertexColorsAndAlpha(source).colors;
