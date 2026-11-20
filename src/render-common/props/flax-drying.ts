import { addLathe, solid } from "./drink-crops/crop-mesh-parts";
import { MeshBuilder, type Vec3 } from "./mesh-builder";
import { addCurvedTube } from "./tree-parts";

const capsule = (builder: MeshBuilder, centre: Vec3, radius: number) => {
  const points: Vec3[] = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -1, 0]];
  const start = builder.vertexCount;
  for (const normal of points) builder.addVertex(centre.map((value, axis) =>
    value + normal[axis]! * radius) as unknown as Vec3, normal, solid([.27, .18, .075]));
  for (let side = 0; side < 4; side++) {
    const a = start + side + 1, b = start + (side + 1) % 4 + 1;
    builder.addTriangle(start, a, b);
    builder.addTriangle(start + 5, b, a);
  }
};

/** Drying flax is a group of tied, separated stems with branched seed bolls, never a solid cone. */
export const createFlaxDryingMesh = (seed: number, detailed: boolean) => {
  const builder = new MeshBuilder(), straw = solid([.42, .32, .14]);
  const stems = detailed ? 18 : 9;
  for (const [bundle, [cx, cz]] of [[-.3, .16], [.05, -.22], [.4, .1]].entries()) {
    const height = .49 + bundle % 2 * .045, turn = seed * .71 + bundle * 2.4;
    for (let stem = 0; stem < stems; stem++) {
      const angle = turn + stem * 2.39996, radius = .025 + Math.sqrt((stem + 1) / stems) * .065;
      const waist: Vec3 = [cx! + Math.cos(angle) * .025, height * .44, cz! + Math.sin(angle) * .025];
      const tip: Vec3 = [cx! + Math.cos(angle) * radius * .72 + .025,
        height + stem % 4 * .014, cz! + Math.sin(angle) * radius * .72];
      addCurvedTube(builder, [[cx! + Math.cos(angle) * radius, .012 + stem % 3 * .006,
        cz! + Math.sin(angle) * radius], waist, tip], [.0032, .0028, .0018], 3, straw);
      const head: Vec3 = [tip[0] + Math.cos(angle + .7) * .021, tip[1] + .018,
        tip[2] + Math.sin(angle + .7) * .021];
      addCurvedTube(builder, [[tip[0], tip[1] - .025, tip[2]], head], [.0017, .001], 3, straw);
      capsule(builder, head, .0075);
      if (detailed && stem % 2 === 0) capsule(builder, tip, .0065);
    }
    for (const lift of [0, .012]) addLathe(builder, {
      centre: [cx! + .005, height * .44 + lift, cz!],
      profile: [[.029, -.003], [.032, 0], [.029, .003]], segments: detailed ? 10 : 6
    }, solid([.14, .105, .05]));
  }
  return builder.finish({ flex: 0 });
};
