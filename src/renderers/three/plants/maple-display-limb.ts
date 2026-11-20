import type { Point3 } from "../../../render-common/buildings/building-recipe";
import { type OrnamentalLimb, ornamentalNoise, type OrnamentalTreeGraph } from "../../../render-common/plants/ornamental-tree-graph";

export const mapleHasTerminalBearing = (graph: OrnamentalTreeGraph, limb: OrnamentalLimb) => {
  const tip = limb.path.at(-1)!;
  return graph.limbs.some(child => child.parent !== null && graph.limbs[child.parent] === limb &&
    child.path[0]!.every((value, axis) => value === tip[axis]));
};

/** Rendered structural curvature stays inside the original conservative reservation. */
export const mapleTrunkCentre = (graph: OrnamentalTreeGraph, height: number): Point3 => {
  const tip = graph.limbs[0]!.path.at(-1)!;
  const t = Math.max(0, Math.min(1, height / tip[1]));
  const ease = t * t * (3 - 2 * t), bow = Math.sin(t * Math.PI);
  return [tip[0] * ease + bow * .070 * Math.sin(graph.variant * 2.1 + .4), height,
    tip[2] * ease + bow * .080 * Math.cos(graph.variant * 1.2 + .7)];
};

const rootDisplay = (graph: OrnamentalTreeGraph, limb: OrnamentalLimb, seed: number): OrnamentalLimb => {
  const prominent = seed === 1 || seed === 5;
  let reach = .43 + ornamentalNoise(seed * 47 + graph.variant * 139) * .52;
  if (prominent) reach = .88 + ornamentalNoise(seed * 31 + graph.variant) * .08;
  const turn = (ornamentalNoise(seed * 53) - .5) * .14;
  const buried = !prominent && seed % 2 === 0;
  const depth = .075 + ornamentalNoise(seed * 67) * .09;
  const tip = limb.path.at(-1)!;
  const x = (tip[0] * Math.cos(turn) - tip[2] * Math.sin(turn)) * reach;
  const z = (tip[0] * Math.sin(turn) + tip[2] * Math.cos(turn)) * reach;
  const origin = mapleTrunkCentre(graph, .13);
  let shoulder = .075, groundY = .012, run = .67;
  if (buried) { shoulder = -.025; groundY = -.065; }
  if (prominent) { shoulder = .105; groundY = .040; run = .78; }
  const path: Point3[] = [origin, [x * .31, shoulder, z * .31],
    [x * run, groundY, z * run], [x, -depth, z]];
  let thickness = .34 + ornamentalNoise(seed * 79 + graph.variant * 29) * .62;
  if (prominent) thickness = .90 + ornamentalNoise(seed * 23) * .08;
  return { ...limb, path, radius: limb.radius * thickness, tipRadius: .0015 };
};

/** Real leaf/fork bearings are retained; unused cut-looking terminal sticks become short tapered buds. */
export const mapleDisplayLimb = (graph: OrnamentalTreeGraph, limb: OrnamentalLimb,
  detailed: boolean, seed: number): OrnamentalLimb => {
  if (limb.role === "root") return rootDisplay(graph, limb, seed);
  if (limb.role === "trunk") {
    const rings = detailed ? 18 : 12, tip = limb.path.at(-1)!;
    const path = Array.from({ length: rings + 1 }, (_, ring) => {
      const y = limb.path[0]![1] + (tip[1] - limb.path[0]![1]) * ring / rings;
      return mapleTrunkCentre(graph, y);
    });
    return { ...limb, path };
  }
  const path = limb.path.map(point => [...point] as Point3);
  if (limb.parent === 0) path[0] = mapleTrunkCentre(graph, path[0]![1]);
  if (limb.role !== "branch" || mapleHasTerminalBearing(graph, limb)) return { ...limb, path };
  const last = path.length - 1, bearing = path[last - 1]!, tip = path[last]!;
  const length = Math.hypot(...tip.map((value, axis) => value - bearing[axis]!));
  path[last] = bearing.map((value, axis) => value + (tip[axis]! - value) / length * .075) as Point3;
  return { ...limb, path, tipRadius: .0013 };
};
