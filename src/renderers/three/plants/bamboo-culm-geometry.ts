import type { Point3 } from "../../../render-common/buildings/building-recipe";
import type { BambooCulm, BambooGroveGraph, BambooSheath } from "../../../render-common/plants/bamboo-grove-graph";
import type { BambooForm } from "../../../render-common/plants/bamboo-grove-species";
import { addBambooApex, addBambooTube, addBambooVertex, type BambooMeshBuffers, type BambooRgb,
  type BambooRing, bambooTubeFrame, lerp3, sub3, unit3 } from "./bamboo-mesh-buffers";
import { BAMBOO_ATLAS } from "./bamboo-textures";

export type BambooTier = "high" | "minimal" | "far";

/** Ring sides (lower, upper culm) per form and tier: a lone thick culm is seen close up. */
const CULM_SIDES: Record<BambooForm, Record<BambooTier, readonly [lower: number, upper: number]>> = {
  clump: { high: [8, 6], minimal: [5, 4], far: [4, 3] },
  single: { high: [16, 12], minimal: [8, 6], far: [6, 5] }
};
/** Ring positions along one internode (v) and their radius factor: node ridge, body, collar. */
const INTERNODE_RINGS: Record<BambooTier, readonly (readonly [v: number, radius: number])[]> = {
  high: [[0, 1.1], [.07, 1], [.93, 1], [1, 1.1]],
  minimal: [[0, 1.04], [1, 1.04]],
  far: [[0, 1], [1, 1]]
};

const shadeRgb = (colour: BambooRgb, factor: number): BambooRgb =>
  [Math.min(1, colour[0] * factor), Math.min(1, colour[1] * factor), Math.min(1, colour[2] * factor)];
const mixRgb = (a: BambooRgb, b: BambooRgb, t: number): BambooRgb =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Older culms dull towards olive, younger ones stay bright: natural variation within one palette. */
export const culmTint = (graph: BambooGroveGraph, culm: BambooCulm) => {
  const age = (culm.phase * 7.13) % 1;
  return shadeRgb(mixRgb(graph.species.culmColour, [.62, .62, .36], age * .22), .94 + age * .1);
};

/** Segmented culm: every internode keeps its own node ridge, sheath scar and waxy collar. */
const addCulm = (buffers: BambooMeshBuffers, graph: BambooGroveGraph, culm: BambooCulm, tier: BambooTier) => {
  const u = BAMBOO_ATLAS[graph.species.skin];
  const tint = culmTint(graph, culm), last = culm.nodes.length - 1;
  const step = tier === "far" ? 2 : 1;
  let lastStart = 0, lastSides = 0;
  for (let node = 0; node < last; node += step) {
    const next = Math.min(last, node + step);
    const sides = CULM_SIDES[graph.species.form][tier][culm.heights[node]! < .45 ? 0 : 1];
    const rings: BambooRing[] = INTERNODE_RINGS[tier].map(([v, factor]) => {
      const height = culm.heights[node]! + (culm.heights[next]! - culm.heights[node]!) * v;
      const radius = culm.radii[node]! + (culm.radii[next]! - culm.radii[node]!) * v;
      return { centre: lerp3(culm.nodes[node]!, culm.nodes[next]!, v), colour: shadeRgb(tint, 1 + height * .08),
        radius: radius * factor, sway: [culm.phase, height * height, 0], v: v * (next - node) };
    });
    lastStart = buffers.positions.length / 3 + (rings.length - 1) * (sides + 1); lastSides = sides;
    addBambooTube(buffers, { rings, sides, u });
  }
  const tip = culm.nodes[last]!, axis = unit3(sub3(tip, culm.nodes[last - 1]!));
  addBambooApex(buffers, lastStart, lastSides, [tip[0] + axis[0] * .05, tip[1] + axis[1] * .05,
    tip[2] + axis[2] * .05], axis, [(u[0] + u[1]) / 2, .5], tint, [culm.phase, 1, 0]);
};

const SHEATH_SIDES: Record<BambooTier, number> = { high: 14, minimal: 10, far: 0 };
/** Minimal culm rings stand at 1.04 r; a 10-sided sleeve chord sits at cos(0.095π) of its radius. */
const MINIMAL_SHEATH_SCALE = 1.04;
const SHEATH_BASE_ARC = 1.9, SHEATH_TIP_ARC = .4, SHEATH_ROWS = 5;

/**
 * High sheath rows (position along the sleeve from just above the node ridge, radius factor, arc in π):
 * equal arc steps taper the sleeve into a clean tongue. Narrowing rotates the edge vertices between rows;
 * with shorter-diagonal splits (addBambooTube) each radius covering both chord losses (around the ring and
 * along the slanted edge) plus 1 % keeps the culm from showing through the sleeve.
 */
