import { DMath } from "../../shared/math/deterministic-math";
import { normalize, type Vec3 } from "../props/mesh-builder";
import type { RoadDecorationPart } from "../road-decoration-recipe";
import { wisteriaHeroCrown } from "../wisteria-hero-graph";
import { addClearCard, addStem, botanyNoise, type ClimberOpening, linearHex, offset, paletteTint, type Point,
  samplePolyline } from "./climber-botany";

/** Authored sRGB palettes (card D05b), converted once to linear vertex tints. */
const LEAF_DARK = linearHex(0x36682a), LEAF_LIGHT = linearHex(0x56883a), LEAF_YOUNG = linearHex(0x7a9a40);
const ADULT = linearHex(0x4e7a32);
/** Linear grey-brown stem tint on the frame's wood map (#5A4A35 family). */
const STEM: [number, number, number] = [.5, .4, .28];

/** A stem and the face its blades turn out of: clinging wall stems, runs over the top, trailing shoots. */
interface IvyStem { face: Point; kind: "wall" | "top" | "trailing"; points: Point[]; radius: readonly [number, number] }

const TOP = wisteriaHeroCrown("lattice", 0) + .13;

const wiggle = (seed: number, step: number, amount: number) => DMath.sin(step * 1.7 + seed * 2.3) * amount;

/** Climbs a wall face from the root crown, clinging at `x`, drifting across the lattice in z. */
const wallStem = (side: number, x: number, z: number, from: number, to: number, segments: number, seed: number):
Point[] => Array.from({ length: segments + 1 }, (_, step) => {
  const t = step / segments;
  return [side * x, from + (to - from) * t, z + wiggle(seed, step, .05) + DMath.sin(t * 5 + seed) * .03];
});

/** Continues the post stem over the top beam towards (and slightly past) the middle. */
const topStem = (start: Point, side: number, z: number, segments: number, seed: number): Point[] => {
  const points: Point[] = [start, [side * 1.05, TOP - .06, z * .6], [side * 1.03, TOP, z * .9]];
  for (let step = 1; step <= segments; step++) {
    const x = side * (1.02 - step / segments * (1.1 + botanyNoise(seed) * .12));
    points.push([x, TOP + .01 + wiggle(seed, step, .008), z + wiggle(seed + 5, step, .03)]);
  }
  return points;
};

/** A shoot that outgrew the beam and falls over the slat ends, well above the traffic opening. */
const trailingStem = (top: readonly Point[], at: number): Point[] => {
  const { point } = samplePolyline(top, at), out = Math.sign(point[2]) || 1, drift = (at - .5) * .08;
  return [point, [point[0], TOP + .005, out * .34], [point[0] + drift * .3, TOP - .1, out * .38],
    [point[0] + drift, TOP - .27, out * .4], [point[0] + drift * 1.4, TOP - .44, out * .39]];
};

/** Root crown at the post foot, outer and inner wall stems, runs over the beams and trailing shoots. */
const createStems = (detailed: boolean): IvyStem[] => [-1, 1].flatMap(side => {
  const climb = detailed ? 16 : 8, outer: Point = [side, .25, 0], inner: Point = [-side, .25, 0];
  const root: Point = [side * 1.12, .026, .05];
  const wall = (points: Point[], face: Point, radius: readonly [number, number]): IvyStem =>
    ({ face, kind: "wall", points: [root, ...points], radius });
  const post = wall(wallStem(side, 1.075, 0, .08, TOP - .22, climb, side * 3), outer, [.018, .009]);
  const tops = [.2, -.2].map((z, index): IvyStem => ({ face: [0, 1, 0], kind: "top", radius: [.011, .006],
    points: topStem(post.points.at(-1)!, side, z, detailed ? 12 : 6, side + 6 + index * 3) }));
  const trailing = tops.flatMap(top => [.3, .7].map((at): IvyStem => ({ face: [0, .3, Math.sign(top.points.at(-1)![2])],
    kind: "trailing", points: trailingStem(top.points, at), radius: [.007, .004] })));
  return [
    post,
    wall(wallStem(side, 1.032, .17, .1, 2.62, climb, side * 5 + 1), outer, [.013, .007]),
    wall(wallStem(side, 1.032, -.17, .1, 2.58, climb, side * 7 + 2), outer, [.013, .007]),
    wall(wallStem(side, .968, .15, .3, 2.45, climb - 2, side * 11 + 3), inner, [.011, .006]),
    wall(wallStem(side, .968, -.15, .3, 2.4, climb - 2, side * 13 + 4), inner, [.011, .006]),
    ...tops, ...trailing
  ];
});

/** Leaf blades lie flat towards the light: out of the wall and tilted up to ~35 degrees to the sky. */
const bladeFacing = (face: Point, seed: number): Point => {
  if (face[1] > .5) return normalize([(botanyNoise(seed) - .5) * .5, 1, (botanyNoise(seed + 1) - .5) * .6]) as Point;
  // Blades spill round the narrow lattice edges too, so the wall reads green from the road ends.
  const fan = (botanyNoise(seed + 1) - .5) * 2.4, tilt = .25 + botanyNoise(seed) * .45;
  return normalize([face[0] - face[2] * fan, tilt, face[2] + face[0] * fan]) as Point;
};

