import { createRandom, type Random } from "../../shared/world/rng";
import { PROP_CUT_HEIGHT } from "../felling/felling-trees";
import { getMatureMeshId } from "../growth/stage-meshes";
import { toBarkUv } from "../trees/bark-uv";
import { getIslandStumpLook, getTreeVariants, type StumpLook,TREE_KINDS } from "./island-trees";
import { MeshBuilder, NO_UV, normalize, type Vec3, type VertexStyle } from "./mesh-builder";
import { getMeshId } from "./prop-meshes";

const SIDES = 16;
/** Below the ground, so the stump never floats on a slope. */
const FOOT_DEPTH = 0.03;

/** Cut face rings from the bark rim inwards: bark, light sapwood, warmer heartwood, dark pith. */
const CUT_RINGS: [number, Vec3][] = [
  [1, [0.42, 0.3, 0.21]],
  [0.9, [0.86, 0.69, 0.45]],
  [0.68, [0.74, 0.54, 0.31]],
  [0.4, [0.82, 0.63, 0.38]],
  [0.12, [0.52, 0.36, 0.2]]
];

type CutHeight = (side: number, ring: number) => number;

/**
 * Height of the cut at a rim side and ring (1 rim .. 0 pith): a slanted saw cut, a jagged rim
 * and the raised hinge splinter where the tree broke off as it fell. The splinter tip reaches the
 * axe height (PROP_CUT_HEIGHT), where the felled trunk starts.
 */
const createCutHeight = (look: StumpLook, random: Random): CutHeight => {
  const yaw = random() * Math.PI * 2;
  const slant = (0.18 + random() * 0.14) * look.radius;
  const jagged = Array.from({ length: SIDES }, () => (random() - 0.5) * 0.25 * look.radius);
  const hinge = Math.floor(random() * SIDES);
  const base = PROP_CUT_HEIGHT - slant - look.radius * 0.625;
  return (side, ring) => {
    const wrapped = side % SIDES;
    const plane = Math.cos((wrapped / SIDES) * Math.PI * 2 - yaw) * slant * ring;
    const rim = ring === 1 ? jagged[wrapped]! + (wrapped === hinge ? look.radius * 0.5 : 0) : 0;
    return base + plane + rim;
  };
};

/** The stump foot: root buttress lobes (0 between the roots .. 1 on a ridge), bark wobble. */
interface Foot {
  lobeAt: (angle: number) => number;
  phase: number;
}

/** Sharpness of a buttress lobe (higher: narrower ridges with rounded valleys between). */
const LOBE_POWER = 5;

const createFoot = (look: StumpLook, random: Random): Foot => {
  const roots = Array.from({ length: look.roots }, (_, root) => ({
    angle: ((root + (random() - 0.5) * 0.45) / look.roots) * Math.PI * 2,
    strength: 0.7 + random() * 0.3
  }));
  const lobeAt = (angle: number) =>
    roots.reduce((lobe, root) => {
      const ridge = Math.pow(Math.max(0, Math.cos(angle - root.angle)), LOBE_POWER);
      return Math.max(lobe, ridge * root.strength);
    }, 0);
  return { lobeAt, phase: random() * Math.PI * 2 };
};

/**
 * Body rings from below the ground to the cut: a skirt that spreads and sinks into the soil,
 * then the buttressed foot narrowing smoothly into the round trunk. `rise` 0 at the ground ..
 * 1 at the cut; `spread` widens the lobes, `flare` the whole section.
 */
const BODY_PROFILE: { flare: number; rise: number; spread: number }[] = [
  { flare: 0.12, rise: -0.5, spread: 1.05 },
  { flare: 0.08, rise: 0, spread: 0.72 },
  { flare: 0.03, rise: 0.16, spread: 0.36 },
  { flare: 0.01, rise: 0.4, spread: 0.12 },
  { flare: 0, rise: 0.7, spread: 0.02 },
  { flare: 0, rise: 1, spread: 0 }
];

/** Slightly lobed round cross-section plus the root buttresses at this profile ring. */
const getBodyRadius = (look: StumpLook, angle: number, ring: number, foot: Foot) => {
  const { flare, spread } = BODY_PROFILE[ring]!;
  const wobble = 1 + 0.06 * Math.sin(angle * 3 + foot.phase);
  return look.radius * (wobble + flare + spread * foot.lobeAt(angle));
};

/** Height of a profile ring at a side: below the ground for the skirt, up to the uneven cut. */
const getRingHeight = (look: StumpLook, cut: CutHeight, side: number, ring: number) => {
  const { rise } = BODY_PROFILE[ring]!;
  if (rise <= 0) return rise * look.radius * 0.6 - FOOT_DEPTH;
  return -FOOT_DEPTH * (1 - rise) + rise * cut(side, 1);
};

/** Outward normal tilted up where the section narrows upwards (the buttress slopes). */
const getBodyNormal = (angle: number, slope: number): Vec3 =>
  normalize([Math.cos(angle), Math.max(0, slope), Math.sin(angle)]);

