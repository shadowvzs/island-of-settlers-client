import { DMath } from "../../shared/math/deterministic-math";
import { cross, normalize, type Vec3 } from "../props/mesh-builder";
import type { RoadDecorationPart } from "../road-decoration-recipe";
import { wisteriaHeroCrown } from "../wisteria-hero-graph";
import { addClearCard, addClearHead, addStem, botanyNoise, type ClimberOpening, type Colour, linearHex, offset,
  paletteTint, type Point, samplePolyline } from "./climber-botany";

/** Authored sRGB palettes (card D05a), converted once to linear vertex tints. */
const LEAF_DARK = linearHex(0x4a7a30), LEAF_LIGHT = linearHex(0x6a9a3c), LEAF_YOUNG = linearHex(0x7a7430);
const CALYX = linearHex(0x557f2e);
/** Linear cane tints on the frame's wood map: green young wood, browner old canes, red prickles. */
const CANE: Colour = [.46, .52, .18], CANE_OLD: Colour = [.58, .44, .26], PRICKLE: Colour = [.46, .16, .09];
export const ROSE_PETAL_PALETTES = Object.freeze({
  red: [linearHex(0xb0122a), linearHex(0xd6283c)] as const,
  white: [linearHex(0xf4efe2), linearHex(0xfbf6ea)] as const
});

interface Cane { points: Point[]; side: number; top: boolean; z: number }
interface Site { at: Point; outward: Point; tangent: Vec3; height: number; seed: number }

const crown = (x: number) => wisteriaHeroCrown("curved", x);

/** A trained cane: weaves up the post along the rail ends, then (top canes) arches over the frame. */
const trainCane = (side: number, z: number, top: boolean, detailed: boolean, seed: number): Cane => {
  const climb = detailed ? 14 : 7, phase = seed * 1.7;
  const climbTop = top ? crown(side) - .08 : 2.55 + botanyNoise(seed) * .12;
  const points: Point[] = [[side * 1.17, .03, z * .55]];
  for (let step = 1; step <= climb; step++) {
    const t = step / climb, turn = t * Math.PI * 3 + phase;
    points.push([side * (1.03 + DMath.sin(turn) * .035), .05 + (climbTop - .05) * t,
      z + DMath.cos(turn) * .06 * Math.min(1, t * 3)]);
  }
  if (!top) return { points, side, top, z };
  points.push([side * 1.01, crown(side) + .1, z * 1.1]);
  const span = detailed ? 10 : 5, end = -side * (.12 + botanyNoise(seed + 3) * .1);
  for (let step = 1; step <= span; step++) {
    const x = side * .98 + (end - side * .98) * step / span;
    points.push([x, crown(x) + .15 + DMath.sin(step * 1.9 + phase) * .012, z * 1.1 + DMath.sin(step * 1.3 + phase) * .02]);
  }
  return { points, side, top, z };
};

const createCanes = (detailed: boolean) => [-1, 1].flatMap(side => [
  trainCane(side, .17, true, detailed, side * 10 + 1), trainCane(side, -.17, true, detailed, side * 10 + 2),
  trainCane(side, .25, false, detailed, side * 10 + 3), trainCane(side, -.25, false, detailed, side * 10 + 4)
]);

/** Light comes from outside the arch: sides face away from the road, the crown faces the sky. */
const outwardAt = (cane: Cane, point: Point): Point => {
  const sky = Math.min(1, Math.max(0, (point[1] - 2.5) / .5));
  return normalize([cane.side * (1 - sky) * .8, .35 + sky * .65, Math.sign(cane.z) * .55]) as Point;
};

/** Flowering laterals and leaf nodes; bare below knee height so the joinery and footing stay readable. */
const createSites = (canes: readonly Cane[], perCane: (cane: Cane) => number) => canes.flatMap((cane, index) => {
  const count = perCane(cane);
  return Array.from({ length: count }, (_, site): Site => {
    const seed = index * 53 + site * 7;
    const t = .22 + (site + .5) / count * .76 + (botanyNoise(seed) - .5) * .03;
    const { point, tangent } = samplePolyline(cane.points, t);
    return { at: point, height: point[1], outward: outwardAt(cane, point), seed, tangent };
  });
});

