import { BufferGeometry, Float32BufferAttribute } from "three";

import type { Point3 } from "../../../render-common/buildings/building-recipe";
import type { RomanGardenTreeGraph } from "../../../render-common/plants/roman-garden-tree-graph";

interface SprayBuffers { positions: number[]; uv: number[]; colours: number[]; indices: number[] }
interface SprayFinger {
  base: Point3; branch: number; finger: number; heading: number;
  length: number; rings: number; sides: number; width: number;
}

const appendFinger = (buffers: SprayBuffers, shape: SprayFinger) => {
  const { colours, indices, positions, uv } = buffers;
  const { base, branch, finger, heading, length, rings, sides, width } = shape;
  const offset = positions.length / 3;
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings;
    const radius = Math.max(.001, Math.sin(Math.PI * t) * width);
    const bow = Math.sin(t * Math.PI * .65) * .10;
    for (let side = 0; side <= sides; side++) {
      const turn = side / sides * Math.PI * 2;
      const x = Math.cos(turn) * radius;
      const z = Math.sin(turn) * radius * .63 + bow;
      positions.push(base[0] + Math.cos(heading) * z - Math.sin(heading) * x,
        base[1] + t * length + finger * .025,
        base[2] + Math.sin(heading) * z + Math.cos(heading) * x);
      uv.push(side / sides, t);
      const shade = .73 + .23 * Math.sin(branch * 1.37 + finger * 2.7 + turn + t * 3) ** 2;
      colours.push(shade, shade, shade);
      if (ring >= rings || side >= sides) continue;
      const a = offset + ring * (sides + 1) + side, b = a + sides + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
};

/** Each living branch ends in a curved three-fingered spray of fine, overlapping scale twigs.
 * Actual small branchlet volumes replace both a smooth cone and broad pillow-shaped clumps.
 */
export const createCypressFoliageCore = (graph: RomanGardenTreeGraph, detailed: boolean, far: boolean) => {
  const rings = detailed && !far ? 3 : 2, sides = 3;
  const buffers: SprayBuffers = { colours: [], indices: [], positions: [], uv: [] };
  const leader = graph.limbs[0]!.path.at(-1)!;
  const height = leader[1] + .08;
  const branches = graph.limbs.filter(limb => limb.role === "twig");
  for (let branch = 0; branch < branches.length; branch++) {
    if (far && branch % 3) continue;
    const limb = branches[branch]!, base = limb.path[1]!;
    const yaw = Math.atan2(base[2], base[0]);
    for (let finger = 0; finger < 3; finger++) {
      const heading = yaw + (finger - 1) * .58 + Math.sin(branch * 7.31) * .19;
      const length = Math.min((detailed ? .51 : .63) * (.82 + .16 * Math.sin(branch * 3.17 + finger)),
        height - base[1]);
      const upperTaper = Math.max(.12, Math.min(1, (height - base[1]) / .85));
      appendFinger(buffers, { base, branch, finger, heading, length, rings, sides,
        width: (detailed ? .063 : .115) * upperTaper });
    }
  }
  appendFinger(buffers, { base: leader, branch: 1000, finger: 0, heading: graph.variant * .71,
    length: .30, rings, sides, width: .033 });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(buffers.colours, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(buffers.uv, 2));
  geometry.setIndex(buffers.indices); geometry.computeVertexNormals();
  return geometry;
};
