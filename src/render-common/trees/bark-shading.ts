import { glslLiteral } from "../shaders/glsl-literal";

/**
 * Named constants of the procedural bark and leaf shading, shared by the WebGL prop shader
 * (three-tree/birch/conifer/palm-shading) and its TSL twin (renderers/webgpu/tsl/prop-bark).
 */
type Rgb = readonly [number, number, number];

/** Oak plate bark: plates around a limb, cracks per circumference, relief depth, faded mean. */
export const OAK_BARK = { cracks: 6, depth: 0.03, meanHeight: 0.7, plates: 8 } as const;
export const BARK_LICHEN: Rgb = [0.4, 0.45, 0.33];

export const BIRCH_BARK = {
  depth: 0.012,
  lenticelRows: 13,
  mark: [0.12, 0.11, 0.1] as Rgb,
  markBrown: [0.21, 0.17, 0.14] as Rgb,
  markRows: 3.1,
  moss: [0.2, 0.25, 0.12] as Rgb
} as const;

export const PALM_BARK = { depth: 0.015, lift: 1.3 } as const;

/** One conifer scale pattern (see CONIFER_BARK_GLSL `ConiferScales`). */
export interface ConiferScaleKind {
  columns: number;
  depth: number;
  furrow: number;
  round: number;
  rows: number;
  warp: number;
}

export const CONIFER_SCALES: Readonly<Record<"mountain" | "spruce", ConiferScaleKind>> = {
  mountain: { columns: 9, depth: 0.03, furrow: 0.2, round: 0.4, rows: 4, warp: 1.5 },
  spruce: { columns: 13, depth: 0.014, furrow: 0.12, round: 1, rows: 9, warp: 0.7 }
};

/** Atlas normal-map relief of the leaf cards. */
export const LEAF_RELIEF = 1;

/** `vec3(...)` GLSL literal of a shared colour (same text as the literal it replaced). */
export const glslVec3 = (rgb: Rgb) => `vec3(${rgb.map(glslLiteral).join(", ")})`;

/** `ConiferScales(...)` GLSL constructor of a shared scale kind, in struct field order. */
export const glslConiferScales = ({ columns, depth, furrow, round, rows, warp }: ConiferScaleKind) =>
  `ConiferScales(${[columns, depth, furrow, round, rows, warp].map(glslLiteral).join(", ")})`;