const swing = (direction: Vec3, axis: Vec3, amount: number): Point =>
  normalize(offset(direction, normalize(cross(axis, direction)), amount)) as Point;

/** Upright painted sprays: they grow up and slightly out, their face turned to the open side. */
const uprightGrowth = (outward: Point) => normalize([outward[0] * .35, 1, outward[2] * .35]) as Point;
const uprightFacing = (outward: Point) => normalize([outward[0], .3, outward[2]]) as Point;

interface RoseContext { opening: ClimberOpening; parts: RoadDecorationPart[]; petals: readonly [Colour, Colour] }

const leafTint = (seed: number, young: boolean): Colour =>
  young && botanyNoise(seed + 41) < .35 ? LEAF_YOUNG : paletteTint(LEAF_DARK, LEAF_LIGHT, seed);

/** Leaves fan round the stem, so the arch reads as foliage from the road ends as well as from the side. */
const fanFacing = (outward: Point, seed: number): Point =>
  normalize([outward[0], outward[1] + .35, outward[2] + (botanyNoise(seed + 29) - .5) * 2.4]) as Point;

/** Odd-pinnate leaf card on its painted petiole: it leaves the node at ~50 degrees, alternating sides. */
const compoundLeaf = (context: RoseContext, at: Point, along: Vec3, outward: Point, seed: number, young = false) => {
  const sideways = normalize(cross(along, outward)), turn = botanyNoise(seed) > .5 ? 1 : -1;
  const up = normalize([0, 1, 2].map(axis => along[axis]! * .55 + outward[axis]! * .5 +
    sideways[axis]! * turn * (.7 + botanyNoise(seed + 1) * .4)) as Point) as Point;
  addClearCard(context.parts, { curl: .04, facing: fanFacing(outward, seed),
    position: at, size: .29 + botanyNoise(seed + 2) * .06, tile: botanyNoise(seed + 3) < .5 ? "rose-compound-leaf-5"
      : "rose-compound-leaf-7", tint: leafTint(seed, young), up }, context.opening);
};

const bud = (context: RoseContext, at: Point, up: Point, seed: number) => {
  const tint = paletteTint(context.petals[0], context.petals[1], seed);
  for (const turn of [0, Math.PI / 2]) {
    const facing = normalize(cross(up, [DMath.cos(turn + seed), 0, DMath.sin(turn + seed)])) as Point;
    addClearCard(context.parts, { facing, position: at, size: .1, tile: "rose-bud", tint, up }, context.opening);
  }
};

/** Open bloom on its pedicel with the bearded calyx behind the receptacle. */
const bloom = (context: RoseContext, at: Point, axis: Point, seed: number) => {
  const radius = .072 + botanyNoise(seed + 5) * .016;
  const tint = paletteTint(context.petals[0], context.petals[1], seed);
  if (!addClearHead(context.parts, { axis, position: at, radius, seed, tint }, context.opening)) return;
  addClearCard(context.parts, { facing: [-axis[0], -axis[1], -axis[2]], position: offset(at, axis, -.006),
    size: radius * 1.7, tile: "rose-calyx", tint: CALYX, up: swing(axis, [0, 1, 0], 1.4) }, context.opening);
};

/** One flowering lateral: shoot, two leaves, then a bloom with a companion bud, a bud or a leaf. */
const lateral = (context: RoseContext, site: Site, flowering: boolean) => {
  const length = .12 + botanyNoise(site.seed + 9) * .1;
  const end = offset(offset(site.at, site.outward, length), [0, 1, 0], .04);
  const middle = offset(offset(site.at, site.outward, length * .5), [0, 1, 0], .012);
  addStem(context.parts, [site.at, middle, end], [.0085, .0045], 4, CANE);
  for (const [index, fraction] of [.42, .78].entries()) {
    const { point, tangent } = samplePolyline([site.at, middle, end], fraction);
    compoundLeaf(context, point, tangent, site.outward, site.seed + index * 3, index === 1 && !flowering);
  }
  const axis = normalize(offset(site.outward, [0, 1, 0], .5)) as Point;
  if (!flowering) { bud(context, end, axis, site.seed); return; }
  bloom(context, end, axis, site.seed);
  const pedicel = offset(offset(middle, site.outward, length * .2), swing(axis, site.tangent, 1), .05);
  addStem(context.parts, [middle, pedicel], [.004, .003], 3, CANE);
  bud(context, pedicel, swing(axis, site.tangent, .7), site.seed + 1);
};

