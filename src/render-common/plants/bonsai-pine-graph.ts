import type { Point3 } from "../buildings/building-recipe";
import {
  addOrnamentalLimb, ornamentalAnchor, ornamentalNoise, ornamentalPointBetween,
  type OrnamentalTreeGraph
} from "./ornamental-tree-graph";

/** Informal upright, windswept and semi-cascade: distinct trained structures, not recolours. */
export const createBonsaiPineGraph = (variant = 0, detailed = true,
  shootCount = detailed ? 19 : 12): OrnamentalTreeGraph => {
  if (![0, 1, 2].includes(variant)) throw new Error("Unknown bonsai structure");
  const pot = [
    { style: "oval" as const, width: .66, depth: .43, height: .14 },
    { style: "rectangle" as const, width: .62, depth: .40, height: .16 },
    { style: "round" as const, width: .47, depth: .47, height: .19 }
  ][variant]!;
  const graph: OrnamentalTreeGraph = { species: "bonsai-pine", variant, pot,
    limbs: [], needles: [], leaves: [], blossoms: [] };
  const base = pot.height - .016;
  const trunkPaths: Point3[][] = [
    [[-.035, base, .025], [.025, base + .12, .01], [.095, base + .28, -.015],
      [-.005, base + .44, .005], [.055, base + .59, -.01], [.005, base + .73, 0]],
    [[-.07, base, 0], [-.10, base + .11, .015], [-.015, base + .27, 0],
      [.15, base + .40, -.025], [.26, base + .52, -.02], [.35, base + .63, 0]],
    [[-.05, base, .02], [-.035, base + .13, -.005], [.105, base + .24, .015],
      [.25, base + .23, .025], [.38, base + .12, .015], [.46, base + .025, 0]]
  ];
  const trunk = addOrnamentalLimb(graph, null, trunkPaths[variant]!, .069, .009, "trunk");
  for (let root = 0; root < 7; root++) {
    const angle = root * Math.PI * 2 / 7 + variant * .42;
    const start = ornamentalAnchor(graph, trunk, 0);
    addOrnamentalLimb(graph, trunk, [start,
      [start[0] + Math.cos(angle) * .08, base + .006, start[2] + Math.sin(angle) * .06],
      [Math.cos(angle) * pot.width * .32, base - .025, Math.sin(angle) * pot.depth * .30]],
    .027 - root % 3 * .003, .004, "root");
  }
  const pads = variantPads(variant, base);
  pads.forEach((pad, index) => {
    const attach = Math.min(4, 1 + Math.floor(index * .75));
    const start = ornamentalAnchor(graph, trunk, attach);
    const tip = pad.centre;
    const middle = ornamentalPointBetween(start, tip, .58); middle[1] -= .045;
    const branch = addOrnamentalLimb(graph, trunk, [start, middle, tip],
      .026 - index * .0024, .004, "branch");
    const shoots = shootCount;
    const primaryTwigs: number[] = [];
    for (let shoot = 0; shoot < shoots; shoot++) {
      const angle = shoot * 2.399963 + index * .91;
      const distance = Math.sqrt((shoot + .5) / shoots);
      const end: Point3 = [tip[0] + Math.cos(angle) * distance * pad.radius,
        tip[1] + .025 + (1 - distance) * .035 + ornamentalNoise(shoot + index * 17) * .025,
        tip[2] + Math.sin(angle) * distance * pad.radius * .70];
      let parent = branch;
      if (shoot >= 5) {
        parent = primaryTwigs.reduce((nearest, candidate) => {
          const distance = (id: number) => {
            const point = graph.limbs[id]!.path.at(-1)!;
            return (point[0] - end[0]) ** 2 + (point[2] - end[2]) ** 2;
          };
          return distance(candidate) < distance(nearest) ? candidate : nearest;
        });
      }
      const junction = ornamentalAnchor(graph, parent, shoot % 3 === 0 && shoot < 5 ? 1 : 2);
      const bend = ornamentalPointBetween(junction, end, .62); bend[1] += .015;
      const twig = addOrnamentalLimb(graph, parent, [junction, bend, end],
        shoot < 5 ? .0045 : .0025, shoot < 5 ? .003 : .0008, "twig");
      if (shoot < 5) primaryTwigs.push(twig);
      for (let tuft = 0; tuft < (detailed ? 5 : 3); tuft++) {
        const t = .35 + tuft / (detailed ? 5 : 3) * .65;
        const at = ornamentalPointBetween(bend, end, t);
        graph.needles.push({ limb: twig, tip: at,
          direction: [Math.cos(angle), .6 + ornamentalNoise(shoot + tuft) * .6, Math.sin(angle)],
          length: .026 + ornamentalNoise(shoot * 11 + tuft + variant * 19) * .018,
          seed: index * 1000 + shoot * 11 + tuft });
      }
    }
  });
  return graph;
};

const variantPads = (variant: number, base: number) => {
  const layouts: Array<Array<[number, number, number, number]>> = [
    [[-.25, .30, .08, .16], [.28, .44, .015, .18], [-.17, .51, -.18, .17],
      [.17, .59, .15, .14], [-.055, .71, -.015, .15]],
    [[.10, .25, .10, .16], [.30, .39, -.10, .17], [.49, .46, .025, .18],
      [.35, .57, .12, .13], [.38, .65, -.035, .13]],
    [[-.16, .20, .05, .13], [.20, .28, -.09, .16], [.40, .15, .08, .15],
      [.54, .01, -.04, .16], [.59, -.07, .04, .11]]
  ];
  return layouts[variant]!.map(([x, y, z, radius]) => ({ centre: [x, base + y, z] as Point3, radius }));
};
