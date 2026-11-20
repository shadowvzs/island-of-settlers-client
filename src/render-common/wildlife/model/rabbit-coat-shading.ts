import { fract, smoothstep } from "../../../shared/world/noise";
import type { Vec3 } from "../../props/mesh-builder";
import { type AnimalModel,JOINT, PART } from "./animal-rig";
import {
  COAT_PALETTES,
  PATCH_BLOB_LIMIT,
  PATCH_BLOBS,
  RABBIT_COAT,
  RABBIT_COAT_COUNT
} from "./rabbit-coat";

/**
 * Rabbit coats on the photo textured model: the texture is the wild (agouti) coat; every other
 * archetype keeps its fur detail (luminance relative to the agouti sides) on its own palette,
 * the light belly becomes the archetype's belly, then the one sided patches and the dark ear
 * rims (vertex colour G mask) go on top. One mesh and one texture serve every rabbit.
 */
const PATCH_WARP = 0.012;
const AGOUTI = COAT_PALETTES[RABBIT_COAT.agouti]!;

const luminance = (color: Vec3) => color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11;
const AGOUTI_LUMINANCE = luminance(AGOUTI.base);

/** Mixed coat patch mask: one sided, warped blob edges, offset per individual. */
export const getPatchMask = (rest: Vec3, pattern: number, seed: number) => {
  if (pattern < 0) return 0;
  const side = seed < 0.5 ? 1 : -1;
  const shift = (fract(seed * 7.13) - 0.5) * 0.02;
  const warp =
    Math.sin(rest[0] * 91 + seed * 13) * Math.sin(rest[1] * 77 + rest[2] * 63) * PATCH_WARP;
  let mask = 0;
  for (const [x, y, z, radius] of PATCH_BLOBS[pattern]!) {
    const distance = Math.hypot(rest[0] - x - shift, rest[1] - y, rest[2] - z * side) + warp;
    mask = Math.max(mask, 1 - smoothstep(radius * 0.7, radius, distance));
  }
  return mask;
};

const vec3List = (values: readonly Vec3[]) =>
  values.map((value) => `vec3(${value.map((v) => v.toFixed(4)).join(", ")})`).join(", ");

const paletteArray = (name: string, key: "base" | "belly" | "ear" | "patch") =>
  `const vec3 ${name}[${RABBIT_COAT_COUNT}] = vec3[](${vec3List(COAT_PALETTES.map((palette) => palette[key]))});`;

const PATCH_TABLE = PATCH_BLOBS.flatMap((blobs) =>
  Array.from({ length: PATCH_BLOB_LIMIT }, (_, index) => blobs[index] ?? [0, -10, 0, 0])
);

/**
 * The same coat in GLSL (per pixel): palettes and patch blobs as constants generated
 * from the tables above; coat = (archetype, pattern, seed, ear darkness).
 */
export const RABBIT_COAT_GLSL = `
${paletteArray("COAT_BASE", "base")}
${paletteArray("COAT_BELLY", "belly")}
${paletteArray("COAT_EAR", "ear")}
${paletteArray("COAT_PATCH", "patch")}
const vec4 PATCH_BLOBS[${PATCH_TABLE.length}] = vec4[](${PATCH_TABLE.map((blob) => `vec4(${blob.map((v) => v.toFixed(4)).join(", ")})`).join(", ")});
const vec3 COAT_LUMINANCE = vec3(0.3, 0.59, 0.11);

float getPatchMask(vec3 rest, int pattern, float seed) {
  if (pattern < 0) return 0.0;
  float side = seed < 0.5 ? 1.0 : -1.0;
  float shift = (fract(seed * 7.13) - 0.5) * 0.02;
  float warp = sin(rest.x * 91.0 + seed * 13.0) * sin(rest.y * 77.0 + rest.z * 63.0) * ${PATCH_WARP.toFixed(4)};
  float mask = 0.0;
  for (int index = 0; index < ${PATCH_BLOB_LIMIT}; index++) {
    vec4 blob = PATCH_BLOBS[pattern * ${PATCH_BLOB_LIMIT} + index];
    float distance = length(rest - vec3(blob.x + shift, blob.y, blob.z * side)) + warp;
    mask = max(mask, 1.0 - smoothstep(blob.w * 0.7, blob.w, distance));
  }
  return mask;
}

vec3 shadeRabbitCoat(vec3 texel, float accent, vec3 rest, vec4 coat, float juvenile) {
  int archetype = int(coat.x + 0.5);
  vec3 base = COAT_BASE[archetype];
  float detail = dot(texel, COAT_LUMINANCE) / ${AGOUTI_LUMINANCE.toFixed(5)};
  float contrast = 1.0 - smoothstep(0.45, 0.9, dot(base, COAT_LUMINANCE)) * 0.6;
  vec3 recoloured = base * pow(max(detail, 0.01), contrast);
  vec3 color = mix(recoloured, COAT_BELLY[archetype], smoothstep(1.35, 1.9, detail));
  color = archetype == ${RABBIT_COAT.agouti} ? texel : color;
  color = mix(color, COAT_PATCH[archetype], getPatchMask(rest, int(floor(coat.y + 0.5)), coat.z));
  color = mix(color, COAT_EAR[archetype], accent * coat.w);
  return mix(color, base, juvenile * 0.2);
}
`;

/** Share of the ear (from its base) where the dark rim and tip begin. */
const EAR_TIP_FROM = 0.55;

/** Ear rim / tip mask per vertex in the vertex colour G channel (R and B stay 1, 0). */
export const addRabbitMasks = (model: AnimalModel): AnimalModel => {
  const { positions } = model.mesh;
  const colors = new Float32Array(positions.length);
  let earTop = 0;
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    earTop = Math.max(earTop, positions[vertex * 3 + 1]!);
  }
  const earBase = model.joints[JOINT.earLeft]![1];
  for (let vertex = 0; vertex < model.parts.length; vertex += 1) {
    const part = model.parts[vertex];
    const ear = part === PART.earLeft || part === PART.earRight;
    const along = (positions[vertex * 3 + 1]! - earBase) / (earTop - earBase);
    colors[vertex * 3] = 1;
    colors[vertex * 3 + 1] = ear ? smoothstep(EAR_TIP_FROM, 1, along) : 0;
  }
  return { ...model, mesh: { ...model.mesh, colors } };
};
