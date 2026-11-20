import cattailGlb from "../../../../assets/models/plants/cattail/cattail.glb?url&inline";
import type { Random } from "../../../shared/world/rng";
import { decodeDataUrl, readAccessor, readGlb } from "../../glb-reader";
import { NO_UV, type PropMesh, type Vec3 } from "../mesh-builder";
import { RIVER_GREENS, RIVER_ROOT_SHADE, shaded } from "./plant-colors";

/**
 * Cattail clump from the shipped model (assets/models/plants/cattail, SXuno, CC-BY-4.0, built
 * by ../island-of-settlers-asset-tools/src/build-cattail.ts: ~450 triangles, colours baked into the vertices). The GLB
 * is inlined by Vite, so the synchronous prop mesh pipeline (world worker, tests) decodes it
 * without a fetch.
 */

export const CATTAIL_BROWN: Vec3 = [0.33, 0.2, 0.11];

/** Clump height (cells) per variant; variant 1 is mirrored so neighbours differ. */
const VARIANT_HEIGHTS = [0.7, 0.78, 0.86];
const MIRRORED_VARIANT = 1;
/**
 * Bend of the tips (plants with a stem path use flex; this mesh bends by height): the stiff
 * stems and seed heads lean as one piece, the long leaves bend further downwind.
 */
const FLEX = { leaf: 1.15, stem: 0.85 } as const;
/**
 * Leaf tip shiver (flutter weight at the tip): small, so the long blades never ripple like weed
 * in a current; they lean and spring back with the gusts (the stem bend) and only their tips
 * shiver.
 */
const LEAF_SHIVER = 0.35;
const CONTACT_RADIUS = 0.2;

interface CattailSource {
  colors: Float32Array;
  flutter: Float32Array;
  height: number;
  indices: Uint16Array;
  normals: Float32Array;
  positions: Float32Array;
}

/** Mean colour of the vertices of one part (flutter 1 leaves, 0 seed heads). */
const getPartMean = (colors: Float32Array, flutter: Float32Array, part: number): Vec3 => {
  const sum = [0, 0, 0];
  let count = 0;
  flutter.forEach((weight, vertex) => {
    if (weight !== part) return;
    for (let channel = 0; channel < 3; channel += 1) sum[channel]! += colors[vertex * 3 + channel]!;
    count += 1;
  });
  return [sum[0]! / count, sum[1]! / count, sum[2]! / count];
};

/** Share of the texture's tonal variation kept (its pale midrib bands land on whole vertices). */
const TEXTURE_VARIATION = 0.3;

/**
 * Maps the baked texture colours per part onto the island palette (river greens, cattail
 * brown): the part's mean becomes the palette colour, the model's variation around it is kept
 * at TEXTURE_VARIATION, so the colour identity is the procedural plants'.
 */
const toPalette = (colors: Float32Array, flutter: Float32Array) => {
  const targets: Record<number, Vec3> = { 0: CATTAIL_BROWN, 1: RIVER_GREENS.base };
  const means = [0, 1].map((part) => getPartMean(colors, flutter, part));
  return colors.map((value, index) => {
    const part = flutter[Math.floor(index / 3)]!;
    const mean = Math.max(means[part]![index % 3]!, 1e-3);
    return targets[part]![index % 3]! * (1 + (value / mean - 1) * TEXTURE_VARIATION);
  });
};

let source: CattailSource | null = null;

const loadSource = (): CattailSource => {
  if (source) return source;
  const file = readGlb(decodeDataUrl(cattailGlb));
  const primitive = file.json.meshes[0]!.primitives[0]!;
  const positions = readAccessor(file, primitive.attributes.POSITION!);
  const flutter = readAccessor(file, primitive.attributes._FLUTTER!);
  const colors = toPalette(readAccessor(file, primitive.attributes.COLOR_0!), flutter);
  let height = 0.01;
  for (let index = 1; index < positions.length; index += 3)
    height = Math.max(height, positions[index]!);
  source = {
    colors,
    flutter,
    height,
    indices: Uint16Array.from(readAccessor(file, primitive.indices)),
    normals: readAccessor(file, primitive.attributes.NORMAL!),
    positions
  };
  return source;
};

/** Mirror on x: positions and normals flip, so does the triangle winding. */
const mirrorX = (mesh: PropMesh) => {
  for (let index = 0; index < mesh.positions.length; index += 3) {
    mesh.positions[index]! *= -1;
    mesh.normals[index]! *= -1;
  }
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const second = mesh.indices[index + 1]!;
    mesh.indices[index + 1] = mesh.indices[index + 2]!;
    mesh.indices[index + 2] = second;
  }
};

/** Bend by height (rooted foot, stiff spikes, leaves bend more), a shiver at the leaf tips. */
const createWind = (positions: Float32Array, flutter: Float32Array, height: number) => {
  const wind = new Float32Array(flutter.length * 2);
  flutter.forEach((leaf, vertex) => {
    const relative = Math.max(0, positions[vertex * 3 + 1]! / height);
    const flex = FLEX.stem + (FLEX.leaf - FLEX.stem) * leaf;
    wind[vertex * 2] = flex * relative * relative;
    wind[vertex * 2 + 1] = leaf * relative * relative * LEAF_SHIVER;
  });
  return wind;
};

/** Root zone shade and a little per-vertex jitter, like the procedural river plants. */
const shadeColors = (mesh: PropMesh, baked: Float32Array, random: Random) => {
  for (let vertex = 0; vertex < baked.length / 3; vertex += 1) {
    const at = vertex * 3;
    const color: Vec3 = [baked[at]!, baked[at + 1]!, baked[at + 2]!];
    const position: Vec3 = [mesh.positions[at]!, mesh.positions[at + 1]!, mesh.positions[at + 2]!];
    const normal: Vec3 = [mesh.normals[at]!, mesh.normals[at + 1]!, mesh.normals[at + 2]!];
    mesh.colors.set(shaded(color, random, RIVER_ROOT_SHADE).color(position, normal), at);
  }
};

const getRadius = (positions: Float32Array) => {
  let radius = 0.01;
  for (let index = 0; index < positions.length; index += 3) {
    radius = Math.max(radius, Math.hypot(positions[index]!, positions[index + 2]!));
  }
  return radius;
};

/** Cattail clump: the shipped model scaled to the variant's height (one cell = one unit). */
export const createCattail = (random: Random, variant: number): PropMesh => {
  const model = loadSource();
  const height = VARIANT_HEIGHTS[variant % VARIANT_HEIGHTS.length]!;
  const positions = model.positions.map((value) => (value * height) / model.height);
  const mesh: PropMesh = {
    colors: new Float32Array(model.colors.length),
    contactRadius: CONTACT_RADIUS,
    height,
    indices: model.indices.slice(),
    normals: model.normals.slice(),
    positions,
    radius: getRadius(positions),
    uvs: new Float32Array(model.flutter.length * 2).fill(NO_UV[0]),
    wind: createWind(positions, model.flutter, height)
  };
  if (variant === MIRRORED_VARIANT) mirrorX(mesh);
  shadeColors(mesh, model.colors, random);
  return mesh;
};
