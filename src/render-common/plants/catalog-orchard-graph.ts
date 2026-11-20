import { getRoadPlant, type RoadPlantId } from "../../../../island-of-settlers-shared/src/road-plant-catalog";

export type BotanicalPoint = [number, number, number];
export interface BotanicalTube {
  path: BotanicalPoint[];
  radius: number;
  tipRadius: number;
  green?: boolean;
  rings?: boolean;
  /** Structural trunk wood whose clearance belongs to the bole, even above its foot. */
  trunk?: boolean;
  /** Optional sRGB vertex tint that replaces the default white surface colour. */
  colour?: BotanicalPoint;
}
export interface BotanicalBlade {
  start: BotanicalPoint;
  end: BotanicalPoint;
  width: number;
  twist: number;
  shade: number;
}
export interface BotanicalFruit {
  centre: BotanicalPoint;
  radius: BotanicalPoint;
  colour: BotanicalPoint;
  /** Optional low-poly fruit silhouette; date clusters use a cheap packed ellipsoid. */
  kind?: "date";
}
/** A separately built model attached to a plant; its coordinates are local to `anchor`. */
export interface BotanicalAttachment {
  anchor: BotanicalPoint;
  graph: BotanicalGraph;
  /** Yaw of the local frame around the anchor. */
  yaw: number;
}
export interface BotanicalFan {
  /** Hastula where the petiole meets the blade. */
  start: BotanicalPoint;
  direction: number;
  elevation: number;
  radius: number;
  rise: number;
  shade: number;
  /** Costapalmate costa as a share of the fan radius. */
  costa: number;
}
export interface BotanicalGraph {
  tubes: BotanicalTube[];
  blades: BotanicalBlade[];
  fruits: BotanicalFruit[];
  fans: BotanicalFan[];
  /** Separate attachable models, never baked into the parent's own surfaces. */
  attachments: BotanicalAttachment[];
  height: number;
  radius: number;
}
export const botanicalDetail = (detail: number, high: number, minimal: number, far: number) => {
  if (detail === 2) return high;
  if (detail === 1) return minimal;
  return far;
};
export const botanicalNoise = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 38.7) * 43758.5453;
  return value - Math.floor(value);
};
export const botanicalMix = (a: BotanicalPoint, b: BotanicalPoint, t: number): BotanicalPoint =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const botanicalPolar = (angle: number, radius: number, y: number): BotanicalPoint =>
  [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
export const botanicalAdd = (a: BotanicalPoint, b: BotanicalPoint): BotanicalPoint =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const createBotanicalGraph = (species: RoadPlantId): BotanicalGraph => {
  const definition = getRoadPlant(species)!;
  return { tubes: [], blades: [], fruits: [], fans: [], attachments: [], height: definition.height, radius: definition.crownRadius };
};
export const botanicalTube = (graph: BotanicalGraph, path: BotanicalPoint[], radius: number,
  tipRadius: number, green = false, rings = false, trunk = false, colour?: BotanicalPoint) => {
  graph.tubes.push({ path, radius, tipRadius, green, rings, trunk, colour });
};
export const botanicalRoots = (graph: BotanicalGraph, variant: number, radius: number) => {
  // Unequal buttresses blend into the trunk, terminate in the soil, and never form a radial star.
  for (let index = 0; index < 5; index++) {
    const angle = index * 2.399 + variant * .8;
    const reach = radius * (1.25 + botanicalNoise(index + variant * 9) * .9);
    botanicalTube(graph, [[0, .19, 0], botanicalPolar(angle, reach * .58, .06),
      botanicalPolar(angle + .17, reach, .008)], radius * .43, .009);
  }
};

const leafPair = (graph: BotanicalGraph, start: BotanicalPoint, angle: number,
  size: number, width: number, seed: number, opposite = true, petioles = true) => {
  const count = opposite ? 2 : 1;
  for (let side = 0; side < count; side++) {
    const yaw = angle + side * Math.PI;
    const tip = botanicalAdd(start, botanicalPolar(yaw, size * .88, size * (-.25 + botanicalNoise(seed) * .95)));
    const petiole = botanicalMix(start, tip, petioles ? .12 : 0);
    if (petioles && size > .07) botanicalTube(graph, [start, petiole], width * .055, width * .035, true);
    graph.blades.push({ start: petiole, end: tip, width, twist: seed * 1.73 + side,
      shade: .81 + botanicalNoise(seed + side) * .25 });
  }
};

const orchardTrunk = (graph: BotanicalGraph, species: RoadPlantId, variant: number) => {
  const pine = species === "italian-stone-pine";
  const bend = .035 + variant * .014;
  const path: BotanicalPoint[] = [[0, .015, 0], [-bend, .42, .025], [bend * .6, 1.05, -.018],
    [-bend * .8, 1.65, .02], [bend, 2.1, -.015], [bend * .45, pine ? 2.83 : 2.67, .012]];
  botanicalTube(graph, path, .072, pine ? .035 : .044);
  botanicalRoots(graph, variant, .072);
  return path;
};

const fruitOnTwig = (graph: BotanicalGraph, anchor: BotanicalPoint, species: RoadPlantId,
  seed: number, full: boolean) => {
  const orange = species === "orange-standard", acacia = species === "acacia-standard";
  let radius = orange ? .064 : .022;
  if (acacia) radius = .031;
  const centre = botanicalAdd(anchor, [.014, -radius - .040, .008]);
  botanicalTube(graph, [anchor, botanicalAdd(centre, [0, radius, 0])], .007, .004, true);
  let colour: BotanicalPoint = [.16, .22, .11];
  if (orange) colour = [1, .40 + botanicalNoise(seed) * .16, .035];
  if (acacia) colour = [1, .76 + botanicalNoise(seed) * .13, .15];
  graph.fruits.push({ centre, radius: [radius * .94, radius * (orange ? 1 : 1.25), radius], colour });
  if (orange && full) for (let sepal = 0; sepal < 5; sepal++) {
    const angle = sepal / 5 * Math.PI * 2;
    graph.blades.push({ start: botanicalAdd(centre, [0, radius + .003, 0]),
      end: botanicalAdd(centre, botanicalPolar(angle, .023, radius * .94)),
      width: .012, twist: angle, shade: .90 });
  }
  if (acacia && full) for (let index = 0; index < 7; index++) {
    const angle = index * 2.399;
    const offset = botanicalPolar(angle, radius * .77, (botanicalNoise(index + seed) - .5) * radius);
    graph.fruits.push({ centre: botanicalAdd(centre, offset), radius: [.012, .012, .012], colour });
  }
};

const orchardSpray = (graph: BotanicalGraph, start: BotanicalPoint, end: BotanicalPoint,
  species: RoadPlantId, seed: number, detail: number) => {
  const olive = species === "olive-standard", acacia = species === "acacia-standard";
  botanicalTube(graph, [start, botanicalMix(start, end, .46), end], .0075, .0035);
  const yaw = Math.atan2(end[2] - start[2], end[0] - start[0]);
  let nodes = botanicalDetail(detail, 8, 8, 4);
  if (olive) nodes = botanicalDetail(detail, 8, 6, 3);
  if (acacia) nodes = detail === 0 ? 2 : 4;
  for (let node = 0; node < nodes; node++) {
    const anchor = botanicalMix(start, end, .19 + node / nodes * .77);
    if (!acacia) {
      leafPair(graph, anchor, yaw + node * 1.19 + .9, olive ? .19 : .17,
        olive ? .031 : .085, seed + node, true, !olive && detail === 2);
      continue;
    }
    // Each compound leaf has a rachis, paired pinnae, then paired tiny leaflets on the pinna.
    for (const side of [-1, 1]) {
      const pinnaTip = botanicalAdd(anchor, botanicalPolar(yaw + side * 1.0, .17, .018));
      botanicalTube(graph, [anchor, pinnaTip], .0048, .0028, true);
      const pairs = botanicalDetail(detail, 4, 2, 1);
      for (let pair = 0; pair < pairs; pair++) {
        const pinnaAnchor = botanicalMix(anchor, pinnaTip, .20 + pair / pairs * .78);
        leafPair(graph, pinnaAnchor, yaw + side * 1.0 + 1.3, detail === 2 ? .060 : .075, detail === 2 ? .025 : .035, seed + pair, true, false);
      }
    }
  }
  if (seed % 4 === 0 && detail > 0)
    fruitOnTwig(graph, botanicalMix(start, end, .73), species, seed, detail === 2);
};

const pineSpray = (graph: BotanicalGraph, start: BotanicalPoint, end: BotanicalPoint,
  seed: number, detail: number) => {
  botanicalTube(graph, [start, end], .008, .0035);
  const bundles = botanicalDetail(detail, 10, 10, 4);
  for (let bundle = 0; bundle < bundles; bundle++) {
    const anchor = botanicalMix(start, end, .18 + bundle / bundles * .81);
    const phase = bundle * 2.399 + seed;
    const count = botanicalDetail(detail, 5, 4, 3);
    for (let needle = 0; needle < count; needle++) {
      const angle = phase + needle * .36;
      const tip = botanicalAdd(anchor, botanicalPolar(angle, .13 + botanicalNoise(seed + bundle) * .045, .085));
      graph.blades.push({ start: anchor, end: tip, width: detail === 2 ? .017 : .026,
        twist: angle, shade: .76 + botanicalNoise(bundle + needle) * .30 });
    }
  }
};

const acaciaTrunk = (graph: BotanicalGraph, variant: number) => {
  const bend = .035 + variant * .018;
  const path: BotanicalPoint[] = [[0, .015, 0], [-bend * .5, .38, .025],
    [bend * .5, .92, -.02], [-bend * .65, 1.48, .028], [bend * .35, 1.96, -.02],
    [bend * .15, 2.27, .012]];
  botanicalTube(graph, path, .074, .036);
  botanicalRoots(graph, variant, .074);
  return path;
};

/** One bipinnate acacia leaf: a real rachis with pinna pairs, each carrying opposite pinnules. */
const acaciaCompoundLeaf = (graph: BotanicalGraph, anchor: BotanicalPoint, yaw: number,
  seed: number, detail: number) => {
  const reach = .25 + botanicalNoise(seed) * .07;
  const tip = botanicalAdd(anchor, botanicalPolar(yaw, reach, .026 + botanicalNoise(seed + 1) * .03));
  botanicalTube(graph, [anchor, botanicalMix(anchor, tip, .55), tip], .0045, .0024, true);
  const pinnaPairs = botanicalDetail(detail, 3, 2, 1);
  for (let pair = 0; pair < pinnaPairs; pair++) {
    const along = .18 + pair / pinnaPairs * .72;
    const pinnaAnchor = botanicalMix(anchor, tip, along);
    for (const side of [-1, 1]) {
      const angle = yaw + side * (.94 - along * .12);
      const length = .17 + botanicalNoise(seed + pair * 5 + side) * .05;
      const pinnaTip = botanicalAdd(pinnaAnchor, botanicalPolar(angle, length, .020));
      botanicalTube(graph, [pinnaAnchor, pinnaTip], .004, .0018, true);
      const pinnules = botanicalDetail(detail, 4, 3, 1);
      for (let leaflet = 0; leaflet < pinnules; leaflet++) {
        const anchorAlong = .16 + leaflet / pinnules * .76;
        const leafletAnchor = botanicalMix(pinnaAnchor, pinnaTip, anchorAlong);
        const leafletSeed = seed + pair * 31 + leaflet * 7 + side;
        leafPair(graph, leafletAnchor, angle + Math.PI / 2,
          detail === 2 ? .105 : .115, detail === 2 ? .028 : .032,
          leafletSeed, true, false);
      }
    }
  }
};

const acaciaLimb = (graph: BotanicalGraph, anchor: BotanicalPoint, angle: number,
  outer: number, lift: number, seed: number, detail: number) => {
  const shoulder = botanicalAdd(anchor, botanicalPolar(angle - .12, outer * .52, lift * .48));
  const terminal = botanicalAdd(anchor, botanicalPolar(angle, outer, lift));
  botanicalTube(graph, [anchor, shoulder, terminal], .024, .009);
  for (const [twig, side] of [[0, -.52], [1, .56]] as const) {
    const base = botanicalMix(anchor, terminal, .52 + twig * .2);
    const twigAngle = angle + side + (botanicalNoise(seed + twig) - .5) * .2;
    const twigTip = botanicalAdd(base, botanicalPolar(twigAngle, .20 + botanicalNoise(seed + twig + 9) * .07,
      .14 + botanicalNoise(seed + twig + 3) * .10));
    botanicalTube(graph, [base, botanicalMix(base, twigTip, .55), twigTip], .0095, .0038);
    acaciaCompoundLeaf(graph, twigTip, twigAngle + .35, seed + twig * 17, detail);
    if (detail === 2) acaciaCompoundLeaf(graph, botanicalMix(base, twigTip, .58), twigAngle - .25,
      seed + twig * 23 + 4, detail);
  }
  acaciaCompoundLeaf(graph, botanicalMix(anchor, terminal, .58), angle + .45, seed + 41, detail);
  if ((seed & 1) === 0) acaciaCompoundLeaf(graph, botanicalMix(anchor, terminal, .34),
    angle - .52, seed + 67, detail);
  if ((seed & 3) === 0 && detail > 0) fruitOnTwig(graph, terminal, "acacia-standard", seed, detail === 2);
};

const acaciaTree = (graph: BotanicalGraph, trunk: BotanicalPoint[], variant: number, detail: number) => {
  const count = botanicalDetail(detail, 8, 7, 4);
  const phase = variant * 1.13;
  for (let branch = 0; branch < count; branch++) {
    const anchor = botanicalMix(trunk[4]!, trunk[5]!, .55 + (branch % 5) * .11);
    const angle = branch * 2.399 + phase;
    const outer = graph.radius * (.52 + botanicalNoise(branch + variant * 17) * .18);
    const lift = .38 + botanicalNoise(branch * 1.7 + variant) * .25;
    acaciaLimb(graph, anchor, angle, outer, lift, branch * 29 + variant, detail);
  }
};

const oliveTrunk = (graph: BotanicalGraph, variant: number) => {
  const bend = .04 + variant * .018;
  const path: BotanicalPoint[] = [[0, .015, 0], [-bend * .6, .32, .02],
    [bend * .8, .74, -.02], [-bend * .5, 1.18, .03], [bend * .9, 1.63, -.03],
    [bend * .45, 2.08, .02], [bend * .2, 2.48, 0]];
  botanicalTube(graph, path, .122, .048);
  botanicalRoots(graph, variant, .122);
  const leader = (phase: number, top: number, radius: number) => {
    const points: BotanicalPoint[] = [];
    for (let step = 0; step <= 5; step++) {
      const t = step / 5, angle = phase + t * 2.3, offset = (1 - t) * .088 + .018;
      points.push([Math.cos(angle) * offset, .10 + t * (top - .10), Math.sin(angle) * offset]);
    }
    botanicalTube(graph, points, radius, .014);
    return points;
  };
  const first = leader(.7, 2.18, .056), second = leader(2.7, 2.34, .046);
  botanicalTube(graph, [[.07, .07, .04], [.11, .23, .025], [.05, .43, .05]], .052, .024);
  const fork = (phase: number) => {
    const points: BotanicalPoint[] = [];
    for (let step = 0; step <= 3; step++) {
      const t = step / 3, angle = phase + t * 1.1;
      points.push([path[3]![0] + Math.cos(angle) * .16 * t, 1.18 + t * 1.08 + Math.sin(t * 2.2) * .04,
        path[3]![2] + Math.sin(angle) * .16 * t]);
    }
    botanicalTube(graph, points, .052, .024, false, false, true);
    return points;
  };
  return { forks: [fork(.4), fork(3.1)], leaders: [first, second], trunk: path };
};

const oliveTree = (graph: BotanicalGraph, variant: number, detail: number) => {
  const { forks, leaders, trunk } = oliveTrunk(graph, variant);
  const anchors = [botanicalMix(trunk[5]!, trunk[6]!, .25), botanicalMix(trunk[5]!, trunk[6]!, .7),
    botanicalMix(trunk[5]!, trunk[6]!, .92), forks[0]![3]!, forks[1]![3]!,
    leaders[0]![5]!, leaders[1]![5]!, botanicalMix(trunk[6]!, leaders[1]![5]!, .55)];
  const count = botanicalDetail(detail, 8, 6, 4);
  const phase = variant * 1.13;
  for (let branch = 0; branch < count; branch++) {
    const anchor = anchors[branch % anchors.length]!;
    const angle = branch * 2.399 + phase;
    const outer = graph.radius * (.42 + botanicalNoise(branch + variant * 13) * .22);
    const lift = .18 + botanicalNoise(branch * 2.1 + variant) * .42;
    const shoulder = botanicalAdd(anchor, botanicalPolar(angle - .10, outer * .52, lift * .46));
    const terminal = botanicalAdd(anchor, botanicalPolar(angle, outer, lift));
    botanicalTube(graph, [anchor, shoulder, terminal], .030, .010);
    const seed = branch * 37 + variant;
    for (const [twig, side] of [[0, -.55], [1, .58]] as const) {
      const base = botanicalMix(anchor, terminal, .53 + twig * .18);
      const twigAngle = angle + side + (botanicalNoise(seed + twig) - .5) * .18;
      const twigTip = botanicalAdd(base, botanicalPolar(twigAngle, .18 + botanicalNoise(seed + twig + 4) * .07,
        .12 + botanicalNoise(seed + twig + 8) * .09));
      botanicalTube(graph, [base, botanicalMix(base, twigTip, .55), twigTip], .0105, .004);
      orchardSpray(graph, base, twigTip, "olive-standard", seed + twig * 11, detail);
    }
    let sprays = 3;
    if (detail === 2) sprays = 4;
    if (detail === 0) sprays = 2;
    for (let spray = 0; spray < sprays; spray++) {
      const bearing = botanicalMix(anchor, terminal, .24 + spray / sprays * .62);
      const yaw = angle + (spray - (sprays - 1) / 2) * .48;
      const tip = botanicalAdd(bearing, botanicalPolar(yaw, .18 + botanicalNoise(seed + spray) * .05,
        .08 + botanicalNoise(seed + spray + 2) * .08));
      orchardSpray(graph, bearing, tip, "olive-standard", seed + 50 + spray, detail);
    }
  }
};

/** Four species-specific crown systems, built on supported wood rather than opaque foliage balls. */
export const createCatalogOrchardGraph = (species: RoadPlantId, variant: number,
  detail: number, standalone = false): BotanicalGraph => {
  const graph = createBotanicalGraph(species);
  if (standalone) {
    graph.radius = 1.15;
    if (species === "acacia-standard") graph.radius = 1.35;
    if (species === "italian-stone-pine") graph.radius = 1.50;
  }
  if (species === "acacia-standard") {
    acaciaTree(graph, acaciaTrunk(graph, variant), variant, detail);
    return graph;
  }
  if (species === "olive-standard") {
    oliveTree(graph, variant, detail);
    return graph;
  }
  const trunk = orchardTrunk(graph, species, variant);
  const pine = species === "italian-stone-pine";
  const branches = pine ? 7 : 8;
  const phase = variant * 1.13;
  for (let branch = 0; branch < branches; branch++) {
    const angle = branch * 2.399 + phase;
    const outer = graph.radius * (.56 + botanicalNoise(branch + variant * 17) * .19);
    const y = pine ? 2.94 + (branch % 3) * .075 : 2.51 + (branch % 3) * .14;
    const anchor = botanicalMix(trunk[4]!, trunk[5]!, .34 + (branch % 4) * .15);
    const shoulder = botanicalPolar(angle - .16, outer * .58, y - .12);
    const terminal = botanicalPolar(angle, outer, y);
    botanicalTube(graph, [anchor, shoulder, terminal], pine ? .034 : .029, .012);
    const sprays = botanicalDetail(detail, 7, 4, 3);
    for (let spray = 0; spray < sprays; spray++) {
      let bearing = botanicalMix(anchor, terminal, .30 + spray / sprays * .68);
      if (pine) bearing = botanicalMix(shoulder, terminal, .08 + spray / sprays * .90);
      const yaw = angle + (spray - (sprays - 1) / 2) * .58;
      let rise = -.06 + botanicalNoise(spray * 11 + branch) * .40;
      if (pine) rise = .10 + botanicalNoise(spray + branch) * .12;
      const tip = botanicalAdd(bearing, botanicalPolar(yaw, .24, rise));
      const seed = branch * 21 + spray * 3 + variant;
      if (pine) pineSpray(graph, bearing, tip, seed, detail);
      else orchardSpray(graph, bearing, tip, species, seed, detail);
    }
  }
  return graph;
};
