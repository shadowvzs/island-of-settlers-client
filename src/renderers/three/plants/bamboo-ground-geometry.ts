import type { Point3 } from "../../../render-common/buildings/building-recipe";
import type { BambooGroveGraph, BambooShoot } from "../../../render-common/plants/bamboo-grove-graph";
import { bambooMoundRadius } from "../../../render-common/plants/bamboo-grove-species";
import { type BambooTier, culmTint } from "./bamboo-culm-geometry";
import { addBambooApex, addBambooTube, addBambooVertex, type BambooMeshBuffers, type BambooRgb,
  type BambooRing } from "./bamboo-mesh-buffers";
import { BAMBOO_ATLAS } from "./bamboo-textures";

const STILL = [0, 0, 0] as const;
const SOIL: BambooRgb = [.46, .33, .22];

const branchSides = (tier: BambooTier, twig: boolean) => tier === "high" && !twig ? 4 : 3;

/** Branch and twig tubes; their whole length rides on the bend of the supporting node. */
export const addBambooBranches = (buffers: BambooMeshBuffers, graph: BambooGroveGraph, tier: BambooTier) => {
  const u = BAMBOO_ATLAS[graph.species.skin];
  for (const branch of graph.branches) {
    if (tier === "far" && branch.twig) continue;
    const culm = graph.culms[branch.culm]!, colour = culmTint(graph, culm);
    const points = tier === "high" ? branch.points : [branch.points[0]!, branch.points[2]!];
    const rings: BambooRing[] = points.map((centre, index) => {
      const t = index / (points.length - 1);
      return { centre, colour, radius: branch.radius[0] + (branch.radius[1] - branch.radius[0]) * t,
        sway: [culm.phase, branch.bend, 0], v: .12 + t * .7 };
    });
    addBambooTube(buffers, { rings, sides: branchSides(tier, branch.twig), u });
  }
};

const MOUND_PROFILE = [[0, .065], [.62, .045], [1, -.012]] as const;

/** Mound surface height at a fraction of its radius (litter rests on it). */
export const bambooMoundHeight = (fraction: number) => {
  if (fraction <= MOUND_PROFILE[1][0])
    return MOUND_PROFILE[0][1] + (MOUND_PROFILE[1][1] - MOUND_PROFILE[0][1]) * fraction / MOUND_PROFILE[1][0];
  const t = Math.min(1, (fraction - MOUND_PROFILE[1][0]) / (1 - MOUND_PROFILE[1][0]));
  return MOUND_PROFILE[1][1] + (MOUND_PROFILE[2][1] - MOUND_PROFILE[1][1]) * t;
};

/** Low soil mound the culm bases are buried in; planar soil-atlas mapping. */
const addMound = (buffers: BambooMeshBuffers, radius: number, tier: BambooTier) => {
  const sides = tier === "high" ? 14 : 8, profile = MOUND_PROFILE;
  const start = buffers.positions.length / 3;
  const uv = (x: number, z: number): [number, number] =>
    [BAMBOO_ATLAS.soil[0] + (x / radius * .5 + .5) * .2, z / radius * .5 + .5];
  addBambooVertex(buffers, [0, profile[0][1], 0], [0, 1, 0], uv(0, 0), SOIL, STILL);
  for (const [reach, height] of profile.slice(1)) for (let side = 0; side < sides; side++) {
    const angle = side / sides * Math.PI * 2;
    const x = Math.cos(angle) * radius * reach, z = Math.sin(angle) * radius * reach;
    addBambooVertex(buffers, [x, height, z], [Math.cos(angle) * .25, 1, Math.sin(angle) * .25], uv(x, z), SOIL, STILL);
  }
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides, inner = start + 1, outer = inner + sides;
    buffers.indices.push(start, inner + next, inner + side);
    buffers.indices.push(inner + side, inner + next, outer + side, inner + next, outer + next, outer + side);
  }
};

/** Short buttress roots spreading from each culm base into the soil (High only). */
const addRoots = (buffers: BambooMeshBuffers, graph: BambooGroveGraph) => {
  graph.culms.forEach(culm => {
    const base = culm.nodes[0]!, radius = culm.radii[0]!;
    for (let root = 0; root < 4; root++) {
      const angle = culm.phase + root * Math.PI / 2;
      const end: Point3 = [base[0] + Math.cos(angle) * radius * 2.6, -.02, base[2] + Math.sin(angle) * radius * 2.6];
      const start: Point3 = [base[0] + Math.cos(angle) * radius * .6, .06, base[2] + Math.sin(angle) * radius * .6];
      addBambooTube(buffers, { rings: [
        { centre: start, colour: [.62, .52, .34], radius: radius * .26, sway: STILL, v: 0 },
        { centre: end, colour: [.5, .4, .28], radius: radius * .12, sway: STILL, v: 1 }],
      sides: 3, u: BAMBOO_ATLAS.sheath });
    }
  });
};

/** A young shoot: overlapping sheath cones, mottled, greening towards the tip. */
const addShoot = (buffers: BambooMeshBuffers, graph: BambooGroveGraph, shoot: BambooShoot, tier: BambooTier) => {
  const sides = { high: 7, minimal: 5, far: 4 }[tier], layers = tier === "far" ? 1 : 3;
  for (let layer = 0; layer < layers; layer++) {
    const lift = shoot.height * layer * .26, scale = 1 - layer * .24;
    const base: Point3 = [shoot.base[0], shoot.base[1] + lift, shoot.base[2]];
    const sheath = graph.species.sheathColour, shade = .82 + layer * .08;
    const colour: BambooRgb = [sheath[0] * shade - .08 * layer, sheath[1] * shade + .04 * layer,
      sheath[2] * shade - .04 * layer];
    const ring: BambooRing = { centre: base, colour, radius: shoot.radius * scale, sway: STILL, v: 0 };
    const start = buffers.positions.length / 3;
    addBambooTube(buffers, { rings: [ring, { ...ring, centre: [base[0], base[1] + .02, base[2]], v: .1 }],
      sides, u: BAMBOO_ATLAS.sheath });
    addBambooApex(buffers, start + sides + 1, sides, [base[0], base[1] + shoot.height * scale, base[2]],
      [0, 1, 0], [(BAMBOO_ATLAS.sheath[0] + BAMBOO_ATLAS.sheath[1]) / 2, 1], [.56, .62, .3], STILL);
  }
};

export const addBambooGround = (buffers: BambooMeshBuffers, graph: BambooGroveGraph, tier: BambooTier) => {
  addMound(buffers, bambooMoundRadius(graph.species), tier);
  if (tier === "high") addRoots(buffers, graph);
  for (const shoot of graph.shoots) addShoot(buffers, graph, shoot, tier);
};