/** Petioles of different lengths fan the blades into the typical ivy mosaic along the stem. */
const bladeGrowth = (tangent: Vec3, face: Point, seed: number): Point => {
  const across: Vec3 = face[1] > .5 ? [0, 0, 1] : [0, 1, 0];
  const turn = botanyNoise(seed) > .5 ? 1 : -1, lean = .55 + botanyNoise(seed + 2) * .5;
  return normalize([0, 1, 2].map(axis => tangent[axis]! * .6 + across[axis]! * turn * lean * .5 +
    face[axis]! * .25) as Point) as Point;
};

const highClusters = (stem: IvyStem, inner: boolean) => {
  if (stem.kind === "trailing") return 2;
  return inner ? 4 : 6;
};

interface IvyContext { opening: ClimberOpening; parts: RoadDecorationPart[] }

const leafSites = (stem: IvyStem, count: number, seed: number) => Array.from({ length: count }, (_, index) => {
  const t = .06 + (index + botanyNoise(seed + index)) / count * .94;
  return { ...samplePolyline(stem.points, t), seed: seed + index * 17 };
});

const addLeaf = (context: IvyContext, stem: IvyStem, at: Point, tangent: Vec3, seed: number, cluster: boolean) => {
  const adult = stem.kind !== "wall" && botanyNoise(seed + 7) < .2;
  let tile: "ivy-adult-cordate" | "ivy-cluster-4" | "ivy-cluster-7" | "ivy-juvenile-3-lobed" | "ivy-juvenile-5-lobed" =
    botanyNoise(seed + 3) < .55 ? "ivy-juvenile-3-lobed" : "ivy-juvenile-5-lobed";
  if (adult) tile = "ivy-adult-cordate";
  if (cluster) tile = botanyNoise(seed + 3) < .5 ? "ivy-cluster-4" : "ivy-cluster-7";
  const size = cluster ? .28 + botanyNoise(seed + 4) * .08 : .17 + botanyNoise(seed + 4) * .06;
  const young = botanyNoise(seed + 8) < .08;
  const tint = young ? LEAF_YOUNG : paletteTint(adult ? ADULT : LEAF_DARK, LEAF_LIGHT, seed);
  // A short lift off the wall stands in for the petiole's arc; the pivot stays on the stem.
  const position = offset(at, stem.face, .004);
  addClearCard(context.parts, { curl: cluster ? .02 : .008, facing: bladeFacing(stem.face, seed), position,
    size, tile, tint, up: bladeGrowth(tangent, stem.face, seed) }, context.opening);
};

/** Aerial rootlets (no tendrils: Hedera clings with them) bristle from the stem into its support. */
const rootlets = (context: IvyContext, stem: IvyStem) => {
  if (stem.kind !== "wall") return;
  for (let index = 1; index < stem.points.length - 1; index++) {
    const turn = index % 2 ? 1 : -1, at = stem.points[index]!, tangent = normalize(at.map((value, axis) => stem.points[index + 1]![axis]! -
      value) as Point);
    const into = offset(offset(at, stem.face, -.018), tangent, turn * .008);
    addStem(context.parts, [offset(at, tangent, turn * .01), into], [.0018, .0011], 3, STEM);
  }
};

/** High: 288 single juvenile/adult leaves and 76 clusters on 14 clinging stems with rootlets. */
const highIvy = (context: IvyContext, stems: readonly IvyStem[]) => {
  for (const stem of stems) {
    addStem(context.parts, stem.points, stem.radius, 5, STEM);
    rootlets(context, stem);
  }
  for (const [index, stem] of stems.entries()) {
    const inner = stem.face[0] * Math.sign(stem.points[1]![0]) < 0;
    let singles = 26;
    if (inner) singles = 13;
    else if (stem.kind === "top") singles = 20;
    else if (stem.kind === "trailing") singles = 7;
    for (const site of leafSites(stem, singles, index * 131)) addLeaf(context, stem, site.point, site.tangent, site.seed, false);
    for (const site of leafSites(stem, highClusters(stem, inner), index * 131 + 61))
      addLeaf(context, stem, site.point, site.tangent, site.seed, true);
  }
};

/** Minimal: the same stems carry up to 168 seven-leaf clusters, so far and near views keep their cover. */
const minimalIvy = (context: IvyContext, stems: readonly IvyStem[]) => {
  for (const stem of stems) addStem(context.parts, stem.points, stem.radius, 3, STEM);
  for (const [index, stem] of stems.entries()) {
    const inner = stem.face[0] * Math.sign(stem.points[1]![0]) < 0;
    const clusters = stem.kind === "trailing" ? 2 : 12;
    for (const site of leafSites(stem, inner ? 8 : clusters, index * 131 + 7)) {
      const at = site.point, seed = site.seed;
      addClearCard(context.parts, { curl: .03, facing: bladeFacing(stem.face, seed), position: offset(at, stem.face, .004),
        size: .42 + botanyNoise(seed + 4) * .08, tile: "ivy-cluster-7",
        tint: paletteTint(LEAF_DARK, LEAF_LIGHT, seed), up: bladeGrowth(site.tangent, stem.face, seed) }, context.opening);
    }
  }
};

/** Common ivy on the lattice: lobed juvenile leaves on the walls, unlobed adult leaves on top. */
export const addIvy = (parts: RoadDecorationPart[], detailed: boolean, opening: ClimberOpening) => {
  const stems = createStems(detailed), context: IvyContext = { opening, parts };
  if (detailed) highIvy(context, stems);
  else minimalIvy(context, stems);
};