/** Hooked prickles point back down the cane (High only). */
const prickles = (context: RoseContext, cane: Cane, count: number) => {
  for (let index = 0; index < count; index++) {
    const { point, tangent } = samplePolyline(cane.points, .12 + index / count * .85);
    const out = swing(outwardAt(cane, point), tangent, index % 2 ? 1.6 : -1.6);
    addStem(context.parts, [point, offset(offset(point, out, .024), tangent, -.01)], [.0055, .0004], 3, PRICKLE);
  }
};

const highRose = (context: RoseContext, canes: readonly Cane[]) => {
  for (const [index, cane] of canes.entries())
    addStem(context.parts, cane.points, cane.top ? [.026, .011] : [.022, .01], cane.top ? 5 : 6,
      index % 2 ? CANE_OLD : CANE);
  const sites = createSites(canes, cane => cane.top ? 7 : 5);
  let flowers = 0;
  for (const site of sites) {
    const flowering = site.height > 1.45 && botanyNoise(site.seed + 13) < .82 && flowers < 30;
    if (flowering) flowers++;
    lateral(context, site, flowering);
  }
  for (const site of createSites(canes, () => 16))
    compoundLeaf(context, site.at, site.tangent, site.outward, site.seed + 101);
  for (const cane of canes) prickles(context, cane, cane.top ? 8 : 5);
};

/** Minimal: the same canes and sites carry painted sprays, bloom clusters and paired open heads. */
const minimalRose = (context: RoseContext, canes: readonly Cane[]) => {
  for (const cane of canes) addStem(context.parts, cane.points, cane.top ? [.026, .012] : [.022, .011], 4, CANE);
  for (const site of createSites(canes, cane => cane.top ? 14 : 10)) {
    const up = swing(uprightGrowth(site.outward), site.outward, botanyNoise(site.seed) > .5 ? .6 : -.6);
    addClearCard(context.parts, { curl: .06, facing: fanFacing(uprightFacing(site.outward), site.seed),
      position: site.at, size: .5 + botanyNoise(site.seed + 1) * .08, tile: "rose-leaf-spray",
      tint: leafTint(site.seed, false), up }, context.opening);
  }
  let heads = 0;
  for (const site of createSites(canes, cane => cane.top ? 6 : 3)) {
    if (site.height < 1.45) continue;
    const tint = paletteTint(context.petals[0], context.petals[1], site.seed);
    const cluster = botanyNoise(site.seed + 4) < .5 || heads >= 16;
    if (cluster) {
      addClearCard(context.parts, { facing: uprightFacing(site.outward), position: site.at, size: .5,
        tile: "rose-bloom-cluster", tint, up: uprightGrowth(site.outward) }, context.opening);
      continue;
    }
    heads++;
    const centre = offset(offset(site.at, site.outward, .05), [0, 1, 0], .03);
    addStem(context.parts, [site.at, centre], [.005, .004], 3, CANE);
    for (const turn of [-.6, .6]) addClearCard(context.parts, { facing: swing(site.outward, site.tangent, turn),
      position: centre, size: .19, tile: "rose-open-head", tint, up: site.tangent as Point }, context.opening);
  }
};

/** Climbing rose on the curved arch: one geometry for red and white, only the petal tint differs. */
export const addClimbingRose = (parts: RoadDecorationPart[], detailed: boolean, petals: readonly [Colour, Colour],
  opening: ClimberOpening) => {
  const canes = createCanes(detailed), context: RoseContext = { opening, parts, petals };
  if (detailed) highRose(context, canes);
  else minimalRose(context, canes);
};