const SHEATH_PROFILE: readonly (readonly [v: number, radius: number, arc: number])[] = Array.from(
  { length: SHEATH_ROWS }, (_, row) => {
    const t = row / (SHEATH_ROWS - 1), arc = SHEATH_BASE_ARC - (SHEATH_BASE_ARC - SHEATH_TIP_ARC) * t;
    const edgeShift = (SHEATH_BASE_ARC - SHEATH_TIP_ARC) / (SHEATH_ROWS - 1) / 2;
    const around = Math.cos(Math.PI * SHEATH_BASE_ARC / SHEATH_SIDES.high / 2);
    return [.08 + .92 * t, 1.01 / (around * Math.cos(Math.PI * edgeShift / 2)), arc] as const;
  });
/** Minimal: a straight two-row sleeve (no tongue rotation, so no slanted chords). */
const MINIMAL_SHEATH_PROFILE: readonly (readonly [v: number, radius: number, arc: number])[] = [
  [.08, 1.07, SHEATH_BASE_ARC], [1, 1.05, SHEATH_BASE_ARC]];

/** Papery sheath sleeve hugging the node, open along one side, ending in a small triangular blade. */
const addSheath = (buffers: BambooMeshBuffers, graph: BambooGroveGraph, sheath: BambooSheath, tier: BambooTier) => {
  const culm = graph.culms[sheath.culm]!, radius = culm.radii[sheath.node]!;
  const below = culm.nodes[sheath.node]!, above = culm.nodes[sheath.node + 1]!;
  const reach = sheath.length / Math.max(.01, above[1] - below[1]);
  const heightAt = (v: number) => culm.heights[sheath.node]! +
    (culm.heights[sheath.node + 1]! - culm.heights[sheath.node]!) * v * reach;
  const colour = shadeRgb(graph.species.sheathColour, .9 + (sheath.yaw % 1) * .2);
  // Thin papery sleeve hugging the culm, narrowing to a tapered tongue opposite its slit.
  const profile = tier === "high" ? SHEATH_PROFILE : MINIMAL_SHEATH_PROFILE;
  const rings: BambooRing[] = profile.map(([v, scale, arc]) => ({ arc: Math.PI * arc,
    centre: lerp3(below, above, reach * v), colour: shadeRgb(colour, 1 + v * .06),
    radius: radius * scale * (tier === "high" ? 1 : MINIMAL_SHEATH_SCALE),
    sway: [culm.phase, heightAt(v) ** 2, 0], v }));
  addBambooTube(buffers, { arc: Math.PI * SHEATH_BASE_ARC, rings, sides: SHEATH_SIDES[tier],
    start: sheath.yaw, u: BAMBOO_ATLAS.sheath });
  if (tier === "high") addSheathBlade(buffers, rings, sheath.yaw + Math.PI * .95, radius, sheath.length);
};

/** The reduced blade at the sheath tip, both faces, standing just off the culm. */
const addSheathBlade = (buffers: BambooMeshBuffers, rings: readonly BambooRing[], facing: number,
  radius: number, length: number) => {
  const { first, second } = bambooTubeFrame(rings), top = rings.at(-1)!;
  const outward = unit3([0, 1, 2].map(axis => first[axis]! * Math.cos(facing) +
    second[axis]! * Math.sin(facing)) as Point3);
  const side = unit3([-outward[2], 0, outward[0]]), half = radius * .55;
  const at = (out: number, lateral: number, lift: number): Point3 => [0, 1, 2].map(axis =>
    top.centre[axis]! + outward[axis]! * out + side[axis]! * lateral + (axis === 1 ? lift : 0)) as Point3;
  const corners = [at(radius * 1.08, -half, 0), at(radius * 1.08, half, 0), at(radius * 1.3, 0, length * .32)];
  const u = (BAMBOO_ATLAS.sheath[0] + BAMBOO_ATLAS.sheath[1]) / 2;
  const inward: Point3 = [-outward[0], -outward[1], -outward[2]];
  for (const normal of [outward, inward]) {
    const first = addBambooVertex(buffers, corners[0]!, normal, [u - .05, .8], top.colour, top.sway);
    addBambooVertex(buffers, corners[1]!, normal, [u + .05, .8], top.colour, top.sway);
    addBambooVertex(buffers, corners[2]!, normal, [u, 1], shadeRgb(top.colour, .85), top.sway);
    buffers.indices.push(...normal === outward ? [first, first + 2, first + 1] : [first, first + 1, first + 2]);
  }
};

export const addBambooCulms = (buffers: BambooMeshBuffers, graph: BambooGroveGraph, tier: BambooTier) => {
  for (const culm of graph.culms) addCulm(buffers, graph, culm, tier);
  if (tier === "far") return;
  for (const sheath of graph.sheaths) addSheath(buffers, graph, sheath, tier);
};