const barkStyle = (look: StumpLook, shade: number, random: Random): VertexStyle => ({
  color: () => {
    const factor = shade * (0.92 + random() * 0.16);
    return [look.bark[0] * factor, look.bark[1] * factor, look.bark[2] * factor];
  },
  flutter: 0
});

const getBarkUv = (look: StumpLook, around: number, along: number) =>
  look.barkFamily === null ? NO_UV : toBarkUv(around, along, look.barkFamily);

/**
 * The bark sides from below the ground up to the uneven cut (darker at the damp foot), with
 * rounded root buttresses that blend into the trunk and sink into the soil.
 */
const addBody = (builder: MeshBuilder, look: StumpLook, cut: CutHeight, random: Random) => {
  const first = builder.vertexCount;
  const foot = createFoot(look, random);
  const circumference = Math.PI * 2 * look.radius;
  const rings = BODY_PROFILE.length;
  for (let ring = 0; ring < rings; ring += 1) {
    const shade = 0.66 + 0.34 * Math.max(0, BODY_PROFILE[ring]!.rise);
    for (let side = 0; side <= SIDES; side += 1) {
      const angle = (side / SIDES) * Math.PI * 2;
      const radius = getBodyRadius(look, angle, ring, foot);
      const y = getRingHeight(look, cut, side, ring);
      const upper = Math.min(rings - 1, ring + 1);
      const lower = Math.max(0, ring - 1);
      const run = getRingHeight(look, cut, side, upper) - getRingHeight(look, cut, side, lower);
      const narrowing =
        getBodyRadius(look, angle, lower, foot) - getBodyRadius(look, angle, upper, foot);
      const normal = getBodyNormal(angle, narrowing / Math.max(run, 1e-3));
      const position: Vec3 = [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
      const uv = getBarkUv(look, side / SIDES, (y + FOOT_DEPTH) / circumference);
      builder.addVertex(position, normal, barkStyle(look, shade, random), uv);
    }
  }
  const row = SIDES + 1;
  for (let ring = 0; ring < rings - 1; ring += 1) {
    for (let side = 0; side < SIDES; side += 1) {
      const a = first + ring * row + side;
      builder.addTriangle(a, a + row, a + 1);
      builder.addTriangle(a + 1, a + row, a + row + 1);
    }
  }
};

/** Ringed cut face following the uneven cut (normals up). */
const addCutFace = (builder: MeshBuilder, look: StumpLook, cut: CutHeight) => {
  const first = builder.vertexCount;
  for (const [ring, color] of CUT_RINGS) {
    for (let side = 0; side < SIDES; side += 1) {
      const angle = (side / SIDES) * Math.PI * 2;
      const radius = look.radius * ring;
      const position: Vec3 = [Math.cos(angle) * radius, cut(side, ring), Math.sin(angle) * radius];
      builder.addVertex(position, [0, 1, 0], { color: () => color, flutter: 0 });
    }
  }
  const pith = builder.addVertex([0, cut(0, 0) + 0.002, 0], [0, 1, 0], {
    color: () => CUT_RINGS[CUT_RINGS.length - 1]![1],
    flutter: 0
  });
  for (let ring = 0; ring < CUT_RINGS.length; ring += 1) {
    for (let side = 0; side < SIDES; side += 1) {
      const outer = first + ring * SIDES + side;
      const next = first + ring * SIDES + ((side + 1) % SIDES);
      if (ring === CUT_RINGS.length - 1) {
        builder.addTriangle(outer, pith, next);
        continue;
      }
      builder.addTriangle(outer, outer + SIDES, next);
      builder.addTriangle(next, outer + SIDES, next + SIDES);
    }
  }
};

/**
 * What a felled tree leaves: the foot with the species' bark (relief in Three), rounded root
 * buttresses sinking into the ground, and an uneven ringed cut with the hinge splinter.
 */
const createStump = (look: StumpLook, seed: number) => {
  const random = createRandom(seed);
  const builder = new MeshBuilder();
  const cut = createCutHeight(look, random);
  addBody(builder, look, cut, random);
  addCutFace(builder, look, cut);
  return builder.finish();
};

/** The same rooted, fractured oak stump used in the world, reused by authored woodcutting yards. */
export const createWorkshopStumpMesh = (seed = 137) => createStump(getIslandStumpLook(0, 0), seed);

/**
 * Stump mesh per growth line (the mature mesh id, shared by its younger variants, which scale it
 * with getStumpScale): bark tone and cut radius of the kind and archetype.
 */
export const createStumpMeshes = (seed: number) => {
  const stumps = new Map<number, ReturnType<typeof createStump>>();
  for (const kind of TREE_KINDS) {
    getTreeVariants(kind).forEach(({ form, stage }, variant) => {
      if (stage !== 5) return;
      const line = getMatureMeshId(getMeshId(kind, variant));
      stumps.set(line, createStump(getIslandStumpLook(kind, form), seed + stumps.size * 31));
    });
  }
  return stumps;
};
