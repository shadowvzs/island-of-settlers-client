import type { Point3 } from "../buildings/building-recipe";
import { createBonsaiPineGraph } from "./bonsai-pine-graph";
import {
  addOrnamentalLimb, ornamentalAnchor, ornamentalNoise, ornamentalPointBetween,
  type OrnamentalTreeGraph
} from "./ornamental-tree-graph";

/** Two restrained counter-pads balance the slanted trunk without mirroring its existing crown. */
const addWindsweptCounterbranches = (graph: OrnamentalTreeGraph) => {
  if (graph.variant !== 1) return;
  const layouts = [
    { anchor: 1, radius: .017, tip: [-.30, .44, .085] as Point3, spread: .105 },
    { anchor: 2, radius: .015, tip: [-.20, .63, -.035] as Point3, spread: .095 }
  ];
  layouts.forEach(({ anchor, radius, spread, tip }, index) => {
    const start = ornamentalAnchor(graph, 0, anchor);
    const bend = ornamentalPointBetween(start, tip, .60);
    bend[1] -= .025;
    const branch = addOrnamentalLimb(graph, 0, [start, bend, tip], radius, .003, "branch");
    for (let shoot = 0; shoot < 3; shoot++) {
      const angle = shoot * 2.399963 + index * .7;
      const distance = Math.sqrt((shoot + .5) / 3);
      const end: Point3 = [tip[0] + Math.cos(angle) * spread * distance,
        tip[1] + .018 + (1 - distance) * .025,
        tip[2] + Math.sin(angle) * spread * distance * .75];
      const junction = ornamentalAnchor(graph, branch, shoot === 0 ? 1 : 2);
      const middle = ornamentalPointBetween(junction, end, .62);
      middle[1] += .008;
      addOrnamentalLimb(graph, branch, [junction, middle, end], .003, .0008, "twig");
    }
  });
};

/** Small oval elm foliage on the trained bonsai structure, botanically distinct from full-size maple. */
export const createBonsaiElmGraph = (variant = 0, detailed = true): OrnamentalTreeGraph => {
  const graph = createBonsaiPineGraph(variant, detailed, detailed ? 17 : 12);
  graph.species = "bonsai-elm";
  graph.needles = [];
  addWindsweptCounterbranches(graph);
  graph.limbs.forEach((limb, index) => {
    if (limb.role !== "twig") return;
    const parent = graph.limbs[limb.parent!]!;
    if (parent.role === "twig") limb.path[0] = [...parent.path.at(-1)!];
    const terminal = limb.path.at(-1)!;
    terminal[1] += (ornamentalNoise(index * 43 + variant * 11) - .5) * .10;
    limb.path[1] = ornamentalPointBetween(limb.path[0]!, terminal, .62);
    limb.path[1][1] += .015;
    const leaves = detailed ? 4 : 4 + index % 2;
    for (let leaf = 0; leaf < leaves; leaf++) {
      const along = (.12 + leaf / (leaves - 1) * .80) * (limb.path.length - 1);
      const segment = Math.min(limb.path.length - 2, Math.floor(along));
      const position = ornamentalPointBetween(limb.path[segment]!, limb.path[segment + 1]!, along - segment);
      const seed = index * 19 + leaf * 7 + variant * 113;
      graph.leaves.push({ position,
        yaw: index * 2.399963 + leaf * 2.399963,
        pitch: -.10 + ornamentalNoise(seed + 1) * .45,
        roll: Math.sin(seed * .9) * .23,
        length: .065 + ornamentalNoise(seed) * .025,
        width: .042 + ornamentalNoise(seed + 2) * .016, seed });
    }
  });
  return graph;
};
